using Microsoft.AspNetCore.Http;

namespace XiaoLou.ControlApi.Modules.Auth;

internal static class AuthErrorEnvelopeResponses
{
    internal static IResult BadRequestError(Exception exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }

    internal static IResult ForbiddenError(Exception exception)
    {
        return Results.Json(new { error = exception.Message }, statusCode: StatusCodes.Status403Forbidden);
    }

    internal static IResult AccountForbidden()
    {
        return Results.Json(new
        {
            error = "account scope is not authorized for this client token",
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    internal static IResult PlatformAdminForbidden()
    {
        return Results.Json(new
        {
            error = "platform admin permission is required",
        }, statusCode: StatusCodes.Status403Forbidden);
    }

    internal static async Task WriteClientAuthenticationFailureAsync(
        HttpContext context,
        ClientAuthenticationResult clientAuth)
    {
        context.Response.StatusCode = clientAuth.StatusCode;
        await context.Response.WriteAsJsonAsync(new
        {
            error = clientAuth.Error,
        });
    }

    internal static async Task WriteClientPermissionFailureAsync(
        HttpContext context,
        string? requiredPermission)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "client token is missing the required public API permission",
            requiredPermission,
        });
    }
}
