using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.ControlApi.Modules.InternalJobs;
using XiaoLou.ControlApi.Modules.Media;
using XiaoLou.ControlApi.Modules.Payments;
using XiaoLou.ControlApi.Modules.Playground;
using XiaoLou.ControlApi.Modules.Projects;
using XiaoLou.ControlApi.Modules.Toolbox;
using XiaoLou.Infrastructure.Postgres;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.BackendAdvisory;

public sealed class BackendAdvisoryEndpointRoutesTests : IAsyncDisposable
{
    private readonly WebApplication app;

    public BackendAdvisoryEndpointRoutesTests()
    {
        var builder = WebApplication.CreateBuilder();
        RegisterSyntheticEndpointServices(builder.Services);
        app = builder.Build();
        app.MapPaymentEndpoints();
        app.MapMediaEndpoints();
        app.MapInternalJobsEndpoints();
        app.MapProjectEndpoints();
        app.MapToolboxEndpoints();
        app.MapPlaygroundEndpoints();
    }

    [Theory]
    [MemberData(nameof(ExpectedRoutes))]
    public void AdvisoryBackendRoute_IsMappedWithExpectedMethod(string method, string path)
    {
        var route = FindRoute(method, path);
        var methodMetadata = Assert.IsAssignableFrom<IHttpMethodMetadata>(
            route.Metadata.GetMetadata<IHttpMethodMetadata>());

        Assert.Contains(method, methodMetadata.HttpMethods, StringComparer.Ordinal);
    }

    public async ValueTask DisposeAsync()
    {
        await app.DisposeAsync();
    }

