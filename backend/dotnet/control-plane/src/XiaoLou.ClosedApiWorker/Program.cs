using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using XiaoLou.ClosedApiWorker;
using XiaoLou.ClosedApiWorker.Storage;
using XiaoLou.ClosedApiWorker.Vertex;
using XiaoLou.Infrastructure.Postgres;
using XiaoLou.Infrastructure.Storage;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddWindowsService();
builder.Services.AddXiaoLouPostgres(builder.Configuration);
builder.Services.Configure<ObjectStorageOptions>(builder.Configuration.GetSection("ObjectStorage"));
builder.Services.Configure<ClosedApiWorkerOptions>(builder.Configuration.GetSection("Worker"));
builder.Services.AddSingleton<IObjectStorageSigner, ObjectStorageSigner>();
builder.Services.AddSingleton(sp => VertexOptions.FromConfiguration(sp.GetRequiredService<IConfiguration>()));
builder.Services.AddSingleton<VertexAccessTokenProvider>();
builder.Services.AddSingleton<VertexGeminiImageClient>();
builder.Services.AddSingleton<VertexVeoVideoClient>();
builder.Services.AddSingleton<LocalObjectStorageWriter>();
builder.Services.AddHostedService<ClosedApiWorkerService>();

var host = builder.Build();
await host.RunAsync();
