using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;
using static XiaoLou.ControlApi.Modules.Auth.AuthHelpers;

namespace XiaoLou.ControlApi.Modules.Media;

internal static class MediaEndpoints
{
    public static IEndpointRouteBuilder MapMediaEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/media/upload-begin", async (
            UploadBeginRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
            {
                return denied;
            }

            return Results.Ok(await media.BeginUploadAsync(request, ct));
        });

        endpoints.MapPost("/api/media/upload-complete", async (
            UploadCompleteRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
            {
                return denied;
            }

            var result = await media.CompleteUploadAsync(request, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        endpoints.MapPost("/api/media/signed-read-url", async (
            SignedReadUrlRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
            {
                return denied;
            }

            var result = await media.GetSignedReadUrlAsync(request, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        endpoints.MapPost("/api/media/move-temp-to-permanent", async (
            MoveTempToPermanentRequest request,
            HttpContext httpContext,
            IOptions<ClientApiOptions> clientApi,
            PostgresMediaStore media,
            CancellationToken ct) =>
        {
            if (AuthorizeAccountScope(httpContext, clientApi.Value, request) is { } denied)
            {
                return denied;
            }

            var result = await media.MoveTempToPermanentAsync(request, ct);
            return result is null ? Results.NotFound() : Results.Ok(result);
        });

        return endpoints;
    }
}
