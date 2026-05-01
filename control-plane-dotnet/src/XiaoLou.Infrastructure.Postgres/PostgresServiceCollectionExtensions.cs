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
            var raw = options.ConnectionString
                ?? configuration.GetConnectionString("Postgres")
                ?? Environment.GetEnvironmentVariable("DATABASE_URL")
                ?? "";

            var builder = new NpgsqlDataSourceBuilder(PostgresConnectionString.Normalize(raw));
            return builder.Build();
        });

        services.AddSingleton<PostgresSchemaMigrator>();
        services.AddSingleton<PostgresAccountStore>();
        services.AddSingleton<PostgresJobQueue>();
        services.AddSingleton<PostgresPaymentLedger>();
        services.AddSingleton<PostgresMediaStore>();
        services.AddSingleton<PostgresOutboxStore>();
        services.AddSingleton<PostgresProviderHealthStore>();
        services.AddSingleton<PostgresJobNotificationListener>();

        return services;
    }
}
