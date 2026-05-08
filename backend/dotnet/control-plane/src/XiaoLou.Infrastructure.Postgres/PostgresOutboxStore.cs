using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresOutboxStore(NpgsqlDataSource dataSource)
{
    public async Task<IReadOnlyList<Dictionary<string, object?>>> LeaseAsync(
        OutboxLeaseRequest request,
        CancellationToken cancellationToken)
    {
        var workerId = string.IsNullOrWhiteSpace(request.WorkerId)
            ? $"outbox-{Guid.NewGuid():N}"
            : request.WorkerId.Trim();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            WITH picked AS (
              SELECT id
              FROM outbox_events
              WHERE status = 'pending'
                AND next_attempt_at <= now()
                AND (locked_until IS NULL OR locked_until < now())
              ORDER BY created_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT @batchSize
            )
            UPDATE outbox_events AS e
            SET locked_by = @workerId,
                locked_until = now() + make_interval(secs => @leaseSeconds),
                attempts = attempts + 1,
                updated_at = now()
            FROM picked
            WHERE e.id = picked.id
            RETURNING e.*
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("workerId", NpgsqlDbType.Text, workerId);
        command.Parameters.AddWithValue("batchSize", NpgsqlDbType.Integer, Math.Clamp(request.BatchSize, 1, 100));
        command.Parameters.AddWithValue("leaseSeconds", NpgsqlDbType.Integer, Math.Max(30, request.LeaseSeconds));
        var rows = await PostgresRows.ReadManyAsync(command, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return rows;
    }

    public async Task<Dictionary<string, object?>?> CompleteAsync(
        Guid eventId,
        OutboxCompleteRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var sql = request.Published
            ? """
              UPDATE outbox_events
              SET status = 'published',
                  locked_by = NULL,
                  locked_until = NULL,
                  updated_at = now(),
                  published_at = now()
              WHERE id = @id
              RETURNING *
              """
            : """
              UPDATE outbox_events
              SET status = 'pending',
                  locked_by = NULL,
                  locked_until = NULL,
                  next_attempt_at = now() + make_interval(secs => @retryDelaySeconds),
                  payload = payload || jsonb_build_object('last_error', @error),
                  updated_at = now()
              WHERE id = @id
              RETURNING *
              """;
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, eventId);
        if (!request.Published)
        {
            command.Parameters.AddWithValue("retryDelaySeconds", NpgsqlDbType.Integer, Math.Max(30, request.RetryDelaySeconds));
            command.Parameters.AddWithValue("error", NpgsqlDbType.Text, request.Error ?? "publish failed");
        }

        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }
}
