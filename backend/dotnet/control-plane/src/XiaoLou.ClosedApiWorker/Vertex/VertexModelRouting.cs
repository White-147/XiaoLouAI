namespace XiaoLou.ClosedApiWorker.Vertex;

internal static class VertexModelRouting
{
    public static bool IsVertexImageModel(string? model)
    {
        var raw = StripVertexPrefix(model);
        return !string.IsNullOrWhiteSpace(model)
            && model.Trim().StartsWith("vertex:", StringComparison.OrdinalIgnoreCase)
            && raw.Contains("image", StringComparison.OrdinalIgnoreCase)
            && raw.Contains("gemini", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsVertexVideoModel(string? model)
    {
        var raw = StripVertexPrefix(model);
        return !string.IsNullOrWhiteSpace(model)
            && model.Trim().StartsWith("vertex:", StringComparison.OrdinalIgnoreCase)
            && raw.StartsWith("veo-", StringComparison.OrdinalIgnoreCase)
            && raw.Contains("generate", StringComparison.OrdinalIgnoreCase);
    }

    public static string StripVertexPrefix(string? model)
    {
        var value = model?.Trim() ?? "";
        return value.StartsWith("vertex:", StringComparison.OrdinalIgnoreCase)
            ? value["vertex:".Length..]
            : value;
    }
}
