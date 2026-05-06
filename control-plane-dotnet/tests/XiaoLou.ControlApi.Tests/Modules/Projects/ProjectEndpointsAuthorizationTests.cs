using System.Text.Json;
using Microsoft.AspNetCore.Http;
using XiaoLou.ControlApi.Modules.Auth;
using XiaoLou.ControlApi.Modules.Projects;
using Xunit;

namespace XiaoLou.ControlApi.Tests.Modules.Projects;

public sealed class ProjectEndpointsAuthorizationTests
{
    private static readonly Guid ProjectAccountId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task LoadAuthorizedProjectAsync_ReturnsStableNotFoundWhenProjectMissing()
    {
        using var env = ClearClientAuthEnvironment();

        var result = await ProjectEndpoints.LoadAuthorizedProjectAsync(
            "missing-project",
            NewHttpContext(),
            new ClientApiOptions(),
            (_, _) => Task.FromResult<Dictionary<string, object?>?>(null),
            CancellationToken.None);

        Assert.Null(result.Project);
        var response = InspectResult(result.Error!);
        Assert.Equal(StatusCodes.Status404NotFound, response.StatusCode);
        Assert.Equal("""{"error":"project not found"}""", response.Body);
    }

    [Fact]
    public async Task LoadAuthorizedProjectAsync_ReturnsForbiddenForConfiguredOwnerMismatch()
    {
        using var env = ClearClientAuthEnvironment();

        var result = await ProjectEndpoints.LoadAuthorizedProjectAsync(
            "project-1",
            NewHttpContext(),
            new ClientApiOptions
            {
                Token = "synthetic-client-token",
                RequireConfiguredAccountGrant = true,
                AllowedAccountOwnerIds = "user:allowed-owner",
            },
            (_, _) => Task.FromResult<Dictionary<string, object?>?>(
                ProjectRow("project-1", ProjectAccountId, "user", "denied-owner")),
            CancellationToken.None);

        Assert.Null(result.Project);
        var response = InspectResult(result.Error!);
        Assert.Equal(StatusCodes.Status403Forbidden, response.StatusCode);
        Assert.Equal(
            """{"error":"account scope is not authorized for this client token"}""",
            response.Body);
    }

    [Fact]
    public async Task LoadAuthorizedProjectAsync_ReturnsProjectForAllowedConfiguredOwner()
    {
        using var env = ClearClientAuthEnvironment();
        var project = ProjectRow("project-1", ProjectAccountId, "organization", "tenant-1");

        var result = await ProjectEndpoints.LoadAuthorizedProjectAsync(
            "project-1",
            NewHttpContext(),
            new ClientApiOptions
            {
                Token = "synthetic-client-token",
                RequireConfiguredAccountGrant = true,
                AllowedAccountOwnerIds = "organization:tenant-1",
            },
            (_, _) => Task.FromResult<Dictionary<string, object?>?>(project),
            CancellationToken.None);

        Assert.Same(project, result.Project);
        Assert.Null(result.Error);
    }

    [Fact]
    public async Task LoadAuthorizedProjectAsync_ReturnsProjectForMatchingAccountHeader()
    {
        using var env = ClearClientAuthEnvironment();
        var project = ProjectRow("project-1", ProjectAccountId, "user", "synthetic-owner");
        var context = NewHttpContext();
        context.Request.Headers["X-XiaoLou-Account-Id"] = ProjectAccountId.ToString("D");

        var result = await ProjectEndpoints.LoadAuthorizedProjectAsync(
            "project-1",
            context,
            new ClientApiOptions
            {
                Token = "synthetic-client-token",
                RequireConfiguredAccountGrant = false,
            },
            (_, _) => Task.FromResult<Dictionary<string, object?>?>(project),
            CancellationToken.None);

        Assert.Same(project, result.Project);
        Assert.Null(result.Error);
    }

    private static DefaultHttpContext NewHttpContext()
    {
        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = "/api/projects/project-1";
        return context;
    }

    private static Dictionary<string, object?> ProjectRow(
        string projectId,
        Guid accountId,
        string ownerType,
        string ownerId)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = projectId,
            ["account_id"] = accountId,
            ["account_owner_type"] = ownerType,
            ["account_owner_id"] = ownerId,
            ["created_by_user_id"] = "synthetic-user",
        };
    }

    private static (int? StatusCode, string Body) InspectResult(IResult result)
    {
        var statusResult = Assert.IsAssignableFrom<IStatusCodeHttpResult>(result);
        var valueResult = Assert.IsAssignableFrom<IValueHttpResult>(result);
        return (statusResult.StatusCode, JsonSerializer.Serialize(valueResult.Value));
    }

    private static EnvironmentVariableScope ClearClientAuthEnvironment()
    {
        return new EnvironmentVariableScope(
            "CLIENT_API_TOKEN",
            "CLIENT_API_TOKEN_HEADER",
            "CLIENT_API_AUTH_PROVIDER",
            "CLIENT_API_REQUIRE_AUTH_PROVIDER",
            "CLIENT_API_REQUIRE_ACCOUNT_SCOPE",
            "CLIENT_API_REQUIRE_CONFIGURED_ACCOUNT_GRANT",
            "CLIENT_API_ALLOWED_ACCOUNT_IDS",
            "CLIENT_API_ALLOWED_ACCOUNT_OWNER_IDS",
            "CLIENT_API_ALLOWED_PERMISSIONS",
            "ClientApi__AllowedPermissions",
            "CONTROL_API_CLIENT_ASSERTION_PERMISSIONS");
    }

    private sealed class EnvironmentVariableScope : IDisposable
    {
        private readonly Dictionary<string, string?> previousValues = new(StringComparer.Ordinal);

        public EnvironmentVariableScope(params string[] names)
        {
            foreach (var name in names)
            {
                previousValues[name] = Environment.GetEnvironmentVariable(name);
                Environment.SetEnvironmentVariable(name, null);
            }
        }

        public void Dispose()
        {
            foreach (var (name, value) in previousValues)
            {
                Environment.SetEnvironmentVariable(name, value);
            }
        }
    }
}
