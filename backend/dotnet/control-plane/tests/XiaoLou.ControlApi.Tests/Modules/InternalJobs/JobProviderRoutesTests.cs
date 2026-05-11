using System.Text.Json;
using XiaoLou.Domain;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.InternalJobs;

public sealed class JobProviderRoutesTests
{
    [Fact]
    public void NormalizeForCreateJob_ForcesVertexVeoVideoJobsToVertexRoute()
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            model = "vertex:veo-3.1-lite-generate-001",
            prompt = "Animate the reference image",
        });

        var route = JobProviderRoutes.NormalizeForCreateJob(
            JobProviderRoutes.ClosedApi,
            "create_video_generate",
            payload);

        Assert.Equal(JobProviderRoutes.ClosedApiVertex, route);
    }

    [Fact]
    public void NormalizeForCreateJob_PreservesNonVertexRoutes()
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            model = "synthetic-video-model",
        });

        var route = JobProviderRoutes.NormalizeForCreateJob(
            " synthetic-provider ",
            "create_video_generate",
            payload);

        Assert.Equal("synthetic-provider", route);
    }

    [Fact]
    public void NormalizeForCreateJob_ReadsVideoModelAlias()
    {
        var payload = JsonSerializer.SerializeToElement(new
        {
            videoModel = "VERTEX:VEO-3.1-GENERATE-001",
        });

        Assert.True(JobProviderRoutes.IsVertexVeoCreateVideoJob("create_video_generate", payload));
    }
}
