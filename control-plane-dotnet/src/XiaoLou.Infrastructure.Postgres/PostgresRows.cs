using Npgsql;

namespace XiaoLou.Infrastructure.Postgres;

internal static class PostgresRows
{
    public static async Task<Dictionary<string, object?>?> ReadSingleAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return ReadCurrent(reader);
    }

    public static async Task<IReadOnlyList<Dictionary<string, object?>>> ReadManyAsync(
        NpgsqlCommand command,
        CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(ReadCurrent(reader));
        }

        return rows;
    }

    private static Dictionary<string, object?> ReadCurrent(NpgsqlDataReader reader)
    {
        var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < reader.FieldCount; i++)
        {
            var value = reader.GetValue(i);
            row[reader.GetName(i)] = value is DBNull ? null : value;
        }

        return row;
    }
}
