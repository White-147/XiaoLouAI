using XiaoLou.Domain;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresJobQueue(NpgsqlDataSource dataSource, PostgresAccountStore accounts)
{
    public async Task<Dictionary<string, object?>?> CreateJobAsync(
        CreateJobRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, request, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(
            connection,
            transaction,
            accountId,
            AccountLanes.Control,
            cancellationToken);

        var lane = AccountLanes.Normalize(request.Lane, AccountLanes.Media);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO jobs (
              account_id, created_by_user_id, lane, job_type, provider_route,
              idempotency_key, payload, priority, max_attempts, timeout_seconds, run_after
            )
            VALUES (
              @accountId, @createdByUserId, @lane, @jobType, @providerRoute,
              @idempotencyKey, CAST(@payload AS jsonb), @priority, @maxAttempts, @timeoutSeconds, @runAfter
            )
            ON CONFLICT (account_id, lane, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            DO UPDATE SET updated_at = jobs.updated_at
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("createdByUserId", NpgsqlDbType.Text, (object?)request.CreatedByUserId ?? DBNull.Value);
        command.Parameters.AddWithValue("lane", NpgsqlDbType.Text, lane);
        command.Parameters.AddWithValue("jobType", NpgsqlDbType.Text, string.IsNullOrWhiteSpace(request.JobType) ? "generic" : request.JobType.Trim());
        command.Parameters.AddWithValue("providerRoute", NpgsqlDbType.Text, (object?)request.ProviderRoute ?? DBNull.Value);
        command.Parameters.AddWithValue("idempotencyKey", NpgsqlDbType.Text, (object?)request.IdempotencyKey ?? DBNull.Value);
        command.Parameters.AddWithValue("payload", NpgsqlDbType.Jsonb, Jsonb.From(request.Payload));
        command.Parameters.AddWithValue("priority", NpgsqlDbType.Integer, request.Priority);
        command.Parameters.AddWithValue("maxAttempts", NpgsqlDbType.Integer, Math.Max(1, request.MaxAttempts));
        command.Parameters.AddWithValue("timeoutSeconds", NpgsqlDbType.Integer, Math.Max(1, request.TimeoutSeconds));
        command.Parameters.AddWithValue("runAfter", NpgsqlDbType.TimestampTz, request.RunAfter ?? DateTimeOffset.UtcNow);

        var job = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        if (job is not null)
        {
            await InsertOutboxAsync(connection, transaction, "job", job["id"]?.ToString() ?? "", "job.created", cancellationToken);
            await NotifyJobAsync(connection, transaction, job, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return job;
    }

    public async Task<Dictionary<string, object?>?> GetJobAsync(Guid jobId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT
              j.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id
            FROM jobs j
            JOIN accounts a ON a.id = j.account_id
            WHERE j.id = @id
            """,
            connection);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, jobId);
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListJobsAsync(
        Guid? accountId,
        string? accountOwnerType,
        string? accountOwnerId,
        string? lane,
        string? status,
        int limit,
        CancellationToken cancellationToken)
    {
        var filters = new List<string>();
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand { Connection = connection };

        if (accountId is not null)
        {
            filters.Add("j.account_id = @accountId");
            command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId.Value);
        }
        else if (!string.IsNullOrWhiteSpace(accountOwnerId))
        {
            filters.Add("a.legacy_owner_type = @accountOwnerType");
            filters.Add("a.legacy_owner_id = @accountOwnerId");
            command.Parameters.AddWithValue(
                "accountOwnerType",
                NpgsqlDbType.Text,
                string.IsNullOrWhiteSpace(accountOwnerType) ? "user" : accountOwnerType.Trim().ToLowerInvariant());
            command.Parameters.AddWithValue("accountOwnerId", NpgsqlDbType.Text, accountOwnerId.Trim());
        }

        if (!string.IsNullOrWhiteSpace(lane))
        {
            filters.Add("j.lane = @lane");
            command.Parameters.AddWithValue("lane", NpgsqlDbType.Text, AccountLanes.Normalize(lane));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            filters.Add("j.status = CAST(@status AS job_status)");
            command.Parameters.AddWithValue("status", NpgsqlDbType.Text, status.Trim());
        }

        command.Parameters.AddWithValue("limit", NpgsqlDbType.Integer, Math.Clamp(limit, 1, 200));
        var where = filters.Count == 0 ? "" : $"WHERE {string.Join(" AND ", filters)}";
        command.CommandText =
            $"""
            SELECT
              j.*,
              a.legacy_owner_type AS account_owner_type,
              a.legacy_owner_id AS account_owner_id
            FROM jobs j
            JOIN accounts a ON a.id = j.account_id
            {where}
            ORDER BY j.created_at DESC
            LIMIT @limit
            """;
        return await PostgresRows.ReadManyAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> LeaseJobsAsync(
        LeaseJobsRequest request,
        CancellationToken cancellationToken)
    {
        var lane = AccountLanes.Normalize(request.Lane, AccountLanes.Media);
        var providerRoute = string.IsNullOrWhiteSpace(request.ProviderRoute)
            ? null
            : request.ProviderRoute.Trim();
        var workerId = string.IsNullOrWhiteSpace(request.WorkerId)
            ? $"worker-{Guid.NewGuid():N}"
            : request.WorkerId.Trim();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            WITH candidates AS MATERIALIZED (
              SELECT DISTINCT ON (j.account_id, j.lane)
                j.id,
                j.account_id,
                j.lane,
                j.priority,
                j.run_after,
                j.created_at
              FROM jobs j
              WHERE j.lane = @lane
                AND (@providerRoute IS NULL OR j.provider_route = @providerRoute)
                AND j.status IN ('queued', 'retry_waiting')
                AND j.run_after <= now()
                AND NOT EXISTS (
                  SELECT 1
                  FROM jobs active
                  WHERE active.account_id = j.account_id
                    AND active.lane = j.lane
                    AND active.id <> j.id
                    AND active.status IN ('leased', 'running')
                    AND (active.lease_until IS NULL OR active.lease_until > now())
                )
              ORDER BY j.account_id, j.lane, j.priority DESC, j.run_after ASC, j.created_at ASC
            ),
            locked_candidates AS MATERIALIZED (
              SELECT c.id, c.priority, c.run_after, c.created_at
              FROM candidates c
              WHERE xiaolou_try_lock_account_lane(c.account_id, c.lane)
              ORDER BY c.priority DESC, c.run_after ASC, c.created_at ASC
              LIMIT @batchSize
            ),
            picked AS (
              SELECT j.id
              FROM jobs j
              JOIN locked_candidates c ON c.id = j.id
              ORDER BY c.priority DESC, c.run_after ASC, c.created_at ASC
              FOR UPDATE OF j SKIP LOCKED
            )
            UPDATE jobs AS j
            SET status = 'leased',
                lease_owner = @workerId,
                lease_until = now() + make_interval(secs => @leaseSeconds),
                updated_at = now()
            FROM picked
            WHERE j.id = picked.id
            RETURNING j.*
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("lane", NpgsqlDbType.Text, lane);
        command.Parameters.AddWithValue("providerRoute", NpgsqlDbType.Text, (object?)providerRoute ?? DBNull.Value);
        command.Parameters.AddWithValue("workerId", NpgsqlDbType.Text, workerId);
        command.Parameters.AddWithValue("batchSize", NpgsqlDbType.Integer, Math.Clamp(request.BatchSize, 1, 50));
        command.Parameters.AddWithValue("leaseSeconds", NpgsqlDbType.Integer, Math.Max(30, request.LeaseSeconds));
        var jobs = await PostgresRows.ReadManyAsync(command, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return jobs;
    }

    public Task<Dictionary<string, object?>?> MarkRunningAsync(Guid jobId, string? workerId, CancellationToken cancellationToken)
    {
        return MutateJobAsync(
            jobId,
            async (connection, transaction, job) =>
            {
                var attemptNo = Convert.ToInt32(job["attempt_count"] ?? 0) + 1;
                await using var update = new NpgsqlCommand(
                    """
                    UPDATE jobs
                    SET status = 'running',
                        attempt_count = @attemptNo,
                        lease_owner = COALESCE(@workerId, lease_owner),
                        lease_until = now() + make_interval(secs => timeout_seconds),
                        updated_at = now()
                    WHERE id = @jobId
                    RETURNING *
                    """,
                    connection,
                    transaction);
                update.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
                update.Parameters.AddWithValue("attemptNo", NpgsqlDbType.Integer, attemptNo);
                update.Parameters.AddWithValue("workerId", NpgsqlDbType.Text, (object?)workerId ?? DBNull.Value);
                var updated = await PostgresRows.ReadSingleAsync(update, cancellationToken);

                await using var attempt = new NpgsqlCommand(
                    """
                    INSERT INTO job_attempts (job_id, attempt_no, worker_id, status, heartbeat_at)
                    VALUES (@jobId, @attemptNo, COALESCE(@workerId, 'worker'), 'running', now())
                    ON CONFLICT (job_id, attempt_no) DO UPDATE SET
                      worker_id = EXCLUDED.worker_id,
                      status = 'running',
                      heartbeat_at = now()
                    """,
                    connection,
                    transaction);
                attempt.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
                attempt.Parameters.AddWithValue("attemptNo", NpgsqlDbType.Integer, attemptNo);
                attempt.Parameters.AddWithValue("workerId", NpgsqlDbType.Text, (object?)workerId ?? DBNull.Value);
                await attempt.ExecuteNonQueryAsync(cancellationToken);
                return updated;
            },
            cancellationToken);
    }

    public async Task<Dictionary<string, object?>?> HeartbeatAsync(
        Guid jobId,
        string workerId,
        int leaseSeconds,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE jobs
            SET lease_until = now() + make_interval(secs => @leaseSeconds),
                updated_at = now()
            WHERE id = @jobId
              AND lease_owner = @workerId
              AND status IN ('leased', 'running')
            RETURNING *
            """,
            connection);
        command.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
        command.Parameters.AddWithValue("workerId", NpgsqlDbType.Text, workerId);
        command.Parameters.AddWithValue("leaseSeconds", NpgsqlDbType.Integer, Math.Max(30, leaseSeconds));
        return await PostgresRows.ReadSingleAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListAttemptsAsync(
        Guid jobId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT * FROM job_attempts WHERE job_id = @jobId ORDER BY attempt_no ASC",
            connection);
        command.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
        return await PostgresRows.ReadManyAsync(command, cancellationToken);
    }

    public Task<Dictionary<string, object?>?> SucceedAsync(
        Guid jobId,
        string resultJson,
        CancellationToken cancellationToken)
    {
        return MutateJobAsync(
            jobId,
            async (connection, transaction, _) =>
            {
                await using var update = new NpgsqlCommand(
                    """
                    UPDATE jobs
                    SET status = 'succeeded',
                        result = CAST(@result AS jsonb),
                        lease_owner = NULL,
                        lease_until = NULL,
                        completed_at = now(),
                        updated_at = now()
                    WHERE id = @jobId
                    RETURNING *
                    """,
                    connection,
                    transaction);
                update.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
                update.Parameters.AddWithValue("result", NpgsqlDbType.Jsonb, Jsonb.EmptyIfBlank(resultJson));
                var updated = await PostgresRows.ReadSingleAsync(update, cancellationToken);
                await MarkAttemptsAsync(connection, transaction, jobId, "succeeded", null, cancellationToken);
                return updated;
            },
            cancellationToken);
    }

    public Task<Dictionary<string, object?>?> FailOrRetryAsync(
        Guid jobId,
        string error,
        bool retry,
        int? retryDelaySeconds,
        CancellationToken cancellationToken)
    {
        return MutateJobAsync(
            jobId,
            async (connection, transaction, job) =>
            {
                var attempts = Convert.ToInt32(job["attempt_count"] ?? 0);
                var maxAttempts = Convert.ToInt32(job["max_attempts"] ?? 1);
                var shouldRetry = retry && attempts < maxAttempts;
                var status = shouldRetry ? JobStatuses.RetryWaiting : JobStatuses.Failed;
                var delaySeconds = retryDelaySeconds ?? Math.Min(3600, Math.Max(30, attempts * 30));

                await using var update = new NpgsqlCommand(
                    """
                    UPDATE jobs
                    SET status = CAST(@status AS job_status),
                        last_error = @error,
                        lease_owner = NULL,
                        lease_until = NULL,
                        run_after = CASE
                          WHEN @status = 'retry_waiting' THEN now() + make_interval(secs => @delaySeconds)
                          ELSE run_after
                        END,
                        completed_at = CASE WHEN @status = 'failed' THEN now() ELSE completed_at END,
                        updated_at = now()
                    WHERE id = @jobId
                    RETURNING *
                    """,
                    connection,
                    transaction);
                update.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
                update.Parameters.AddWithValue("status", NpgsqlDbType.Text, status);
                update.Parameters.AddWithValue("error", NpgsqlDbType.Text, error);
                update.Parameters.AddWithValue("delaySeconds", NpgsqlDbType.Integer, delaySeconds);
                var updated = await PostgresRows.ReadSingleAsync(update, cancellationToken);
                await MarkAttemptsAsync(connection, transaction, jobId, status, error, cancellationToken);
                return updated;
            },
            cancellationToken);
    }

    public Task<Dictionary<string, object?>?> CancelAsync(
        Guid jobId,
        CancelJobRequest request,
        CancellationToken cancellationToken)
    {
        return MutateJobAsync(
            jobId,
            async (connection, transaction, job) =>
            {
                var accountId = (Guid)job["account_id"]!;
                await PostgresAccountStore.LockAccountLaneAsync(
                    connection,
                    transaction,
                    accountId,
                    AccountLanes.Control,
                    cancellationToken);

                await using var update = new NpgsqlCommand(
                    """
                    UPDATE jobs
                    SET status = 'cancelled',
                        last_error = @reason,
                        lease_owner = NULL,
                        lease_until = NULL,
                        cancelled_at = now(),
                        updated_at = now()
                    WHERE id = @jobId
                    RETURNING *
                    """,
                    connection,
                    transaction);
                update.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
                update.Parameters.AddWithValue("reason", NpgsqlDbType.Text, request.Reason ?? "cancelled");
                return await PostgresRows.ReadSingleAsync(update, cancellationToken);
            },
            cancellationToken);
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> RecoverExpiredLeasesAsync(CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            WITH expired AS (
              SELECT *
              FROM jobs
              WHERE status IN ('leased', 'running')
                AND lease_until IS NOT NULL
                AND lease_until < now()
              FOR UPDATE
            ),
            updated AS (
              UPDATE jobs AS j
              SET status = CASE
                    WHEN j.attempt_count >= j.max_attempts THEN 'failed'::job_status
                    ELSE 'retry_waiting'::job_status
                  END,
                  last_error = COALESCE(NULLIF(j.last_error, ''), 'lease expired'),
                  lease_owner = NULL,
                  lease_until = NULL,
                  run_after = now(),
                  completed_at = CASE
                    WHEN j.attempt_count >= j.max_attempts THEN now()
                    ELSE j.completed_at
                  END,
                  updated_at = now()
              FROM expired e
              WHERE j.id = e.id
              RETURNING j.*
            ),
            attempts AS (
              UPDATE job_attempts AS ja
              SET status = updated.status::text,
                  error = COALESCE(NULLIF(ja.error, ''), COALESCE(updated.last_error, 'lease expired')),
                  heartbeat_at = COALESCE(ja.heartbeat_at, now()),
                  finished_at = now()
              FROM updated
              WHERE ja.job_id = updated.id
                AND ja.status = 'running'
              RETURNING ja.job_id
            )
            SELECT *
            FROM updated
            ORDER BY updated_at, created_at
            """,
            connection,
            transaction);
        var recovered = await PostgresRows.ReadManyAsync(command, cancellationToken);
        foreach (var job in recovered)
        {
            await NotifyJobAsync(connection, transaction, job, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return recovered;
    }

    private async Task<Dictionary<string, object?>?> MutateJobAsync(
        Guid jobId,
        Func<NpgsqlConnection, NpgsqlTransaction, Dictionary<string, object?>, Task<Dictionary<string, object?>?>> mutation,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var select = new NpgsqlCommand("SELECT * FROM jobs WHERE id = @jobId FOR UPDATE", connection, transaction);
        select.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
        var job = await PostgresRows.ReadSingleAsync(select, cancellationToken);
        if (job is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var updated = await mutation(connection, transaction, job);
        if (updated is not null)
        {
            await NotifyJobAsync(connection, transaction, updated, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return updated;
    }

    private static async Task MarkAttemptsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid jobId,
        string status,
        string? error,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            UPDATE job_attempts
            SET status = @status, error = @error, finished_at = now()
            WHERE job_id = @jobId AND status = 'running'
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("jobId", NpgsqlDbType.Uuid, jobId);
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, status);
        command.Parameters.AddWithValue("error", NpgsqlDbType.Text, (object?)error ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task InsertOutboxAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string aggregateType,
        string aggregateId,
        string eventType,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
            VALUES (@aggregateType, @aggregateId, @eventType, jsonb_build_object('aggregate_id', @aggregateId))
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("aggregateType", NpgsqlDbType.Text, aggregateType);
        command.Parameters.AddWithValue("aggregateId", NpgsqlDbType.Text, aggregateId);
        command.Parameters.AddWithValue("eventType", NpgsqlDbType.Text, eventType);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task NotifyJobAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Dictionary<string, object?> job,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT pg_notify(
              'xiaolou_jobs',
              json_build_object(
                'job_id', @jobId,
                'account_id', @accountId,
                'lane', @lane,
                'status', @status
              )::text
            )
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("jobId", NpgsqlDbType.Text, job["id"]?.ToString() ?? "");
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Text, job["account_id"]?.ToString() ?? "");
        command.Parameters.AddWithValue("lane", NpgsqlDbType.Text, job["lane"]?.ToString() ?? "");
        command.Parameters.AddWithValue("status", NpgsqlDbType.Text, job["status"]?.ToString() ?? "");
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
