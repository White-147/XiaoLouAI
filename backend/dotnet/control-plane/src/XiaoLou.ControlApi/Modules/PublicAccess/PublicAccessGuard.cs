using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace XiaoLou.ControlApi.Modules.PublicAccess;

internal static class PublicAccessGuardExtensions
{
    public static IServiceCollection AddXiaoLouPublicAccessGuard(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.Configure<PublicAccessLimitOptions>(configuration.GetSection("PublicAccessLimits"));
        services.AddSingleton<PublicAccessRequestLimiter>();
        return services;
    }

    public static IApplicationBuilder UseXiaoLouPublicAccessGuard(this IApplicationBuilder app)
    {
        return app.UseMiddleware<PublicAccessGuardMiddleware>();
    }
}

internal sealed class PublicAccessGuardMiddleware(
    RequestDelegate next,
    IOptions<PublicAccessLimitOptions> options,
    PublicAccessRequestLimiter limiter)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var configured = options.Value.Normalized();
        if (!configured.Enabled)
        {
            await next(context);
            return;
        }

        var policy = PublicAccessGuardClassifier.Classify(context.Request.Method, context.Request.Path);
        if (policy is PublicAccessPolicyKind.None)
        {
            await next(context);
            return;
        }

        var definition = configured.GetDefinition(policy);
        if (definition.MaxRequestBodyBytes is { } maxRequestBodyBytes
            && await RejectOversizedBodyAsync(context, definition, maxRequestBodyBytes))
        {
            return;
        }

        using var lease = limiter.TryAcquire(context, definition);
        if (!lease.IsAllowed)
        {
            await WriteRateLimitedAsync(context, definition, lease.RetryAfter);
            return;
        }

        await next(context);
    }

    private static async Task<bool> RejectOversizedBodyAsync(
        HttpContext context,
        PublicAccessLimitDefinition definition,
        long maxRequestBodyBytes)
    {
        var maxBodySizeFeature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (maxBodySizeFeature is { IsReadOnly: false })
        {
            maxBodySizeFeature.MaxRequestBodySize = maxRequestBodyBytes;
        }

        if (context.Request.ContentLength is null || context.Request.ContentLength <= maxRequestBodyBytes)
        {
            return false;
        }

        context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
        await context.Response.WriteAsJsonAsync(new
        {
            error = new
            {
                code = "PUBLIC_REQUEST_BODY_TOO_LARGE",
                message = "request body is larger than the configured public access limit",
                policy = definition.Name,
                maxRequestBodyBytes,
            },
        });
        return true;
    }

    private static async Task WriteRateLimitedAsync(
        HttpContext context,
        PublicAccessLimitDefinition definition,
        TimeSpan retryAfter)
    {
        var retrySeconds = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds));
        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.Response.Headers["Retry-After"] = retrySeconds.ToString(CultureInfo.InvariantCulture);
        await context.Response.WriteAsJsonAsync(new
        {
            error = new
            {
                code = "PUBLIC_RATE_LIMITED",
                message = "too many concurrent or repeated public requests",
                policy = definition.Name,
                retryAfterSeconds = retrySeconds,
            },
        });
    }
}

internal sealed class PublicAccessRequestLimiter
{
    private readonly ConcurrentDictionary<string, PublicAccessPolicyLimiterState> states = new(StringComparer.Ordinal);

    public PublicAccessLimiterLease TryAcquire(HttpContext context, PublicAccessLimitDefinition definition)
    {
        var partitionKey = PublicAccessClientKey.Resolve(context);
        var stateKey = string.Join(
            ':',
            definition.Name,
            definition.PermitLimit,
            definition.ConcurrencyLimit,
            (int)definition.Window.TotalSeconds,
            partitionKey);
        var state = states.GetOrAdd(stateKey, _ => new PublicAccessPolicyLimiterState(definition));
        var rateLease = state.RateLimiter.AttemptAcquire(1);
        if (!rateLease.IsAcquired)
        {
            return PublicAccessLimiterLease.Denied(rateLease, null, ResolveRetryAfter(rateLease, definition));
        }

        var concurrencyLease = state.ConcurrencyLimiter.AttemptAcquire(1);
        if (!concurrencyLease.IsAcquired)
        {
            rateLease.Dispose();
            return PublicAccessLimiterLease.Denied(
                concurrencyLease,
                null,
                ResolveRetryAfter(concurrencyLease, definition));
        }

        return PublicAccessLimiterLease.Allowed(rateLease, concurrencyLease);
    }

