using System.Text.Json;

namespace XiaoLou.Infrastructure.Postgres;

internal static class Jsonb
{
    public static string From(JsonElement element)
    {
        return element.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? "{}"
            : element.GetRawText();
    }

    public static string EmptyIfBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? "{}" : value;
    }
}
