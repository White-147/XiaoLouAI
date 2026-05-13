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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
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
            if (AuthorizeAccountScope(httpContext, clientApi.Value, scope, requireConfiguredAccountGrant: false) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await wallets.GetUsageStatsAsync(
                scope.AccountOwnerType,
                scope.AccountOwnerId,
                mode,
                ct));
        });

        endpoints.MapGet("/api/wallet/recharge-capabilities", (
            HttpContext httpContext,
            IOptions<PaymentCallbackOptions> paymentOptions) =>
        {
            return Results.Ok(BuildRechargeCapabilities(httpContext, paymentOptions.Value));
        });

        endpoints.MapPost("/api/wallet/recharge-orders", async (
            CreateWalletRechargeOrderRequest request,
            HttpRequest http,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            IOptions<PaymentCallbackOptions> paymentOptions,
            PostgresWalletStore wallets,
            PostgresPaymentLedger ledger,
            CancellationToken ct) =>
        {
            var scope = ResolvePublicOwnerScope(
                httpContext,
                request.AccountOwnerType,
                request.AccountOwnerId);
            Dictionary<string, object?>? wallet = null;
            Guid? walletAccountId = null;
            if (NormalizeBlank(request.WalletId) is { } walletId)
            {
                if (!Guid.TryParse(walletId, out var parsedWalletId))
                {
                    return RechargeInvalid("walletId must be a canonical account UUID");
                }

                wallet = await wallets.GetWalletByAccountIdAsync(parsedWalletId, ct);
                if (wallet is null)
                {
                    return Results.NotFound(new { error = "wallet not found" });
                }

                if (AuthorizeAccountRow(httpContext, clientApi.Value, wallet) is { } denied)
                {
                    return denied;
                }

                walletAccountId = parsedWalletId;
                scope = ScopeFromWallet(wallet);
            }
            else if (AuthorizeAccountScope(httpContext, clientApi.Value, scope) is { } denied)
            {
                return denied;
            }

            if (ValidateCreateRechargeOrder(request, paymentOptions.Value, httpContext) is { } invalid)
            {
                return invalid;
            }

            var actorId = ReadHeader(httpContext, "X-Actor-Id") ?? GetClientPrincipal(httpContext)?.Subject;
            var idempotencyKey = NormalizeBlank(request.IdempotencyKey)
                ?? NormalizeBlank(http.Headers["Idempotency-Key"].FirstOrDefault());
            var order = await ledger.CreateRechargeOrderAsync(
                request,
                scope,
                walletAccountId,
                actorId,
                idempotencyKey,
                ct);
            return Results.Ok(order);
        });

        endpoints.MapGet("/api/wallet/recharge-orders/{orderId:guid}", async (
            Guid orderId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPaymentLedger ledger,
            CancellationToken ct) =>
        {
            var order = await ledger.GetRechargeOrderAsync(orderId, ct);
            if (order is null)
            {
                return Results.NotFound(new { error = "wallet recharge order not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, order) is { } denied)
            {
                return denied;
            }

            return Results.Ok(order);
        });

        endpoints.MapPost("/api/wallet/recharge-orders/{orderId:guid}/refresh-status", async (
            Guid orderId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPaymentLedger ledger,
            CancellationToken ct) =>
        {
            var order = await ledger.RefreshRechargeOrderAsync(orderId, ct);
            if (order is null)
            {
                return Results.NotFound(new { error = "wallet recharge order not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, order) is { } denied)
            {
                return denied;
            }

            return Results.Ok(order);
        });

        endpoints.MapPost("/api/wallet/recharge-orders/{orderId:guid}/bank-transfer-proof", async (
            Guid orderId,
            WalletRechargeTransferProofRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPaymentLedger ledger,
            CancellationToken ct) =>
        {
            if (ValidateTransferProof(request) is { } invalid)
            {
                return invalid;
            }

            var order = await ledger.GetRechargeOrderAsync(orderId, ct);
            if (order is null)
            {
                return Results.NotFound(new { error = "wallet recharge order not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, order) is { } denied)
            {
                return denied;
            }

            if (!string.Equals(ReadOrderString(order, "paymentMethod"), "bank_transfer", StringComparison.Ordinal))
            {
                return RechargeInvalid("bank-transfer-proof is only supported for bank_transfer orders");
            }

            if (string.Equals(ReadOrderString(order, "status"), "paid", StringComparison.Ordinal))
            {
                return Results.Conflict(new
                {
                    error = "wallet recharge order is already paid",
                    order,
                });
            }

            if (string.Equals(ReadOrderString(order, "status"), "failed", StringComparison.Ordinal)
                || string.Equals(ReadOrderString(order, "reviewStatus"), "rejected", StringComparison.Ordinal))
            {
                return Results.Conflict(new
                {
                    error = "rejected bank transfer orders cannot accept new proof; create a new recharge order",
                    order,
                });
            }

            var submitted = await ledger.SubmitBankTransferProofAsync(orderId, request, ct);
            return submitted is null
                ? Results.NotFound(new { error = "wallet recharge order not found" })
                : Results.Ok(submitted);
        });

        endpoints.MapPost("/api/wallet/recharge-orders/{orderId:guid}/confirm", async (
            Guid orderId,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresPaymentLedger ledger,
            CancellationToken ct) =>
        {
            var order = await ledger.GetRechargeOrderAsync(orderId, ct);
            if (order is null)
            {
                return Results.NotFound(new { error = "wallet recharge order not found" });
            }

            if (AuthorizeAccountRow(httpContext, clientApi.Value, order) is { } denied)
            {
                return denied;
            }

            if (!string.Equals(ReadOrderString(order, "mode"), "demo_mock", StringComparison.Ordinal))
            {
                return Results.Conflict(new
                {
                    error = "live wallet recharge orders can only become paid through a signed provider callback or I4h admin review",
                    order,
                });
            }

            var actorId = ReadHeader(httpContext, "X-Actor-Id") ?? GetClientPrincipal(httpContext)?.Subject;
            var confirmed = await ledger.ConfirmDemoRechargeOrderAsync(orderId, actorId, ct);
            return confirmed.TryGetValue("error", out var error) && error is not null
                ? Results.Conflict(confirmed)
                : Results.Ok(confirmed);
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

        return endpoints;
    }

    private static object BuildRechargeCapabilities(HttpContext httpContext, PaymentCallbackOptions options)
    {
        var host = NormalizeBlank(httpContext.Request.Host.Value);
        var demoMockAvailable = IsDemoMockRechargeAllowed(httpContext, options);
        var demoMockReason = demoMockAvailable
            ? null
            : "demo mock recharge is limited to loopback/local development or explicit Payments configuration";
        var providerUnavailableReason =
            "live provider order creation is not configured in I4g; paid provider orders must settle through signed callbacks";
        var bankTransferAvailable = IsBankTransferConfigured(options);
        var bankTransferReason = bankTransferAvailable
            ? "bank transfer proof can be submitted; admin review and credit posting stay in I4h"
            : "bank transfer account configuration is required before enabling proof submission";

        return new
        {
            requestHost = host,
            demoMockEnabled = demoMockAvailable,
            demoMockAllowedHosts = new[] { "localhost", "127.0.0.1", "::1" },
            methods = new object[]
            {
                new
                {
                    paymentMethod = "wechat_pay",
                    label = "WeChat Pay",
                    detail = "WeChat live checkout awaits a provider adapter; demo mock is local-only.",
                    live = new
                    {
                        available = false,
                        reason = providerUnavailableReason,
                        scenes = Array.Empty<string>(),
                    },
                    demoMock = new
                    {
                        available = demoMockAvailable,
                        reason = demoMockReason,
                        scenes = demoMockAvailable ? new[] { "desktop_qr" } : Array.Empty<string>(),
                    },
                },
                new
                {
                    paymentMethod = "alipay",
                    label = "Alipay",
                    detail = "Alipay live checkout awaits a provider adapter; demo mock is local-only.",
                    live = new
                    {
                        available = false,
                        reason = providerUnavailableReason,
                        scenes = Array.Empty<string>(),
                    },
                    demoMock = new
                    {
                        available = demoMockAvailable,
                        reason = demoMockReason,
                        scenes = demoMockAvailable ? new[] { "pc_page" } : Array.Empty<string>(),
                    },
                },
                new
                {
                    paymentMethod = "bank_transfer",
                    label = "Bank transfer",
                    detail = "Bank transfer can collect proof only; admin review is the I4h owner.",
                    live = new
                    {
                        available = bankTransferAvailable,
                        reason = bankTransferReason,
                        scenes = bankTransferAvailable ? new[] { "bank_transfer" } : Array.Empty<string>(),
                    },
                    demoMock = new
                    {
                        available = false,
                        reason = "bank transfer uses live proof submission and I4h admin review, not demo confirm",
                        scenes = Array.Empty<string>(),
                    },
                    bankAccount = bankTransferAvailable ? BuildBankTransferAccount(options, null) : null,
                },
            },
        };
    }

    private static IResult? ValidateCreateRechargeOrder(
        CreateWalletRechargeOrderRequest request,
        PaymentCallbackOptions options,
        HttpContext httpContext)
    {
        var paymentMethod = NormalizeRechargePaymentMethod(request.PaymentMethod);
        if (paymentMethod is null)
        {
            return RechargeInvalid("paymentMethod must be wechat_pay, alipay, or bank_transfer");
        }

        if (request.Amount <= 0)
        {
            return RechargeInvalid("amount must be greater than 0");
        }

        if (request.Credits <= 0)
        {
            return RechargeInvalid("credits must be greater than 0");
        }

        var mode = NormalizeRechargeMode(request.Mode)
            ?? (paymentMethod == "bank_transfer" ? "live" : "demo_mock");
        var scene = NormalizeRechargeScene(request.Scene)
            ?? DefaultRechargeScene(paymentMethod, mode);
        if (!IsRechargeSceneSupported(paymentMethod, mode, scene))
        {
            return RechargeInvalid("scene is not supported for this payment method and mode");
        }

        if (mode == "demo_mock")
        {
            if (!IsDemoMockRechargeAllowed(httpContext, options))
            {
                return Results.Json(
                    new { error = "demo mock recharge is not available for this request context" },
                    statusCode: StatusCodes.Status403Forbidden);
            }

            if (paymentMethod == "bank_transfer")
            {
                return RechargeInvalid("bank_transfer does not support demo_mock confirm");
            }

            return null;
        }

        if (paymentMethod == "bank_transfer")
        {
            if (!IsBankTransferConfigured(options))
            {
                return Results.Json(
                    new { error = "bank transfer account configuration is required before creating transfer orders" },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            return null;
        }

        return Results.Json(
            new { error = "live provider order creation is not configured; paid state must come from signed payment callbacks" },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    private static IResult? ValidateTransferProof(WalletRechargeTransferProofRequest request)
    {
        var files = request.VoucherFiles?
            .Select(NormalizeBlank)
            .Where(item => item is not null)
            .Cast<string>()
            .ToArray();
        if (files is null || files.Length == 0)
        {
            return RechargeInvalid("voucherFiles must include at least one proof file URL");
        }

        if (files.Length > 20)
        {
            return RechargeInvalid("voucherFiles cannot include more than 20 files");
        }

        return null;
    }

    private static IResult RechargeInvalid(string message)
    {
        return Results.BadRequest(new
        {
            error = new
            {
                code = "WALLET_RECHARGE_INVALID_REQUEST",
                message,
            },
        });
    }

    private static AccountScope ScopeFromWallet(Dictionary<string, object?> wallet)
    {
        return new AccountScope
        {
            AccountId = TryReadRowString(wallet, "account_id"),
            AccountOwnerType = NormalizeOwnerType(TryReadRowString(wallet, "account_owner_type")) ?? "user",
            AccountOwnerId = NormalizeBlank(TryReadRowString(wallet, "account_owner_id")) ?? "guest",
            RegionCode = "CN",
            Currency = NormalizeBlank(TryReadRowString(wallet, "currency")) ?? "CNY",
        };
    }

    private static string? ReadOrderString(Dictionary<string, object?> order, string key)
    {
        return order.TryGetValue(key, out var value) ? value?.ToString() : null;
    }

    private static bool IsDemoMockRechargeAllowed(HttpContext httpContext, PaymentCallbackOptions options)
    {
        if (ReadBoolOption("PAYMENTS_ENABLE_DEMO_MOCK_RECHARGE", options.EnableDemoMockRecharge))
        {
            return true;
        }

        var host = NormalizeBlank(httpContext.Request.Host.Host)
            ?? NormalizeBlank(httpContext.Request.Host.Value);
        return host is "localhost" or "127.0.0.1" or "::1";
    }

    private static bool IsBankTransferConfigured(PaymentCallbackOptions options)
    {
        return NormalizeBlank(GetPaymentOption(
                options.BankTransferAccountName,
                "PAYMENTS_BANK_TRANSFER_ACCOUNT_NAME")) is not null
            && NormalizeBlank(GetPaymentOption(
                options.BankTransferBankName,
                "PAYMENTS_BANK_TRANSFER_BANK_NAME")) is not null
            && NormalizeBlank(GetPaymentOption(
                options.BankTransferAccountNo,
                "PAYMENTS_BANK_TRANSFER_ACCOUNT_NO")) is not null;
    }

    internal static object? BuildBankTransferAccount(PaymentCallbackOptions options, string? merchantOrderNo)
    {
        if (!IsBankTransferConfigured(options))
        {
            return null;
        }

        var remarkTemplate = NormalizeBlank(GetPaymentOption(
                options.BankTransferRemarkTemplate,
                "PAYMENTS_BANK_TRANSFER_REMARK_TEMPLATE"))
            ?? "XL-{merchantOrderNo}";
        return new
        {
            accountName = NormalizeBlank(GetPaymentOption(
                options.BankTransferAccountName,
                "PAYMENTS_BANK_TRANSFER_ACCOUNT_NAME")),
            bankName = NormalizeBlank(GetPaymentOption(
                options.BankTransferBankName,
                "PAYMENTS_BANK_TRANSFER_BANK_NAME")),
            accountNo = NormalizeBlank(GetPaymentOption(
                options.BankTransferAccountNo,
                "PAYMENTS_BANK_TRANSFER_ACCOUNT_NO")),
            branchName = NormalizeBlank(GetPaymentOption(
                options.BankTransferBranchName,
                "PAYMENTS_BANK_TRANSFER_BRANCH_NAME")),
            remarkTemplate = merchantOrderNo is null
                ? remarkTemplate
                : remarkTemplate.Replace("{merchantOrderNo}", merchantOrderNo, StringComparison.Ordinal),
            instructions = NormalizeBlank(GetPaymentOption(
                    options.BankTransferInstructions,
                    "PAYMENTS_BANK_TRANSFER_INSTRUCTIONS"))
                ?? "Transfer, upload proof, then wait for I4h admin review before credits are posted.",
        };
    }

    private static string? GetPaymentOption(string? configured, string envName)
    {
        return string.IsNullOrWhiteSpace(configured)
            ? Environment.GetEnvironmentVariable(envName)
            : configured;
    }

    internal static string? NormalizeRechargePaymentMethod(string? value)
    {
        var method = NormalizeBlank(value)?.ToLowerInvariant();
        return method is "wechat_pay" or "wechat" or "alipay" or "bank_transfer"
            ? (method == "wechat" ? "wechat_pay" : method)
            : null;
    }

    internal static string? NormalizeRechargeMode(string? value)
    {
        var mode = NormalizeBlank(value)?.ToLowerInvariant();
        return mode is "live" or "demo_mock" ? mode : null;
    }

    internal static string? NormalizeRechargeScene(string? value)
    {
        var scene = NormalizeBlank(value)?.ToLowerInvariant();
        return scene is "desktop_qr" or "mobile_h5" or "pc_page" or "mobile_wap" or "bank_transfer"
            ? scene
            : null;
    }

    internal static string DefaultRechargeScene(string paymentMethod, string mode)
    {
        return paymentMethod switch
        {
            "wechat_pay" => "desktop_qr",
            "alipay" => mode == "demo_mock" ? "pc_page" : "pc_page",
            "bank_transfer" => "bank_transfer",
            _ => "desktop_qr",
        };
    }

    internal static bool IsRechargeSceneSupported(string paymentMethod, string mode, string scene)
    {
        return paymentMethod switch
        {
            "wechat_pay" => mode == "demo_mock"
                ? scene == "desktop_qr"
                : scene is "desktop_qr" or "mobile_h5",
            "alipay" => scene is "pc_page" or "mobile_wap",
            "bank_transfer" => mode == "live" && scene == "bank_transfer",
            _ => false,
        };
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

    public bool EnableDemoMockRecharge { get; init; }

    public string? BankTransferAccountName { get; init; }

    public string? BankTransferBankName { get; init; }

    public string? BankTransferAccountNo { get; init; }

    public string? BankTransferBranchName { get; init; }

    public string? BankTransferRemarkTemplate { get; init; }

    public string? BankTransferInstructions { get; init; }
}
