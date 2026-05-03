using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;

namespace XiaoLou.Infrastructure.Postgres;

public static class PostgresServiceCollectionExtensions
{
    public static IServiceCollection AddXiaoLouPostgres(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        services.Configure<PostgresOptions>(configuration.GetSection("Postgres"));

        services.AddSingleton(sp =>
        {
            var options = sp.GetRequiredService<IOptions<PostgresOptions>>().Value;
            var raw = FirstNonBlank(
                    options.ConnectionString,
                    configuration.GetConnectionString("Postgres"),
                    Environment.GetEnvironmentVariable("DATABASE_URL"))
                ?? "";

            var connectionString = new NpgsqlConnectionStringBuilder(PostgresConnectionString.Normalize(raw));
            ApplyPostgresOptions(connectionString, options);

            var dataSourceBuilder = new NpgsqlDataSourceBuilder(connectionString.ConnectionString);
            return dataSourceBuilder.Build();
        });

        services.AddSingleton<PostgresSchemaMigrator>();
        services.AddSingleton<PostgresAccountStore>();
        services.AddSingleton<PostgresJobQueue>();
        services.AddSingleton<PostgresPaymentLedger>();
        services.AddSingleton<PostgresWalletStore>();
        services.AddSingleton<PostgresMediaStore>();
        services.AddSingleton<PostgresOutboxStore>();
        services.AddSingleton<PostgresProviderHealthStore>();
        services.AddSingleton<PostgresProjectSurfaceStore>();
        services.AddSingleton<PostgresIdentityConfigStore>();
        services.AddSingleton<PostgresAdminSystemStore>();
        services.AddSingleton<PostgresPlaygroundStore>();
        services.AddSingleton<PostgresToolboxStore>();
        services.AddSingleton<PostgresJobNotificationListener>();

        return services;
    }

    private static string? FirstNonBlank(params string?[] values)
    {
        return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
    }

    private static void ApplyPostgresOptions(NpgsqlConnectionStringBuilder builder, PostgresOptions options)
    {
        if (options.MinimumPoolSize is { } minimumPoolSize)
        {
            builder.MinPoolSize = Math.Max(0, minimumPoolSize);
        }

        if (options.MaximumPoolSize is { } maximumPoolSize)
        {
            builder.MaxPoolSize = Math.Max(1, maximumPoolSize);
        }

        if (options.TimeoutSeconds is { } timeoutSeconds)
        {
            builder.Timeout = Math.Max(1, timeoutSeconds);
        }

        if (options.CommandTimeoutSeconds is { } commandTimeoutSeconds)
        {
            builder.CommandTimeout = Math.Max(1, commandTimeoutSeconds);
        }

        if (options.KeepAliveSeconds is { } keepAliveSeconds)
        {
            builder.KeepAlive = Math.Max(0, keepAliveSeconds);
        }
    }
}
