using Npgsql;

namespace XiaoLou.Infrastructure.Postgres;

public static class PostgresConnectionString
{
    private static readonly IReadOnlyDictionary<string, string> QueryParameterMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["sslmode"] = "SSL Mode",
            ["ssl mode"] = "SSL Mode",
            ["ssl_mode"] = "SSL Mode",
            ["trust server certificate"] = "Trust Server Certificate",
            ["trustservercertificate"] = "Trust Server Certificate",
            ["trust_server_certificate"] = "Trust Server Certificate",
            ["maximum pool size"] = "Maximum Pool Size",
            ["max pool size"] = "Maximum Pool Size",
            ["maximum_pool_size"] = "Maximum Pool Size",
            ["max_pool_size"] = "Maximum Pool Size",
            ["minimum pool size"] = "Minimum Pool Size",
            ["min pool size"] = "Minimum Pool Size",
            ["minimum_pool_size"] = "Minimum Pool Size",
            ["min_pool_size"] = "Minimum Pool Size",
            ["timeout"] = "Timeout",
            ["command timeout"] = "Command Timeout",
            ["command_timeout"] = "Command Timeout",
            ["commandtimeout"] = "Command Timeout",
            ["keepalive"] = "Keepalive",
            ["keep alive"] = "Keepalive",
            ["keep_alive"] = "Keepalive",
            ["application_name"] = "Application Name",
            ["application name"] = "Application Name",
            ["applicationname"] = "Application Name",
            ["options"] = "Options",
            ["searchpath"] = "Search Path",
            ["search path"] = "Search Path",
            ["search_path"] = "Search Path",
        };

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

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = database,
        };

        if (!string.IsNullOrWhiteSpace(username))
        {
            builder.Username = username;
        }

        if (!string.IsNullOrWhiteSpace(password))
        {
            builder.Password = password;
        }

        foreach (var pair in ParseQuery(uri.Query))
        {
            if (QueryParameterMap.TryGetValue(pair.Key, out var npgsqlKey))
            {
                builder[npgsqlKey] = pair.Value;
            }
        }

        return builder.ConnectionString;
    }

    private static IEnumerable<KeyValuePair<string, string>> ParseQuery(string query)
    {
        var trimmed = query.TrimStart('?');
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            yield break;
        }

        foreach (var rawPair in trimmed.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var index = rawPair.IndexOf('=');
            var rawKey = index >= 0 ? rawPair[..index] : rawPair;
            var rawValue = index >= 0 ? rawPair[(index + 1)..] : "";
            var key = Uri.UnescapeDataString(rawKey.Replace('+', ' ')).Trim();
            if (string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            var value = Uri.UnescapeDataString(rawValue.Replace('+', ' ')).Trim();
            yield return KeyValuePair.Create(key, value);
        }
    }
}
