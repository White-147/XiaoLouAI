using Microsoft.Extensions.Logging;
using Npgsql;

namespace XiaoLou.Infrastructure.Postgres;

public sealed class PostgresJobNotificationListener(
    NpgsqlDataSource dataSource,
    ILogger<PostgresJobNotificationListener> logger)
{
    public async Task<string?> WaitForJobSignalAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        string? payload = null;
        connection.Notification += (_, args) => payload = args.Payload;

        await using (var listen = new NpgsqlCommand("LISTEN xiaolou_jobs", connection))
        {
            await listen.ExecuteNonQueryAsync(cancellationToken);
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);
        try
        {
            while (!timeoutCts.IsCancellationRequested && payload is null)
            {
                await connection.WaitAsync(timeoutCts.Token);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogDebug("Timed out waiting for xiaolou_jobs notification.");
        }

        return payload;
    }
}