    private static TimeSpan ResolveRetryAfter(RateLimitLease lease, PublicAccessLimitDefinition definition)
    {
        return lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? retryAfter
            : definition.Window;
    }
}

internal sealed class PublicAccessLimiterLease : IDisposable
{
    private readonly RateLimitLease? rateLease;
    private readonly RateLimitLease? concurrencyLease;

    private PublicAccessLimiterLease(
        bool isAllowed,
        RateLimitLease? rateLease,
        RateLimitLease? concurrencyLease,
        TimeSpan retryAfter)
    {
        IsAllowed = isAllowed;
        this.rateLease = rateLease;
        this.concurrencyLease = concurrencyLease;
        RetryAfter = retryAfter;
    }

    public bool IsAllowed { get; }

    public TimeSpan RetryAfter { get; }

    public static PublicAccessLimiterLease Allowed(RateLimitLease rateLease, RateLimitLease concurrencyLease)
    {
        return new PublicAccessLimiterLease(true, rateLease, concurrencyLease, TimeSpan.Zero);
    }

    public static PublicAccessLimiterLease Denied(
        RateLimitLease deniedLease,
        RateLimitLease? concurrencyLease,
        TimeSpan retryAfter)
    {
        return new PublicAccessLimiterLease(false, deniedLease, concurrencyLease, retryAfter);
    }

    public void Dispose()
    {
        concurrencyLease?.Dispose();
        rateLease?.Dispose();
    }
}

internal sealed class PublicAccessPolicyLimiterState : IDisposable
{
    public PublicAccessPolicyLimiterState(PublicAccessLimitDefinition definition)
    {
        RateLimiter = new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
        {
            AutoReplenishment = true,
            PermitLimit = definition.PermitLimit,
            QueueLimit = 0,
            Window = definition.Window,
        });
        ConcurrencyLimiter = new ConcurrencyLimiter(new ConcurrencyLimiterOptions
        {
            PermitLimit = definition.ConcurrencyLimit,
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
        });
    }

    public FixedWindowRateLimiter RateLimiter { get; }

    public ConcurrencyLimiter ConcurrencyLimiter { get; }

    public void Dispose()
    {
        RateLimiter.Dispose();
        ConcurrencyLimiter.Dispose();
    }
}

internal sealed class PublicAccessLimitOptions
{
    public bool Enabled { get; set; } = true;

    public int WindowSeconds { get; set; } = 60;

    public int AuthPermitLimit { get; set; } = 20;

    public int AuthConcurrencyLimit { get; set; } = 4;

    public int JobCreatePermitLimit { get; set; } = 30;

    public int JobCreateConcurrencyLimit { get; set; } = 6;

    public int MediaSignedUrlPermitLimit { get; set; } = 60;

    public int MediaSignedUrlConcurrencyLimit { get; set; } = 8;

    public int MediaUploadPermitLimit { get; set; } = 20;

    public int MediaUploadConcurrencyLimit { get; set; } = 3;

    public int MediaReadPermitLimit { get; set; } = 600;

    public int MediaReadConcurrencyLimit { get; set; } = 32;

    public int HealthPermitLimit { get; set; } = 120;

    public int HealthConcurrencyLimit { get; set; } = 8;

    public long AuthRequestBodyBytes { get; set; } = 64 * 1024;

    public long JsonRequestBodyBytes { get; set; } = 2 * 1024 * 1024;

    public long MediaUploadBodyBytes { get; set; } = 256L * 1024 * 1024;

