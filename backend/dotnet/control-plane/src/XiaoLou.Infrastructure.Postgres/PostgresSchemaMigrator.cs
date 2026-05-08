using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresSchemaMigrator(
    NpgsqlDataSource dataSource,
    IHostEnvironment environment,
    IOptions<PostgresOptions> options,
    ILogger<PostgresSchemaMigrator> logger)
{
    public async Task ApplyAsync(CancellationToken cancellationToken)
    {
        var sql = await File.ReadAllTextAsync(ResolveMigrationPath(), cancellationToken);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
        logger.LogInformation("Applied XiaoLouAI PostgreSQL canonical schema.");
    }

    private string ResolveMigrationPath()
    {
        var fileName = options.Value.MigrationFileName;
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "db", "migrations", fileName),
            Path.Combine(environment.ContentRootPath, "db", "migrations", fileName),
            Path.Combine(environment.ContentRootPath, "..", "..", "db", "migrations", fileName),
            Path.Combine(environment.ContentRootPath, "..", "..", "..", "db", "migrations", fileName),
        };

        foreach (var candidate in candidates.Select(Path.GetFullPath))
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException($"Migration file not found: {fileName}");
    }
}
