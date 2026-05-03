using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresProviderHealthStore(NpgsqlDataSource dataSource)
{
    private static readonly HashSet<string> StagedStatuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "evidence_pending",
        "pending",
        "unknown",
        "not_checked",
    };

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT * FROM provider_health ORDER BY provider, region_code, model_family",
            connection);
        var rows = await PostgresRows.ReadManyAsync(command, cancellationToken);
        foreach (var row in rows)
        {
            AddEvidenceSemantics(row);
        }

        return rows;
    }

    public async Task<Dictionary<string, object?>?> UpsertAsync(
        ProviderHealthRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO provider_health (
              provider, region_code, model_family, status, success_rate,
              p95_latency_ms, cost_score, last_error, updated_at
            )
            VALUES (
              @provider, @regionCode, @modelFamily, @status, @successRate,
              @p95LatencyMs, @costScore, @lastError, now()
            )
            ON CONFLICT (provider, region_code, model_family) DO UPDATE SET
              status = EXCLUDED.status,
              success_rate = EXCLUDED.success_rate,
              p95_latency_ms = EXCLUDED.p95_latency_ms,
              cost_score = EXCLUDED.cost_score,
              last_error = EXCLUDED.last_error,
              last_success_at = CASE WHEN EXCLUDED.status = 'healthy' THEN now() ELSE provider_health.last_success_at END,
              last_failure_at = CASE
                WHEN EXCLUDED.status IN ('degraded', 'failed', 'unhealthy') THEN now()
                ELSE provider_health.last_failure_at
              END,
              updated_at = now()
            RETURNING *
            """,
            connection);
        command.Parameters.AddWithValue("provider", NpgsqlDbType.Text, request.Provider);
        command.Parameters.AddWithValue("regionCode", NpgsqlDbType.Text, request.RegionCode);
        command.Parameters.AddWithValue("modelFamily", NpgsqlDbType.Text, request.ModelFamily);
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, request.Status);
        command.Parameters.AddWithValue("successRate", NpgsqlDbType.Numeric, (object?)request.SuccessRate ?? DBNull.Value);
        command.Parameters.AddWithValue("p95LatencyMs", NpgsqlDbType.Integer, (object?)request.P95LatencyMs ?? DBNull.Value);
        command.Parameters.AddWithValue("costScore", NpgsqlDbType.Numeric, (object?)request.CostScore ?? DBNull.Value);
        command.Parameters.AddWithValue("lastError", NpgsqlDbType.Text, (object?)request.LastError ?? DBNull.Value);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        if (row is not null)
        {
            AddEvidenceSemantics(row);
        }

        return row;
    }

    private static void AddEvidenceSemantics(Dictionary<string, object?> row)
    {
        var status = row.TryGetValue("status", out var rawStatus)
            ? Convert.ToString(rawStatus)
            : null;
        var isStaged = string.IsNullOrWhiteSpace(status) || StagedStatuses.Contains(status);
        row["evidenceKind"] = isStaged ? "staged_evidence" : "real_provider_health";
        row["isStagedEvidence"] = isStaged;
        row["isRealProviderHealth"] = !isStaged;
        row["acceptanceEvidenceRequired"] = isStaged;
        row["providerHealthSemantics"] = isStaged
            ? "Staged canonical plumbing evidence only; operator-supplied real provider health remains final acceptance evidence."
            : "Provider-reported health evidence.";
    }
}