    public PublicAccessLimitOptions Normalized()
    {
        return new PublicAccessLimitOptions
        {
            Enabled = Enabled,
            WindowSeconds = NormalizeInt(WindowSeconds, 1, 3600, 60),
            AuthPermitLimit = NormalizeInt(AuthPermitLimit, 1, 100_000, 20),
            AuthConcurrencyLimit = NormalizeInt(AuthConcurrencyLimit, 1, 10_000, 4),
            JobCreatePermitLimit = NormalizeInt(JobCreatePermitLimit, 1, 100_000, 30),
            JobCreateConcurrencyLimit = NormalizeInt(JobCreateConcurrencyLimit, 1, 10_000, 6),
            MediaSignedUrlPermitLimit = NormalizeInt(MediaSignedUrlPermitLimit, 1, 100_000, 60),
            MediaSignedUrlConcurrencyLimit = NormalizeInt(MediaSignedUrlConcurrencyLimit, 1, 10_000, 8),
            MediaUploadPermitLimit = NormalizeInt(MediaUploadPermitLimit, 1, 100_000, 20),
            MediaUploadConcurrencyLimit = NormalizeInt(MediaUploadConcurrencyLimit, 1, 10_000, 3),
            MediaReadPermitLimit = NormalizeInt(MediaReadPermitLimit, 1, 1_000_000, 600),
            MediaReadConcurrencyLimit = NormalizeInt(MediaReadConcurrencyLimit, 1, 100_000, 32),
            HealthPermitLimit = NormalizeInt(HealthPermitLimit, 1, 100_000, 120),
            HealthConcurrencyLimit = NormalizeInt(HealthConcurrencyLimit, 1, 10_000, 8),
            AuthRequestBodyBytes = NormalizeLong(AuthRequestBodyBytes, 1024, 16 * 1024 * 1024, 64 * 1024),
            JsonRequestBodyBytes = NormalizeLong(JsonRequestBodyBytes, 16 * 1024, 64 * 1024 * 1024, 2 * 1024 * 1024),
            MediaUploadBodyBytes = NormalizeLong(MediaUploadBodyBytes, 1024 * 1024, 2L * 1024 * 1024 * 1024, 256L * 1024 * 1024),
        };
    }

    public PublicAccessLimitDefinition GetDefinition(PublicAccessPolicyKind policy)
    {
        var window = TimeSpan.FromSeconds(WindowSeconds);
        return policy switch
        {
            PublicAccessPolicyKind.AuthSensitive => new PublicAccessLimitDefinition(
                policy,
                "auth-sensitive",
                AuthPermitLimit,
                AuthConcurrencyLimit,
                window,
                AuthRequestBodyBytes),
            PublicAccessPolicyKind.JobCreate => new PublicAccessLimitDefinition(
                policy,
                "job-create",
                JobCreatePermitLimit,
                JobCreateConcurrencyLimit,
                window,
                JsonRequestBodyBytes),
            PublicAccessPolicyKind.MediaSignedUrl => new PublicAccessLimitDefinition(
                policy,
                "media-signed-url",
                MediaSignedUrlPermitLimit,
                MediaSignedUrlConcurrencyLimit,
                window,
                JsonRequestBodyBytes),
            PublicAccessPolicyKind.MediaObjectUpload => new PublicAccessLimitDefinition(
                policy,
                "media-object-upload",
                MediaUploadPermitLimit,
                MediaUploadConcurrencyLimit,
                window,
                MediaUploadBodyBytes),
            PublicAccessPolicyKind.MediaObjectRead => new PublicAccessLimitDefinition(
                policy,
                "media-object-read",
                MediaReadPermitLimit,
                MediaReadConcurrencyLimit,
                window,
                null),
            PublicAccessPolicyKind.HealthProbe => new PublicAccessLimitDefinition(
                policy,
                "health-probe",
                HealthPermitLimit,
                HealthConcurrencyLimit,
                window,
                null),
            _ => new PublicAccessLimitDefinition(
                PublicAccessPolicyKind.None,
                "none",
                1,
                1,
                window,
                null),
        };
    }

    private static int NormalizeInt(int value, int min, int max, int fallback)
    {
        return value < min || value > max ? fallback : value;
    }

    private static long NormalizeLong(long value, long min, long max, long fallback)
    {
        return value < min || value > max ? fallback : value;
    }
}

internal sealed record PublicAccessLimitDefinition(
    PublicAccessPolicyKind Policy,
    string Name,
    int PermitLimit,
    int ConcurrencyLimit,
    TimeSpan Window,
    long? MaxRequestBodyBytes);

internal enum PublicAccessPolicyKind
{
    None = 0,
    AuthSensitive,
    JobCreate,
    MediaSignedUrl,
    MediaObjectUpload,
    MediaObjectRead,
    HealthProbe,
}

internal static class PublicAccessGuardClassifier
{
    public static PublicAccessPolicyKind Classify(string method, PathString path)
    {
        return Classify(method, path.Value ?? "");
    }

