using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.AgentCanvas;

internal static class AgentCanvasLocalImageEditEndpoints
{
    private static readonly string[] SignedOperations = new[]
    {
        "remove-background",
        "upscale",
        "segment-mask",
        "inpaint",
        "move-object",
        "ocr",
        "multi-angle",
    };

    private static readonly string[] AcceptedInputs = new[]
    {
        "imageUrl",
        "dataUrl",
        "maskDataUrl",
        "projectId",
        "nodeId",
        "accountOwnerType",
        "accountOwnerId",
    };

    private const string StubWarning =
        "LOCAL_IMAGE_EDIT_STUB: .NET local-image-edit contract is active, but no image edit sidecar or provider adapter is configured; no media, job, or runtime action was generated.";

    public static IEndpointRouteBuilder MapAgentCanvasLocalImageEditEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/canvas/local-image-edit/health", () => Results.Ok(new
        {
            success = true,
            data = new
            {
                available = false,
                mode = "contract-stub",
                owner = "I4d local-image-edit-dotnet-route-contract",
                executionOwner = "I5b local-image-edit-sidecar-contract",
                routePrefix = "/api/canvas/local-image-edit",
                operations = SignedOperations,
                acceptedInputs = AcceptedInputs,
                mediaOutput = "none",
                syncJobContract = "declared-gap",
                warnings = new[] { StubWarning },
            },
        }));

        foreach (var operation in SignedOperations)
        {
            var capturedOperation = operation;
            endpoints.MapPost($"/api/canvas/local-image-edit/{capturedOperation}", (
                LocalImageEditRequest request,
                HttpContext httpContext,
                IOptions<ClientApiOptions> clientApi) =>
            {
                return HandleUnavailableOperation(capturedOperation, request, httpContext, clientApi.Value);
            });
        }

        return endpoints;
    }

    private static IResult HandleUnavailableOperation(
        string operation,
        LocalImageEditRequest request,
        HttpContext httpContext,
        ClientApiOptions clientApi)
    {
        var scope = ResolvePublicOwnerScope(httpContext, request.AccountOwnerType, request.AccountOwnerId);
        var scopedRequest = request with
        {
            AccountOwnerType = scope.AccountOwnerType,
            AccountOwnerId = scope.AccountOwnerId,
            RegionCode = scope.RegionCode,
            Currency = scope.Currency,
        };
        if (AuthorizeAccountScope(httpContext, clientApi, scopedRequest) is { } denied)
        {
            return denied;
        }

        if (!HasImageSource(request))
        {
            return BuildError(
                StatusCodes.Status400BadRequest,
                "LOCAL_IMAGE_EDIT_INVALID_REQUEST",
                "imageUrl or dataUrl is required",
                operation);
        }

        if (RequiresMask(operation) && string.IsNullOrWhiteSpace(request.MaskDataUrl))
        {
            return BuildError(
                StatusCodes.Status400BadRequest,
                "LOCAL_IMAGE_EDIT_INVALID_REQUEST",
                "maskDataUrl is required for this local image edit operation",
                operation);
        }

        return BuildError(
            StatusCodes.Status503ServiceUnavailable,
            "LOCAL_IMAGE_EDIT_UNAVAILABLE",
            ".NET local image edit contract is registered, but no local image edit sidecar or adapter is configured.",
            operation,
            request.ProjectId,
            request.NodeId);
    }

    private static bool HasImageSource(LocalImageEditRequest request)
    {
        return !string.IsNullOrWhiteSpace(request.ImageUrl)
            || !string.IsNullOrWhiteSpace(request.DataUrl);
    }

    private static bool RequiresMask(string operation)
    {
        return operation is "segment-mask" or "inpaint" or "move-object";
    }

    private static IResult BuildError(
        int statusCode,
        string code,
        string message,
        string operation,
        string? projectId = null,
        string? nodeId = null)
    {
        return Results.Json(
            new
            {
                success = false,
                error = new
                {
                    code,
                    message,
                    statusCode,
                    operation,
                    projectId,
                    nodeId,
                    owner = "I4d local-image-edit-dotnet-route-contract",
                    executionOwner = "I5b local-image-edit-sidecar-contract",
                    warnings = new[] { StubWarning },
                },
            },
            statusCode: statusCode);
    }
}
