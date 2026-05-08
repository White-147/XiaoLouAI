using Npgsql;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.Auth;

public sealed class PasswordAuthPostgresIntegrationTests
{
    private const string TestConnectionStringEnvironmentVariable =
        "XIAOLOU_TEST_POSTGRES_CONNECTION_STRING";

    [Fact]
    [Trait("Category", "DbBacked")]
    public async Task PasswordAuthStore_RoundTripsAgainstExplicitTestPostgres()
    {
        var rawConnectionString = Environment.GetEnvironmentVariable(
            TestConnectionStringEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(rawConnectionString))
        {
            return;
        }

        var baseConnection = new NpgsqlConnectionStringBuilder(
            PostgresConnectionString.Normalize(rawConnectionString))
        {
            Pooling = false,
        };
        RequireTestDatabase(baseConnection);

        var schemaName = $"xl_password_auth_{Guid.NewGuid():N}";
        await using var adminDataSource = new NpgsqlDataSourceBuilder(
            baseConnection.ConnectionString).Build();
        await ExecuteNonQueryAsync(
            adminDataSource,
            $"""CREATE SCHEMA "{schemaName}";""",
            CancellationToken.None);

        var testConnection = new NpgsqlConnectionStringBuilder(baseConnection.ConnectionString)
        {
            SearchPath = schemaName,
            Pooling = false,
        };

        try
        {
            await using var dataSource = new NpgsqlDataSourceBuilder(
                testConnection.ConnectionString).Build();
            await ExecuteNonQueryAsync(
                dataSource,
                await File.ReadAllTextAsync(ResolveMigrationPath()),
                CancellationToken.None);

            var accounts = new PostgresAccountStore(dataSource);
            var identity = new PostgresIdentityConfigStore(dataSource, accounts);
            var suffix = Guid.NewGuid().ToString("N");

            var personalEmail = $"password-db-{suffix}@example.test";
            var personalPassword = $"personal-original-{suffix}";
            var changedPassword = $"personal-changed-{suffix}";
            var personal = await identity.RegisterPersonalAsync(
                new RegisterPersonalRequest
                {
                    DisplayName = "Password DB Test",
                    Email = personalEmail,
                    Password = personalPassword,
                },
                CancellationToken.None);
            var personalActorId = Assert.IsType<string>(personal["actorId"]);

            await identity.LoginWithEmailAsync(
                new LoginRequest
                {
                    Email = personalEmail,
                    Password = personalPassword,
                },
                "personal",
                CancellationToken.None);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                identity.LoginWithEmailAsync(
                    new LoginRequest
                    {
                        Email = personalEmail,
                        Password = "wrong-password",
                    },
                    "personal",
                    CancellationToken.None));

            await identity.ChangePasswordAsync(
                personalActorId,
                new ChangePasswordRequest
                {
                    CurrentPassword = personalPassword,
                    NewPassword = changedPassword,
                },
                CancellationToken.None);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                identity.LoginWithEmailAsync(
                    new LoginRequest
                    {
                        Email = personalEmail,
                        Password = personalPassword,
                    },
                    "personal",
                    CancellationToken.None));
            await identity.LoginWithEmailAsync(
                new LoginRequest
                {
                    Email = personalEmail,
                    Password = changedPassword,
                },
                "personal",
                CancellationToken.None);