    public static PublicAccessPolicyKind Classify(string method, string path)
    {
        var normalizedMethod = method.ToUpperInvariant();
        var normalizedPath = string.IsNullOrWhiteSpace(path) ? "/" : path.Trim();

        if (normalizedMethod is "GET" && IsHealthProbePath(normalizedPath))
        {
            return PublicAccessPolicyKind.HealthProbe;
        }

        if (normalizedMethod is "GET" && StartsWithPath(normalizedPath, "/api/media/object-content"))
        {
            return PublicAccessPolicyKind.MediaObjectRead;
        }

        if (normalizedMethod is "PUT" or "OPTIONS" && StartsWithPath(normalizedPath, "/api/media/object-upload"))
        {
            return PublicAccessPolicyKind.MediaObjectUpload;
        }

        if (normalizedMethod is "POST" && IsAuthSensitivePath(normalizedPath))
        {
            return PublicAccessPolicyKind.AuthSensitive;
        }

        if (normalizedMethod is "POST" && IsJobCreatePath(normalizedPath))
        {
            return PublicAccessPolicyKind.JobCreate;
        }

        if (normalizedMethod is "POST" && IsMediaSignedUrlPath(normalizedPath))
        {
            return PublicAccessPolicyKind.MediaSignedUrl;
        }

        if (normalizedMethod is "GET" && !StartsWithPath(normalizedPath, "/api"))
        {
            return PublicAccessPolicyKind.MediaObjectRead;
        }

        if (normalizedMethod is "PUT" or "OPTIONS" && !StartsWithPath(normalizedPath, "/api"))
        {
            return PublicAccessPolicyKind.MediaObjectUpload;
        }

        return PublicAccessPolicyKind.None;
    }

    private static bool IsHealthProbePath(string path)
    {
        return IsExactPath(path, "/healthz")
            || IsExactPath(path, "/livez")
            || IsExactPath(path, "/readyz")
            || IsExactPath(path, "/metrics")
            || IsExactPath(path, "/api/windows-native/status");
    }

    private static bool IsAuthSensitivePath(string path)
    {
        return StartsWithPath(path, "/api/auth")
            || IsExactPath(path, "/api/accounts/ensure");
    }

    private static bool IsJobCreatePath(string path)
    {
        return IsExactPath(path, "/api/jobs")
            || IsExactPath(path, "/api/playground/chat")
            || IsExactPath(path, "/api/playground/chat-jobs");
    }

    private static bool IsMediaSignedUrlPath(string path)
    {
        return IsExactPath(path, "/api/media/upload-begin")
            || IsExactPath(path, "/api/media/upload-complete")
            || IsExactPath(path, "/api/media/signed-read-url")
            || IsExactPath(path, "/api/media/move-temp-to-permanent");
    }

    private static bool IsExactPath(string path, string expected)
    {
        return string.Equals(path, expected, StringComparison.OrdinalIgnoreCase);
    }

    private static bool StartsWithPath(string path, string prefix)
    {
        return path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && (path.Length == prefix.Length || path[prefix.Length] == '/');
    }
}

internal static class PublicAccessClientKey
{
    public static string Resolve(HttpContext context)
    {
        foreach (var headerName in new[] { "X-Forwarded-For", "CF-Connecting-IP", "X-Real-IP" })
        {
            var values = context.Request.Headers[headerName];
            for (var valueIndex = values.Count - 1; valueIndex >= 0; valueIndex--)
            {
                var raw = values[valueIndex];
                if (string.IsNullOrWhiteSpace(raw))
                {
                    continue;
                }

                var parts = raw.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                for (var partIndex = parts.Length - 1; partIndex >= 0; partIndex--)
                {
                    if (TryNormalizeIp(parts[partIndex], out var normalized))
                    {
                        return normalized;
                    }
                }
            }
        }

        return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }

    private static bool TryNormalizeIp(string value, out string normalized)
    {
        normalized = "";
        var candidate = value.Trim().Trim('"');
        if (IPAddress.TryParse(candidate, out var parsed))
        {
            normalized = parsed.ToString();
            return true;
        }

        var lastColon = candidate.LastIndexOf(':');
        if (lastColon > 0
            && candidate.Count(character => character == ':') == 1
            && IPAddress.TryParse(candidate[..lastColon], out parsed))
        {
            normalized = parsed.ToString();
            return true;
        }

        return false;
    }
}