    private static void RegisterSyntheticEndpointServices(IServiceCollection services)
    {
        services.AddSingleton<IOptions<ClientApiOptions>>(Options.Create(new ClientApiOptions()));
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresWalletStore>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresPaymentLedger>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresMediaStore>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresJobQueue>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresJobNotificationListener>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresOutboxStore>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresProjectSurfaceStore>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresToolboxStore>());
        services.AddSingleton(_ => ThrowIfEndpointDelegateRuns<PostgresPlaygroundStore>());
    }

    private static T ThrowIfEndpointDelegateRuns<T>() where T : class
    {
        throw new InvalidOperationException("Synthetic route metadata tests must not invoke endpoint delegates.");
    }

    public static IEnumerable<object[]> ExpectedRoutes()
    {
        yield return Route(HttpMethods.Get, "/api/wallet");
        yield return Route(HttpMethods.Get, "/api/wallets");
        yield return Route(HttpMethods.Get, "/api/wallets/{walletId:guid}/ledger");
        yield return Route(HttpMethods.Get, "/api/wallet/usage-stats");
        yield return Route(HttpMethods.Post, "/api/payments/callbacks/{provider}");
        yield return Route(HttpMethods.Post, "/api/payments/alipay/notify");
        yield return Route(HttpMethods.Post, "/api/payments/wechat/notify");

        yield return Route(HttpMethods.Post, "/api/media/upload-begin");
        yield return Route(HttpMethods.Post, "/api/media/upload-complete");
        yield return Route(HttpMethods.Post, "/api/media/signed-read-url");
        yield return Route(HttpMethods.Post, "/api/media/move-temp-to-permanent");

        yield return Route(HttpMethods.Post, "/api/jobs");
        yield return Route(HttpMethods.Get, "/api/jobs");
        yield return Route(HttpMethods.Get, "/api/jobs/{jobId:guid}");
        yield return Route(HttpMethods.Post, "/api/jobs/{jobId:guid}/cancel");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/lease");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/{jobId:guid}/running");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/{jobId:guid}/heartbeat");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/recover-expired");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/recover-expired-leases");
        yield return Route(HttpMethods.Get, "/api/internal/jobs/{jobId:guid}/attempts");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/{jobId:guid}/succeed");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/{jobId:guid}/succeeded");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/{jobId:guid}/fail");
        yield return Route(HttpMethods.Post, "/api/internal/jobs/{jobId:guid}/failed");
        yield return Route(HttpMethods.Get, "/api/internal/jobs/wait-signal");
        yield return Route(HttpMethods.Post, "/api/internal/outbox/lease");
        yield return Route(HttpMethods.Post, "/api/internal/outbox/{eventId:guid}/complete");

        yield return Route(HttpMethods.Get, "/api/projects");
        yield return Route(HttpMethods.Post, "/api/projects");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/overview");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/settings");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}/settings");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/script");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}/script");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/timeline");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}/timeline");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/assets");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/assets/{assetId}");
        yield return Route(HttpMethods.Post, "/api/projects/{projectId}/assets");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}/assets/{assetId}");
        yield return Route(HttpMethods.Delete, "/api/projects/{projectId}/assets/{assetId}");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/storyboards");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/storyboards/{storyboardId}");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}/storyboards/{storyboardId}");
        yield return Route(HttpMethods.Delete, "/api/projects/{projectId}/storyboards/{storyboardId}");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/videos");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}/videos/{videoId}");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/dubbings");
        yield return Route(HttpMethods.Put, "/api/projects/{projectId}/dubbings/{dubbingId}");
        yield return Route(HttpMethods.Get, "/api/projects/{projectId}/exports");
        yield return Route(HttpMethods.Post, "/api/projects/{projectId}/exports");
        yield return Route(HttpMethods.Get, "/api/canvas-projects");
        yield return Route(HttpMethods.Get, "/api/canvas-projects/{projectId}");
        yield return Route(HttpMethods.Post, "/api/canvas-projects");
        yield return Route(HttpMethods.Put, "/api/canvas-projects/{projectId}");
        yield return Route(HttpMethods.Delete, "/api/canvas-projects/{projectId}");
        yield return Route(HttpMethods.Get, "/api/agent-canvas/projects");
        yield return Route(HttpMethods.Get, "/api/agent-canvas/projects/{projectId}");
        yield return Route(HttpMethods.Post, "/api/agent-canvas/projects");
        yield return Route(HttpMethods.Put, "/api/agent-canvas/projects/{projectId}");
        yield return Route(HttpMethods.Delete, "/api/agent-canvas/projects/{projectId}");
        yield return Route(HttpMethods.Get, "/api/create/images");
        yield return Route(HttpMethods.Get, "/api/create/videos");
        yield return Route(HttpMethods.Delete, "/api/create/images/{imageId}");
        yield return Route(HttpMethods.Delete, "/api/create/videos/{videoId}");

        yield return Route(HttpMethods.Get, "/api/capabilities");
        yield return Route(HttpMethods.Get, "/api/toolbox");
        yield return Route(HttpMethods.Get, "/api/toolbox/capabilities");
        yield return Route(HttpMethods.Post, "/api/toolbox/character-replace");
        yield return Route(HttpMethods.Post, "/api/toolbox/motion-transfer");
        yield return Route(HttpMethods.Post, "/api/toolbox/upscale-restore");
        yield return Route(HttpMethods.Post, "/api/toolbox/video-reverse-prompt");
        yield return Route(HttpMethods.Post, "/api/toolbox/storyboard-grid25");
        yield return Route(HttpMethods.Post, "/api/toolbox/translate-text");

        yield return Route(HttpMethods.Get, "/api/playground/config");
        yield return Route(HttpMethods.Get, "/api/playground/models");
        yield return Route(HttpMethods.Get, "/api/playground/conversations");
        yield return Route(HttpMethods.Post, "/api/playground/conversations");
        yield return Route(HttpMethods.Get, "/api/playground/conversations/{conversationId}");
        yield return Route(HttpMethods.Put, "/api/playground/conversations/{conversationId}");
        yield return Route(HttpMethods.Delete, "/api/playground/conversations/{conversationId}");
        yield return Route(HttpMethods.Get, "/api/playground/conversations/{conversationId}/messages");
        yield return Route(HttpMethods.Get, "/api/playground/chat-jobs");
        yield return Route(HttpMethods.Post, "/api/playground/chat-jobs");
        yield return Route(HttpMethods.Get, "/api/playground/chat-jobs/{jobId:guid}");
        yield return Route(HttpMethods.Get, "/api/playground/memories");
        yield return Route(HttpMethods.Put, "/api/playground/memories/preference");
        yield return Route(HttpMethods.Put, "/api/playground/memories/{key}");
        yield return Route(HttpMethods.Delete, "/api/playground/memories/{key}");
    }

    private RouteEndpoint FindRoute(string method, string path)
    {
        var matching = ((IEndpointRouteBuilder)app).DataSources
            .SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>()
            .Where(endpoint => string.Equals(endpoint.RoutePattern.RawText, path, StringComparison.Ordinal))
            .Where(endpoint =>
                endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods.Contains(
                    method,
                    StringComparer.Ordinal) == true)
            .ToArray();

        return Assert.Single(matching);
    }

    private static object[] Route(string method, string path)
    {
        return new object[] { method, path };
    }
}