            var resetEmail = $"password-reset-{suffix}@example.test";
            var resetOriginalPassword = $"reset-original-{suffix}";
            var resetNewPassword = $"reset-new-{suffix}";
            await identity.RegisterPersonalAsync(
                new RegisterPersonalRequest
                {
                    DisplayName = "Password Reset DB Test",
                    Email = resetEmail,
                    Password = resetOriginalPassword,
                },
                CancellationToken.None);
            await identity.AdminResetPasswordAsync(
                new AdminResetPasswordRequest
                {
                    Email = resetEmail,
                    NewPassword = resetNewPassword,
                },
                CancellationToken.None);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                identity.LoginWithEmailAsync(
                    new LoginRequest
                    {
                        Email = resetEmail,
                        Password = resetOriginalPassword,
                    },
                    "personal",
                    CancellationToken.None));
            await identity.LoginWithEmailAsync(
                new LoginRequest
                {
                    Email = resetEmail,
                    Password = resetNewPassword,
                },
                "personal",
                CancellationToken.None);

            var recoveryEmail = $"password-recovery-{suffix}@example.test";
            var recoveryOriginalPassword = $"recovery-original-{suffix}";
            var recoveryNewPassword = $"recovery-new-{suffix}";
            await identity.RegisterPersonalAsync(
                new RegisterPersonalRequest
                {
                    DisplayName = "Password Recovery DB Test",
                    Email = recoveryEmail,
                    Password = recoveryOriginalPassword,
                },
                CancellationToken.None);
            var resetRequest = await identity.RequestPasswordResetAsync(
                new RequestPasswordResetRequest
                {
                    Email = recoveryEmail,
                },
                includeResetToken: true,
                CancellationToken.None);
            var resetToken = Assert.IsType<string>(resetRequest["resetToken"]);
            Assert.Equal(true, resetRequest["accepted"]);
            Assert.Equal("local_token", resetRequest["delivery"]);

            await identity.CompletePasswordResetAsync(
                new CompletePasswordResetRequest
                {
                    ResetToken = resetToken,
                    NewPassword = recoveryNewPassword,
                },
                CancellationToken.None);
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                identity.CompletePasswordResetAsync(
                    new CompletePasswordResetRequest
                    {
                        ResetToken = resetToken,
                        NewPassword = "reused-token-password",
                    },
                    CancellationToken.None));
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
                identity.LoginWithEmailAsync(
                    new LoginRequest
                    {
                        Email = recoveryEmail,
                        Password = recoveryOriginalPassword,
                    },
                    "personal",
                    CancellationToken.None));
            await identity.LoginWithEmailAsync(
                new LoginRequest
                {
                    Email = recoveryEmail,
                    Password = recoveryNewPassword,
                },
                "personal",
                CancellationToken.None);

            Assert.True(await CountPasswordAuditEventsAsync(dataSource) >= 2);

            var platformPassword = $"platform-bootstrap-{suffix}";
            var bootstrap = await identity.BootstrapPlatformPasswordAsync(
                new BootstrapPlatformPasswordRequest
                {
                    Email = "ops@xiaolou.local",
                    Password = platformPassword,
                },
                CancellationToken.None);

            Assert.Equal("ops_demo_001", bootstrap["actorId"]);
            Assert.Equal("ops_admin", bootstrap["platformRole"]);
            Assert.Equal(true, bootstrap["passwordConfigured"]);
            Assert.Equal(true, bootstrap["passwordUpdated"]);
            await identity.LoginWithEmailAsync(
                new LoginRequest
                {
                    Email = "ops@xiaolou.local",
                    Password = platformPassword,
                },
                "ops_admin",
                CancellationToken.None);
        }
        finally
        {
            await ExecuteNonQueryAsync(
                adminDataSource,
                $"""DROP SCHEMA IF EXISTS "{schemaName}" CASCADE;""",
                CancellationToken.None);
        }
    }

    private static async Task<int> CountPasswordAuditEventsAsync(
        NpgsqlDataSource dataSource)
    {
        await using var connection = await dataSource.OpenConnectionAsync(CancellationToken.None);
        await using var command = new NpgsqlCommand(
            "SELECT COUNT(*) FROM password_auth_audit_events",
            connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync(CancellationToken.None));
    }

    private static void RequireTestDatabase(NpgsqlConnectionStringBuilder builder)
    {
        var database = builder.Database ?? "";
        if (database.Contains("test", StringComparison.OrdinalIgnoreCase)
            || database.Contains("synthetic", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        throw new InvalidOperationException(
            $"{TestConnectionStringEnvironmentVariable} must point to a test or synthetic database.");
    }

    private static async Task ExecuteNonQueryAsync(
        NpgsqlDataSource dataSource,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string ResolveMigrationPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        for (var depth = 0; directory is not null && depth < 10; depth++, directory = directory.Parent)
        {
            var direct = Path.Combine(
                directory.FullName,
                "db",
                "migrations",
                "20260501_windows_native_core.sql");
            if (File.Exists(direct))
            {
                return direct;
            }

            var repoRoot = Path.Combine(
                directory.FullName,
                "backend",
                "dotnet",
                "control-plane",
                "db",
                "migrations",
                "20260501_windows_native_core.sql");
            if (File.Exists(repoRoot))
            {
                return repoRoot;
            }
        }

        throw new FileNotFoundException("Could not locate the canonical PostgreSQL migration.");
    }
}
