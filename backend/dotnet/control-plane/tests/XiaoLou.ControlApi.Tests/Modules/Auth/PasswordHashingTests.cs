using XiaoLou.Infrastructure.Postgres;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.Auth;

public sealed class PasswordHashingTests
{
    [Fact]
    public void HashPassword_StoresVersionedPbkdf2HashWithoutPlaintext()
    {
        var hash = PasswordHashing.HashPassword("synthetic-password");

        Assert.StartsWith("pbkdf2-sha256:v1:", hash, StringComparison.Ordinal);
        Assert.DoesNotContain("synthetic-password", hash, StringComparison.Ordinal);
        Assert.True(PasswordHashing.VerifyPassword("synthetic-password", hash));
    }

    [Fact]
    public void VerifyPassword_RejectsWrongOrTamperedHashes()
    {
        var hash = PasswordHashing.HashPassword("correct-password");
        var parts = hash.Split(':');
        parts[^1] = (parts[^1][0] == 'A' ? 'B' : 'A') + parts[^1][1..];
        var tampered = string.Join(':', parts);

        Assert.False(PasswordHashing.VerifyPassword("wrong-password", hash));
        Assert.False(PasswordHashing.VerifyPassword("correct-password", tampered));
        Assert.False(PasswordHashing.VerifyPassword("correct-password", ""));
        Assert.False(PasswordHashing.VerifyPassword("correct-password", "sha256:legacy"));
    }

    [Fact]
    public void GenerateTemporaryPassword_ReturnsLoginableNonBlankPassword()
    {
        var password = PasswordHashing.GenerateTemporaryPassword();

        Assert.True(password.Length >= 16);
        Assert.False(string.IsNullOrWhiteSpace(password));
        Assert.True(PasswordHashing.VerifyPassword(password, PasswordHashing.HashPassword(password)));
    }
}
