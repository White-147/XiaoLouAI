using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace XiaoLou.ClosedApiWorker.Vertex;

internal sealed class VertexAccessTokenProvider(VertexOptions options, ILogger<VertexAccessTokenProvider> logger)
{
    private static readonly HttpClient TokenHttpClient = new();
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private string? _cachedToken;
    private DateTimeOffset _cachedTokenExpiresAt;

    public async Task ApplyAuthAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var token = await GetAccessTokenAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(token))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return;
        }

        if (!string.IsNullOrWhiteSpace(options.ApiKey))
        {
            request.Headers.TryAddWithoutValidation("x-goog-api-key", options.ApiKey);
            return;
        }

        throw new VertexProviderException(
            "Vertex credentials are not configured. Set GOOGLE_APPLICATION_CREDENTIALS, Vertex:AccessToken, or VERTEX_API_KEY.",
            retry: false);
    }

    private async Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(options.AccessToken))
        {
            return options.AccessToken;
        }

        if (string.IsNullOrWhiteSpace(options.CredentialsPath))
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(_cachedToken)
            && DateTimeOffset.UtcNow.AddMinutes(5) < _cachedTokenExpiresAt)
        {
            return _cachedToken;
        }

        await _refreshLock.WaitAsync(cancellationToken);
        try
        {
            if (!string.IsNullOrWhiteSpace(_cachedToken)
                && DateTimeOffset.UtcNow.AddMinutes(5) < _cachedTokenExpiresAt)
            {
                return _cachedToken;
            }

            var assertion = await CreateServiceAccountAssertionAsync(cancellationToken);
            using var response = await TokenHttpClient.PostAsync(
                options.OAuthTokenEndpoint,
                new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    ["assertion"] = assertion,
                }),
                cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                throw new VertexProviderException(
                    $"Failed to exchange Vertex service account assertion for an access token: {(int)response.StatusCode} {Trim(body)}",
                    retry: response.StatusCode == System.Net.HttpStatusCode.TooManyRequests
                           || (int)response.StatusCode >= 500);
            }

            using var parsed = JsonDocument.Parse(body);
            if (!parsed.RootElement.TryGetProperty("access_token", out var tokenElement))
            {
                throw new VertexProviderException("Vertex OAuth token response did not include access_token.", retry: false);
            }

            var token = tokenElement.GetString();
            if (string.IsNullOrWhiteSpace(token))
            {
                throw new VertexProviderException("Vertex OAuth token response included an empty access_token.", retry: false);
            }

            var expiresIn = parsed.RootElement.TryGetProperty("expires_in", out var expiresElement)
                && expiresElement.TryGetInt32(out var parsedExpires)
                ? parsedExpires
                : 3600;
            _cachedToken = token;
            _cachedTokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(60, expiresIn));
            logger.LogInformation("Refreshed Vertex access token; expires at {ExpiresAt}.", _cachedTokenExpiresAt);
            return _cachedToken;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private async Task<string> CreateServiceAccountAssertionAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(options.CredentialsPath))
        {
            throw new VertexProviderException(
                $"Vertex service account file was not found at configured GOOGLE_APPLICATION_CREDENTIALS path: {options.CredentialsPath}",
                retry: false);
        }

        await using var stream = File.OpenRead(options.CredentialsPath);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        var clientEmail = RequiredString(root, "client_email");
        var privateKey = RequiredString(root, "private_key");
        var tokenUri = FirstString(root, "token_uri") ?? options.OAuthTokenEndpoint;
        var now = DateTimeOffset.UtcNow;
        var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
        {
            alg = "RS256",
            typ = "JWT",
        }));
        var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
        {
            iss = clientEmail,
            scope = "https://www.googleapis.com/auth/cloud-platform",
            aud = tokenUri,
            iat = now.ToUnixTimeSeconds(),
            exp = now.AddMinutes(55).ToUnixTimeSeconds(),
        }));
        var unsignedJwt = $"{header}.{payload}";

        using var rsa = RSA.Create();
        rsa.ImportFromPem(privateKey);
        var signature = rsa.SignData(
            Encoding.ASCII.GetBytes(unsignedJwt),
            HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        return $"{unsignedJwt}.{Base64Url(signature)}";
    }

    private static string RequiredString(JsonElement root, string propertyName)
    {
        var value = FirstString(root, propertyName);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new VertexProviderException($"Vertex service account JSON is missing {propertyName}.", retry: false);
        }

        return value;
    }

    private static string? FirstString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;
    }

    private static string Base64Url(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static string Trim(string body)
    {
        return body.Length <= 500 ? body : body[..500];
    }
}
