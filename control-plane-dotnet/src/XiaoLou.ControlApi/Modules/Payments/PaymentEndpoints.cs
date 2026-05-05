using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Payments;

internal static class PaymentEndpoints
{
    private static readonly JsonSerializerOptions PaymentCallbackJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    public static IEndpointRouteBuilder MapPaymentEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/wallet", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresWalletStore wallets,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            var wallet = await wallets.GetWalletByOwnerAsync(scope.AccountOwnerType, scope.AccountOwnerId, ct);
            return wallet is null
                ? Results.NotFound(new { error = "wallet not found" })
                : Results.Ok(wallet);
        });

        endpoints.MapGet("/api/wallets", async (
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresWalletStore wallets,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new
            {
                items = await wallets.ListWalletsByOwnerAsync(scope.AccountOwnerType, scope.AccountOwnerId, 20, ct),
            });
        });

        endpoints.MapGet("/api/wallets/{walletId:guid}/ledger", async (
            Guid walletId,
            int? limit,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresWalletStore wallets,
            CancellationToken ct) =>
        {
            var wallet = await wallets.GetWalletByAccountIdAsync(walletId, ct);
            if (wallet is null)
            {
                return Results.NotFound(new { error = "wallet not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, wallet) is { } denied)
            {
                return denied;
            }

            return Results.Ok(new
            {
                items = await wallets.ListLedgerAsync(walletId, limit ?? 50, ct),
            });
        });

        endpoints.MapGet("/api/wallet/usage-stats", async (
            string? mode,
            string? accountOwnerType,
            string? accountOwnerId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresWalletStore wallets,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(httpContext, accountOwnerType, accountOwnerId, mode);
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await wallets.GetUsageStatsAsync(
                scope.AccountOwnerType,
                scope.AccountOwnerId,
                mode,
                ct));
        });

        endpoints.MapPost("/api/payments/callbacks/{provider}", async (
            string provider,
            HttpRequest http,
            IOptions<PaymentCallbackOptions> paymentCallbackOptions,
            PostgresPaymentLedger ledger,
            IPaymentSignatureVerifier verifier,
            CancellationToken ct) =>
        {
            return await HandlePaymentCallbackAsync(
                provider,
                http,
                paymentCallbackOptions.Value,
                ledger,
                verifier,
                ct);
        });

        endpoints.MapPost("/api/payments/alipay/notify", async (
            HttpRequest http,
            IOptions<PaymentCallbackOptions> paymentCallbackOptions,
            PostgresPaymentLedger ledger,
            IPaymentSignatureVerifier verifier,
            CancellationToken ct) =>
        {
            return await HandlePaymentCallbackAsync(
                "alipay",
                http,
                paymentCallbackOptions.Value,
                ledger,
                verifier,
                ct);
        });

        endpoints.MapPost("/api/payments/wechat/notify", async (
            HttpRequest http,
            IOptions<PaymentCallbackOptions> paymentCallbackOptions,
            PostgresPaymentLedger ledger,
            IPaymentSignatureVerifier verifier,
            CancellationToken ct) =>
        {
            return await HandlePaymentCallbackAsync(
                "wechat",
                http,
                paymentCallbackOptions.Value,
                ledger,
                verifier,
                ct);
        });

        return endpoints;
    }

    private static async Task<IResult> HandlePaymentCallbackAsync(
        string provider,
        HttpRequest http,
        PaymentCallbackOptions paymentCallbackOptions,
        PostgresPaymentLedger ledger,
        IPaymentSignatureVerifier verifier,
        CancellationToken ct)
    {
        using var reader = new StreamReader(http.Body, Encoding.UTF8);
        var rawBody = await reader.ReadToEndAsync(ct);
        PaymentCallbackRequest callback;
        try
        {
            callback = JsonSerializer.Deserialize<PaymentCallbackRequest>(rawBody, PaymentCallbackJsonOptions)
                ?? new PaymentCallbackRequest();
        }
        catch (JsonException)
        {
            return Results.BadRequest(new
            {
                error = "payment callback body must be normalized JSON before ledger processing",
                provider = NormalizePaymentProvider(provider) ?? provider,
            });
        }

        if (ValidatePaymentCallbackProviderBoundary(
            provider,
            callback,
            paymentCallbackOptions,
            out var normalizedProvider) is { } denied)
        {
            return denied;
        }

        var signature = http.Headers["X-XiaoLou-Signature"].FirstOrDefault() ?? callback.Signature;
        var signatureValid = verifier.Verify(normalizedProvider, rawBody, signature);
        var result = await ledger.ProcessCallbackAsync(callback with
        {
            Provider = normalizedProvider,
            SignatureValid = signatureValid,
            RawBody = rawBody,
        }, ct);

        return signatureValid && !IsRejected(result)
            ? Results.Ok(result)
            : Results.BadRequest(result);
    }

    private static bool IsRejected(Dictionary<string, object?> result)
    {
        return result.TryGetValue("processed", out var processed)
            && processed is bool processedValue
            && !processedValue
            && result.ContainsKey("error");
    }

    private static IResult? ValidatePaymentCallbackProviderBoundary(
        string routeProvider,
        PaymentCallbackRequest callback,
        PaymentCallbackOptions options,
        out string normalizedProvider)
    {
        normalizedProvider = NormalizePaymentProvider(routeProvider) ?? "";
        if (string.IsNullOrWhiteSpace(normalizedProvider))
        {
            return Results.BadRequest(new
            {
                error = "payment callback provider is invalid",
            });
        }

        var rawBodyProvider = NormalizeBlank(callback.Provider);
        if (rawBodyProvider is not null)
        {
            var bodyProvider = NormalizePaymentProvider(rawBodyProvider);
            if (bodyProvider is null)
            {
                return Results.BadRequest(new
                {
                    error = "payment callback body provider is invalid",
                });
            }

            if (!string.Equals(bodyProvider, normalizedProvider, StringComparison.Ordinal))
            {
                return Results.BadRequest(new
                {
                    error = "payment callback provider mismatch",
                    routeProvider = normalizedProvider,
                    bodyProvider,
                });
            }
        }

        if (!IsPaymentCallbackProviderAllowed(normalizedProvider, options))
        {
            return Results.Json(new
            {
                error = "payment callback provider is not enabled",
                provider = normalizedProvider,
            }, statusCode: StatusCodes.Status403Forbidden);
        }

        if (!IsPaymentCallbackAccountAllowed(callback, options))
        {
            return Results.Json(new
            {
                error = "payment callback account is not enabled",
                accountId = NormalizeGuidText(callback.AccountId),
                accountOwnerType = NormalizeOwnerType(callback.AccountOwnerType) ?? "user",
                accountOwnerId = NormalizeBlank(callback.AccountOwnerId),
            }, statusCode: StatusCodes.Status403Forbidden);
        }

        return null;
    }

    private static bool IsPaymentCallbackProviderAllowed(string provider, PaymentCallbackOptions options)
    {
        var allowedProviders = GetConfiguredPaymentCallbackAllowedProviders(options);
        if (string.IsNullOrWhiteSpace(allowedProviders))
        {
            return !ShouldRequirePaymentCallbackAllowedProvider(options);
        }

        return ContainsCsvGrant(allowedProviders, provider);
    }

    private static string? GetConfiguredPaymentCallbackAllowedProviders(PaymentCallbackOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AllowedProviders)
            ? Environment.GetEnvironmentVariable("PAYMENT_CALLBACK_ALLOWED_PROVIDERS")
            : options.AllowedProviders;
    }

    private static bool ShouldRequirePaymentCallbackAllowedProvider(PaymentCallbackOptions options)
    {
        return ReadBoolOption("PAYMENT_CALLBACK_REQUIRE_ALLOWED_PROVIDER", options.RequireAllowedProvider);
    }

    private static bool IsPaymentCallbackAccountAllowed(PaymentCallbackRequest callback, PaymentCallbackOptions options)
    {
        var allowedAccountIds = GetConfiguredPaymentCallbackAllowedAccountIds(options);
        var allowedOwnerIds = GetConfiguredPaymentCallbackAllowedAccountOwnerIds(options);
        var hasConfiguredGrant = !string.IsNullOrWhiteSpace(allowedAccountIds)
            || !string.IsNullOrWhiteSpace(allowedOwnerIds);
        if (!hasConfiguredGrant)
        {
            return !ShouldRequirePaymentCallbackAccountGrant(options);
        }

        var accountId = NormalizeGuidText(callback.AccountId);
        if (accountId is not null && ContainsCsvGrant(allowedAccountIds, accountId))
        {
            return true;
        }

        var ownerType = NormalizeOwnerType(callback.AccountOwnerType) ?? "user";
        var ownerId = NormalizeBlank(callback.AccountOwnerId);
        return ownerId is not null
            && (ContainsCsvGrant(allowedOwnerIds, ownerId)
                || ContainsCsvGrant(allowedOwnerIds, $"{ownerType}:{ownerId}")
                || ContainsCsvGrant(allowedOwnerIds, $"{ownerType}:*"));
    }

    private static string? GetConfiguredPaymentCallbackAllowedAccountIds(PaymentCallbackOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AllowedAccountIds)
            ? Environment.GetEnvironmentVariable("PAYMENT_CALLBACK_ALLOWED_ACCOUNT_IDS")
            : options.AllowedAccountIds;
    }

    private static string? GetConfiguredPaymentCallbackAllowedAccountOwnerIds(PaymentCallbackOptions options)
    {
        return string.IsNullOrWhiteSpace(options.AllowedAccountOwnerIds)
            ? Environment.GetEnvironmentVariable("PAYMENT_CALLBACK_ALLOWED_ACCOUNT_OWNER_IDS")
            : options.AllowedAccountOwnerIds;
    }

    private static bool ShouldRequirePaymentCallbackAccountGrant(PaymentCallbackOptions options)
    {
        return ReadBoolOption("PAYMENT_CALLBACK_REQUIRE_ACCOUNT_GRANT", options.RequireAccountGrant);
    }

    private static string? NormalizePaymentProvider(string? value)
    {
        var provider = NormalizeBlank(value)?.ToLowerInvariant();
        if (provider is null || provider.Length > 64)
        {
            return null;
        }

        foreach (var ch in provider)
        {
            if (!char.IsAsciiLetterOrDigit(ch) && ch is not '-' and not '_')
            {
                return null;
            }
        }

        return provider;
    }
}

internal sealed class PaymentCallbackOptions
{
    public string? AllowedProviders { get; init; }

    public bool RequireAllowedProvider { get; init; }

    public string? AllowedAccountIds { get; init; }

    public string? AllowedAccountOwnerIds { get; init; }

    public bool RequireAccountGrant { get; init; }
}
