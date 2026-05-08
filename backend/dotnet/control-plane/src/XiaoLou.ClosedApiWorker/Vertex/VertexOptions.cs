using Microsoft.Extensions.Configuration;

namespace XiaoLou.ClosedApiWorker.Vertex;

internal sealed class VertexOptions
{
    public string ProjectId { get; init; } = "";
    public string GeminiLocation { get; init; } = "global";
    public string CredentialsPath { get; init; } = "";
    public string AccessToken { get; init; } = "";
    public string ApiKey { get; init; } = "";
    public string GenerateContentEndpointOverride { get; init; } = "";
    public string OAuthTokenEndpoint { get; init; } = "https://oauth2.googleapis.com/token";
    public int RequestTimeoutSeconds { get; init; } = 300;
    public int ReferenceImageLimit { get; init; } = 4;

    public static VertexOptions FromConfiguration(IConfiguration configuration)
    {
        return new VertexOptions
        {
            ProjectId = First(
                configuration["Vertex:ProjectId"],
                configuration["VERTEX_PROJECT_ID"],
                configuration["GOOGLE_CLOUD_PROJECT"],
                Environment.GetEnvironmentVariable("VERTEX_PROJECT_ID"),
                Environment.GetEnvironmentVariable("GOOGLE_CLOUD_PROJECT")),
            GeminiLocation = First(
                configuration["Vertex:GeminiLocation"],
                configuration["Vertex:Location"],
                configuration["VERTEX_GEMINI_LOCATION"],
                configuration["GOOGLE_CLOUD_LOCATION"],
                Environment.GetEnvironmentVariable("VERTEX_GEMINI_LOCATION"),
                Environment.GetEnvironmentVariable("GOOGLE_CLOUD_LOCATION"),
                "global"),
            CredentialsPath = First(
                configuration["Vertex:CredentialsPath"],
                configuration["GOOGLE_APPLICATION_CREDENTIALS"],
                Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS")),
            AccessToken = First(
                configuration["Vertex:AccessToken"],
                configuration["VERTEX_ACCESS_TOKEN"],
                Environment.GetEnvironmentVariable("VERTEX_ACCESS_TOKEN")),
            ApiKey = First(
                configuration["Vertex:ApiKey"],
                configuration["VERTEX_API_KEY"],
                Environment.GetEnvironmentVariable("VERTEX_API_KEY")),
            GenerateContentEndpointOverride = First(
                configuration["Vertex:GenerateContentEndpointOverride"],
                configuration["VERTEX_GENERATE_CONTENT_ENDPOINT"],
                Environment.GetEnvironmentVariable("VERTEX_GENERATE_CONTENT_ENDPOINT")),
            OAuthTokenEndpoint = First(
                configuration["Vertex:OAuthTokenEndpoint"],
                configuration["GOOGLE_OAUTH_TOKEN_ENDPOINT"],
                Environment.GetEnvironmentVariable("GOOGLE_OAUTH_TOKEN_ENDPOINT"),
                "https://oauth2.googleapis.com/token"),
            RequestTimeoutSeconds = ReadInt(configuration, "Vertex:RequestTimeoutSeconds", 300, minimum: 30),
            ReferenceImageLimit = ReadInt(configuration, "Vertex:ReferenceImageLimit", 4, minimum: 0),
        };
    }

    public string BuildGenerateContentEndpoint(string rawModel)
    {
        if (!string.IsNullOrWhiteSpace(GenerateContentEndpointOverride))
        {
            return GenerateContentEndpointOverride.Trim();
        }

        if (string.IsNullOrWhiteSpace(ProjectId))
        {
            throw new VertexProviderException(
                "Vertex project id is not configured. Set Vertex:ProjectId or VERTEX_PROJECT_ID.",
                retry: false);
        }

        var location = string.IsNullOrWhiteSpace(GeminiLocation) ? "global" : GeminiLocation.Trim();
        var host = string.Equals(location, "global", StringComparison.OrdinalIgnoreCase)
            ? "aiplatform.googleapis.com"
            : $"{location}-aiplatform.googleapis.com";
        return $"https://{host}/v1/projects/{Uri.EscapeDataString(ProjectId.Trim())}/locations/{Uri.EscapeDataString(location)}/publishers/google/models/{Uri.EscapeDataString(rawModel)}:generateContent";
    }

    private static string First(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return "";
    }

    private static int ReadInt(IConfiguration configuration, string key, int fallback, int minimum)
    {
        return int.TryParse(configuration[key], out var parsed)
            ? Math.Max(minimum, parsed)
            : fallback;
    }
}
