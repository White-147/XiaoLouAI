using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using XiaoLou.Domain;
using XiaoLou.Infrastructure.Postgres;

namespace XiaoLou.ControlApi.Modules.Operational;

internal static class OperationalEndpoints
{
    public static IEndpointRouteBuilder MapOperationalEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/providers/health", async (
            PostgresProviderHealthStore providers,
            CancellationToken ct) =>
        {
            return Results.Ok(await providers.ListAsync(ct));
        });

        endpoints.MapPut("/api/providers/health", async (
            ProviderHealthRequest request,
            PostgresProviderHealthStore providers,
            CancellationToken ct) =>
        {
            return Results.Ok(await providers.UpsertAsync(request, ct));
        });

        return endpoints;
    }
}
