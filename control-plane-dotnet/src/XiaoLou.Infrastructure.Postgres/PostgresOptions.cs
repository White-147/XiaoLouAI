namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresOptions
{
    public string? ConnectionString { get; init; }
    public bool ApplySchemaOnStartup { get; init; }
    public string MigrationFileName { get; init; } = "20260501_windows_native_core.sql";
}
