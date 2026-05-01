namespace XiaoLou.Infrastructure.Postgres;

public static class PostgresConnectionString
{
    public static string Normalize(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            throw new InvalidOperationException("PostgreSQL connection string is required.");
        }

        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "postgres" && uri.Scheme != "postgresql"))
        {
            return raw;
        }

        var userInfo = uri.UserInfo.Split(':', 2);
        var username = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(0) ?? "");
        var password = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(1) ?? "");
        var database = uri.AbsolutePath.TrimStart('/');

        var parts = new List<string>
        {
            $"Host={uri.Host}",
            $"Port={(uri.Port > 0 ? uri.Port : 5432)}",
            $"Database={database}",
        };

        if (!string.IsNullOrWhiteSpace(username))
        {
            parts.Add($"Username={username}");
        }

        if (!string.IsNullOrWhiteSpace(password))
        {
            parts.Add($"Password={password}");
        }

        return string.Join(';', parts);
    }
}
