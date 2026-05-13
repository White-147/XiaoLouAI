using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using XiaoLou.Domain;

namespace XiaoLou.ControlApi.Modules.AgentCanvas;

internal static class AgentCanvasChatEndpoints
{
    private static readonly JsonSerializerOptions SseJsonOptions = new(JsonSerializerDefaults.Web);

    private const string StubWarning =
        "AGENT_CANVAS_CHAT_STUB: .NET Agent Canvas chat contract is active, but no provider adapter is configured; no canvas actions or media were generated.";

    public static IEndpointRouteBuilder MapAgentCanvasChatEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/agent-canvas/chat", (AgentCanvasChatRequest request) =>
        {
            var message = NormalizeBlank(request.Message);
            if (message is null)
            {
                return Results.BadRequest(BuildInvalidMessageEnvelope());
            }

            return Results.Ok(new
            {
                success = true,
                data = BuildStubResponse(request, message),
            });
        });

        endpoints.MapPost("/api/agent-canvas/chat/stream", async (
            AgentCanvasChatRequest request,
            HttpContext httpContext,
            CancellationToken cancellationToken) =>
        {
            var message = NormalizeBlank(request.Message);
            if (message is null)
            {
                httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
                await httpContext.Response.WriteAsJsonAsync(BuildInvalidMessageEnvelope(), cancellationToken);
                return;
            }

            var result = BuildStubResponse(request, message);
            var response = httpContext.Response;
            response.StatusCode = StatusCodes.Status200OK;
            response.ContentType = "text/event-stream; charset=utf-8";
            response.Headers["Cache-Control"] = "no-cache";
            response.Headers["X-Accel-Buffering"] = "no";

            await WriteSseEventAsync(response, "ready", new
            {
                mode = "contract-stub",
            }, cancellationToken);
            await WriteSseEventAsync(response, "status", new
            {
                phase = "THINKING",
                title = "Agent Canvas chat stub is ready",
                detail = "Provider execution is not enabled; returning a contract-stub result.",
                status = "active",
            }, cancellationToken);
            await WriteSseEventAsync(response, "result", result, cancellationToken);
            await WriteSseEventAsync(response, "done", new
            {
                ok = true,
            }, cancellationToken);
        });

        return endpoints;
    }

    private static object BuildInvalidMessageEnvelope()
    {
        return new
        {
            success = false,
            error = new
            {
                code = "AGENT_CANVAS_CHAT_INVALID_REQUEST",
                message = "message is required",
            },
        };
    }

    private static AgentCanvasChatResponse BuildStubResponse(AgentCanvasChatRequest request, string message)
    {
        return new AgentCanvasChatResponse
        {
            Response = "Agent Canvas chat is connected in contract-stub mode. Provider execution is not enabled yet, so this response does not include canvas actions or generated media.",
            Actions = Array.Empty<JsonElement>(),
            Warnings = new[] { StubWarning },
            Topic = BuildTopic(message),
            SessionId = NormalizeBlank(request.SessionId),
            Provider = "contract-stub",
            Model = NormalizeBlank(request.Model) ?? "auto",
            FallbackFrom = null,
        };
    }

    private static async Task WriteSseEventAsync(
        HttpResponse response,
        string eventName,
        object? data,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(data, SseJsonOptions);
        await response.WriteAsync($"event: {eventName}\n", cancellationToken);
        await response.WriteAsync($"data: {json}\n\n", cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }

    private static string? NormalizeBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string BuildTopic(string message)
    {
        var normalized = message.ReplaceLineEndings(" ").Trim();
        return normalized.Length <= 40 ? normalized : normalized[..40];
    }
}
