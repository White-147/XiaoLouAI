using System.Diagnostics;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Npgsql;

namespace XiaoLou.ControlApi.Modules.Health;

internal static class HealthMetricsEndpoints
{
    public static IEndpointRouteBuilder MapHealthMetricsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        MapHealthz(endpoints);
        MapLivez(endpoints);
        endpoints.MapGet("/readyz", async (NpgsqlDataSource dataSource, CancellationToken ct) =>
        {
            try
            {
                await using var connection = await dataSource.OpenConnectionAsync(ct);
                await using var command = new NpgsqlCommand("select 1", connection);
                await command.ExecuteScalarAsync(ct);

                return Results.Ok(new
                {
                    service = "xiaolou-control-api",
                    status = "ready",
                    dependency = "postgresql",
                });
            }
            catch (Exception ex)
            {
                return Results.Json(new
                {
                    service = "xiaolou-control-api",
                    status = "not_ready",
                    dependency = "postgresql",
                    error = ex.GetType().Name,
                }, statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });
        MapMetrics(endpoints);
        MapWindowsNativeStatus(endpoints);

        return endpoints;
    }

    internal static IEndpointRouteBuilder MapHealthMetricsNoDbEndpoints(this IEndpointRouteBuilder endpoints)
    {
        MapHealthz(endpoints);
        MapLivez(endpoints);
        MapMetrics(endpoints);
        MapWindowsNativeStatus(endpoints);
        return endpoints;
    }

    private static void MapHealthz(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/healthz", () => Results.Ok(new
        {
            service = "xiaolou-control-api",
            status = "ok",
            architecture = "windows-native-dotnet-postgresql",
        }));
    }

    private static void MapLivez(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/livez", () => Results.Ok(new
        {
            service = "xiaolou-control-api",
            status = "alive",
        }));
    }

    private static void MapMetrics(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/metrics", () =>
        {
            using var process = Process.GetCurrentProcess();
            var uptimeSeconds = Math.Max(0, (DateTimeOffset.UtcNow - new DateTimeOffset(process.StartTime.ToUniversalTime())).TotalSeconds);
            var lines = new[]
            {
                "# HELP xiaolou_controlapi_up Control API process up signal.",
                "# TYPE xiaolou_controlapi_up gauge",
                "xiaolou_controlapi_up 1",
                "# HELP xiaolou_controlapi_uptime_seconds Control API process uptime in seconds.",
                "# TYPE xiaolou_controlapi_uptime_seconds gauge",
                $"xiaolou_controlapi_uptime_seconds {uptimeSeconds:F0}",
                "# HELP xiaolou_controlapi_working_set_bytes Control API process working set.",
                "# TYPE xiaolou_controlapi_working_set_bytes gauge",
                $"xiaolou_controlapi_working_set_bytes {process.WorkingSet64}",
                "# HELP xiaolou_controlapi_gc_total_memory_bytes Managed memory reported by GC.",
                "# TYPE xiaolou_controlapi_gc_total_memory_bytes gauge",
                $"xiaolou_controlapi_gc_total_memory_bytes {GC.GetTotalMemory(false)}",
            };

            return Results.Text(string.Join('\n', lines) + "\n", "text/plain; version=0.0.4; charset=utf-8");
        });
    }

    private static void MapWindowsNativeStatus(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/windows-native/status", () => Results.Ok(new
        {
            enabled = true,
            service = "xiaolou-control-api",
            productionTarget = "windows-native-dotnet-postgresql",
            asyncFoundation = "postgresql",
            coreApiRole = "compat-readonly",
        }));
    }
}
