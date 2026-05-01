using XiaoLou.Domain;
using XiaoLou.Infrastructure.Storage;
using Npgsql;
using NpgsqlTypes;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresMediaStore(
    NpgsqlDataSource dataSource,
    PostgresAccountStore accounts,
    IObjectStorageSigner signer)
{
    public async Task<Dictionary<string, object?>> BeginUploadAsync(
        UploadBeginRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, request, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Media, cancellationToken);

        var bucket = string.IsNullOrWhiteSpace(request.Bucket) ? "xiaolou-prod" : request.Bucket.Trim();
        var objectKey = string.IsNullOrWhiteSpace(request.ObjectKey)
            ? $"temp/{accountId:N}/{Guid.NewGuid():N}"
            : request.ObjectKey.Trim().Replace('\\', '/');
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(request.ExpiresInSeconds, 60, 3600));

        await using var command = new NpgsqlCommand(
            """
            WITH media AS (
              INSERT INTO media_objects (
                account_id, bucket, object_key, media_type, content_type, byte_size,
                checksum_sha256, status, data_sensitivity, data, created_at, updated_at
              )
              VALUES (
                @accountId, @bucket, @objectKey, @mediaType, @contentType, @byteSize,
                @checksumSha256, 'temporary', @dataSensitivity, CAST(@data AS jsonb), now(), now()
              )
              ON CONFLICT (bucket, object_key) DO UPDATE SET
                updated_at = now()
              RETURNING *
            ),
            session AS (
              INSERT INTO upload_sessions (
                account_id, media_object_id, idempotency_key, status, upload_url_expires_at, data, created_at
              )
              SELECT @accountId, media.id, @idempotencyKey, 'begun', @expiresAt, CAST(@data AS jsonb), now()
              FROM media
              ON CONFLICT (account_id, idempotency_key) DO UPDATE SET
                upload_url_expires_at = EXCLUDED.upload_url_expires_at
              RETURNING *
            )
            SELECT
              media.id AS media_object_id,
              media.bucket,
              media.object_key,
              session.id AS upload_session_id,
              session.upload_url_expires_at
            FROM media, session
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("bucket", NpgsqlDbType.Text, bucket);
        command.Parameters.AddWithValue("objectKey", NpgsqlDbType.Text, objectKey);
        command.Parameters.AddWithValue("mediaType", NpgsqlDbType.Text, request.MediaType);
        command.Parameters.AddWithValue("contentType", NpgsqlDbType.Text, (object?)request.ContentType ?? DBNull.Value);
        command.Parameters.AddWithValue("byteSize", NpgsqlDbType.Bigint, (object?)request.ByteSize ?? DBNull.Value);
        command.Parameters.AddWithValue("checksumSha256", NpgsqlDbType.Text, (object?)request.ChecksumSha256 ?? DBNull.Value);
        command.Parameters.AddWithValue("dataSensitivity", NpgsqlDbType.Text, request.DataSensitivity);
        command.Parameters.AddWithValue("data", NpgsqlDbType.Jsonb, Jsonb.From(request.Data));
        command.Parameters.AddWithValue("idempotencyKey", NpgsqlDbType.Text, string.IsNullOrWhiteSpace(request.IdempotencyKey) ? Guid.NewGuid().ToString("N") : request.IdempotencyKey.Trim());
        command.Parameters.AddWithValue("expiresAt", NpgsqlDbType.TimestampTz, expiresAt);
        var row = await PostgresRows.ReadSingleAsync(command, cancellationToken)
            ?? throw new InvalidOperationException("Failed to create upload session.");

        await transaction.CommitAsync(cancellationToken);
        var signed = signer.SignUpload(bucket, objectKey, expiresAt - DateTimeOffset.UtcNow);
        row["upload_url"] = signed.Url;
        row["upload_url_expires_at"] = signed.ExpiresAt;
        return row;
    }

    public async Task<Dictionary<string, object?>?> CompleteUploadAsync(
        UploadCompleteRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, request, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Media, cancellationToken);

        await using var command = new NpgsqlCommand(
            """
            UPDATE upload_sessions
            SET status = 'completed',
                completed_at = now()
            WHERE id = @uploadSessionId
              AND media_object_id = @mediaObjectId
              AND account_id = @accountId
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("uploadSessionId", NpgsqlDbType.Uuid, request.UploadSessionId);
        command.Parameters.AddWithValue("mediaObjectId", NpgsqlDbType.Uuid, request.MediaObjectId);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        var session = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        if (session is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        await using var updateMedia = new NpgsqlCommand(
            """
            UPDATE media_objects
            SET status = 'temporary',
                checksum_sha256 = COALESCE(@checksumSha256, checksum_sha256),
                byte_size = COALESCE(@byteSize, byte_size),
                updated_at = now()
            WHERE id = @mediaObjectId
              AND account_id = @accountId
            RETURNING *
            """,
            connection,
            transaction);
        updateMedia.Parameters.AddWithValue("mediaObjectId", NpgsqlDbType.Uuid, request.MediaObjectId);
        updateMedia.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        updateMedia.Parameters.AddWithValue("checksumSha256", NpgsqlDbType.Text, (object?)request.ChecksumSha256 ?? DBNull.Value);
        updateMedia.Parameters.AddWithValue("byteSize", NpgsqlDbType.Bigint, (object?)request.ByteSize ?? DBNull.Value);
        var media = await PostgresRows.ReadSingleAsync(updateMedia, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return media;
    }

    public async Task<Dictionary<string, object?>?> GetSignedReadUrlAsync(
        SignedReadUrlRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, request, cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT * FROM media_objects WHERE id = @id AND account_id = @accountId",
            connection,
            transaction);
        command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, request.MediaObjectId);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        var media = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        if (media is null)
        {
            return null;
        }

        var signed = signer.SignRead(
            media["bucket"]?.ToString() ?? "",
            media["permanent_object_key"]?.ToString() ?? media["object_key"]?.ToString() ?? "",
            TimeSpan.FromSeconds(Math.Clamp(request.ExpiresInSeconds, 60, 3600)));
        media["signed_read_url"] = signed.Url;
        media["signed_read_url_expires_at"] = signed.ExpiresAt;
        return media;
    }

    public async Task<Dictionary<string, object?>?> MoveTempToPermanentAsync(
        MoveTempToPermanentRequest request,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var accountId = await accounts.EnsureAccountAsync(connection, transaction, request, cancellationToken);
        await PostgresAccountStore.LockAccountLaneAsync(connection, transaction, accountId, AccountLanes.Media, cancellationToken);

        await using var command = new NpgsqlCommand(
            """
            UPDATE media_objects
            SET permanent_object_key = @permanentObjectKey,
                status = 'permanent',
                data = data || jsonb_build_object('move_reason', @reason),
                updated_at = now()
            WHERE id = @mediaObjectId
              AND account_id = @accountId
            RETURNING *
            """,
            connection,
            transaction);
        command.Parameters.AddWithValue("mediaObjectId", NpgsqlDbType.Uuid, request.MediaObjectId);
        command.Parameters.AddWithValue("accountId", NpgsqlDbType.Uuid, accountId);
        command.Parameters.AddWithValue("permanentObjectKey", NpgsqlDbType.Text, request.PermanentObjectKey);
        command.Parameters.AddWithValue("reason", NpgsqlDbType.Text, request.Reason);
        var media = await PostgresRows.ReadSingleAsync(command, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return media;
    }
}
