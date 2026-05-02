using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace XiaoLou.Infrastructure.Postgres;

public interface IPaymentSignatureVerifier
{
    bool Verify(string provider, string rawBody, string? signature);
}

public sealed class HmacPaymentSignatureVerifier(IConfiguration configuration) : IPaymentSignatureVerifier
{
    public bool Verify(string provider, string rawBody, string? signature)
    {
        // Sandbox/stub verifier for normalized replay payloads. Real Alipay or
        // WeChat callbacks must pass provider-specific verification/decryption
        // before they reach ledger processing.
        var secret = configuration[$"Payments:{provider}:WebhookSecret"]
            ?? configuration["Payments:WebhookSecret"];

        if (string.IsNullOrWhiteSpace(secret))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(signature))
        {
            return false;
        }

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var expected = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(rawBody))).ToLowerInvariant();
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(signature.Trim().ToLowerInvariant()));
    }
}
