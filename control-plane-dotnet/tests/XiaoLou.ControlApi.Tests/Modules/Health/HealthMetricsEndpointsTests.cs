using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using XiaoLou.ControlApi.Modules.Health;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.Health;

public sealed class HealthMetricsEndpointsTests : IAsyncDisposable
{
    private readonly WebApplication app;

    public HealthMetricsEndpointsTests()
    {
        var builder = WebApplication.CreateBuilder();
        app = builder.Build();
        app.MapHealthMetricsNoDbEndpoints();
    }

    [Theory]
    [InlineData("/healthz", "ok")]
    [InlineData("/livez", "alive")]
    public async Task HealthRoutes_ReturnStableServiceAndStatus(string path, string expectedStatus)
    {
        var response = await InvokeGetAsync(path);

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        using var document = JsonDocument.Parse(response.Body);
        var root = document.RootElement;
        Assert.Equal("xiaolou-control-api", root.GetProperty("service").GetString());
        Assert.Equal(expectedStatus, root.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Healthz_ReturnsWindowsNativeArchitecture()
    {
        var response = await InvokeGetAsync("/healthz");

        using var document = JsonDocument.Parse(response.Body);
        Assert.Equal(
            "windows-native-dotnet-postgresql",
            document.RootElement.GetProperty("architecture").GetString());
    }

    [Fact]
    public async Task WindowsNativeStatus_ReturnsStableCompatibilityShape()
    {
        var response = await InvokeGetAsync("/api/windows-native/status");

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        using var document = JsonDocument.Parse(response.Body);
        var root = document.RootElement;
        Assert.True(root.GetProperty("enabled").GetBoolean());
        Assert.Equal("xiaolou-control-api", root.GetProperty("service").GetString());
        Assert.Equal("windows-native-dotnet-postgresql", root.GetProperty("productionTarget").GetString());
        Assert.Equal("postgresql", root.GetProperty("asyncFoundation").GetString());
        Assert.Equal("compat-readonly", root.GetProperty("coreApiRole").GetString());
    }

    [Fact]
    public async Task Metrics_ReturnsPrometheusTextWithStableMetricNames()
    {
        var response = await InvokeGetAsync("/metrics");

        Assert.Equal(StatusCodes.Status200OK, response.StatusCode);
        Assert.Equal("text/plain; version=0.0.4; charset=utf-8", response.ContentType);
        Assert.Contains("# HELP xiaolou_controlapi_up Control API process up signal.", response.Body, StringComparison.Ordinal);
        Assert.Contains("# TYPE xiaolou_controlapi_up gauge", response.Body, StringComparison.Ordinal);
        Assert.Contains("xiaolou_controlapi_up 1", response.Body, StringComparison.Ordinal);
        Assert.Contains("xiaolou_controlapi_uptime_seconds", response.Body, StringComparison.Ordinal);
        Assert.Contains("xiaolou_controlapi_working_set_bytes", response.Body, StringComparison.Ordinal);
        Assert.Contains("xiaolou_controlapi_gc_total_memory_bytes", response.Body, StringComparison.Ordinal);
        Assert.EndsWith("\n", response.Body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("/healthz")]
    [InlineData("/livez")]
    [InlineData("/metrics")]
    [InlineData("/api/windows-native/status")]
    public void NoDbRoutes_AreMapped(string path)
    {
        Assert.NotNull(FindRoute(path));
    }

    public async ValueTask DisposeAsync()
    {
        await app.DisposeAsync();
    }

    private async Task<RouteResponse> InvokeGetAsync(string path)
    {
        var route = FindRoute(path);
        var context = new DefaultHttpContext
        {
            RequestServices = app.Services,
        };
        await using var body = new MemoryStream();
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = path;
        context.Response.Body = body;

        await route.RequestDelegate!(context);

        body.Position = 0;
        using var reader = new StreamReader(body);
        return new RouteResponse(
            context.Response.StatusCode,
            context.Response.ContentType,
            await reader.ReadToEndAsync());
    }

    private RouteEndpoint FindRoute(string path)
    {
        return ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(endpoint => string.Equals(endpoint.RoutePattern.RawText, path, StringComparison.Ordinal));
    }

    private sealed record RouteResponse(int StatusCode, string? ContentType, string Body);
}
