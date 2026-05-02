using System.Diagnostics;
using Microsoft.Extensions.Hosting.WindowsServices;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService();
builder.Services.AddHostedService<LocalModelWorkerProcessService>();

await builder.Build().RunAsync();

internal sealed class LocalModelWorkerProcessService(
    ILogger<LocalModelWorkerProcessService> logger) : BackgroundService
{
    private Process? currentProcess;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var process = StartWorkerProcess();
            currentProcess = process;

            try
            {
                await process.WaitForExitAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                StopWorkerProcess(process);
                break;
            }
            finally
            {
                currentProcess = null;
            }

            if (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            logger.LogWarning(
                "Local model worker exited with code {ExitCode}; restarting in 5 seconds.",
                process.ExitCode);
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);

        var process = currentProcess;
        if (process is not null)
        {
            StopWorkerProcess(process);
        }
    }

    private Process StartWorkerProcess()
    {
        var root = RequireEnvironment("XIAOLOU_ROOT");
        var pythonExe = ResolvePythonExe();
        var workerRoot = Path.Combine(root, "services", "local-model-worker");
        if (!Directory.Exists(workerRoot))
        {
            throw new DirectoryNotFoundException($"Local model worker directory not found: {workerRoot}");
        }

        var logDir = Environment.GetEnvironmentVariable("LOG_DIR")
            ?? Path.Combine(Path.GetDirectoryName(root) ?? root, "xiaolou-logs");
        Directory.CreateDirectory(logDir);

        var startInfo = new ProcessStartInfo
        {
            FileName = pythonExe,
            WorkingDirectory = workerRoot,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        startInfo.ArgumentList.Add("-m");
        startInfo.ArgumentList.Add("app.worker");
        AddArgument(startInfo, "--control-api", Environment.GetEnvironmentVariable("CONTROL_API_BASE_URL") ?? "http://127.0.0.1:4100");
        AddArgument(startInfo, "--lane", Environment.GetEnvironmentVariable("LOCAL_MODEL_WORKER_LANE") ?? "account-media");
        AddArgument(startInfo, "--provider-route", Environment.GetEnvironmentVariable("LOCAL_MODEL_WORKER_PROVIDER_ROUTE") ?? "local-model");
        AddArgument(startInfo, "--worker-id", Environment.GetEnvironmentVariable("LOCAL_MODEL_WORKER_ID") ?? $"{Environment.MachineName}-local-model-worker");
        AddArgument(startInfo, "--poll-seconds", Environment.GetEnvironmentVariable("LOCAL_MODEL_WORKER_POLL_SECONDS") ?? "5");
        AddArgument(startInfo, "--batch-size", Environment.GetEnvironmentVariable("LOCAL_MODEL_WORKER_BATCH_SIZE") ?? "1");
        AddArgument(startInfo, "--lease-seconds", Environment.GetEnvironmentVariable("LOCAL_MODEL_WORKER_LEASE_SECONDS") ?? "300");

        var internalToken = Environment.GetEnvironmentVariable("LOCAL_MODEL_WORKER_INTERNAL_TOKEN")
            ?? Environment.GetEnvironmentVariable("INTERNAL_API_TOKEN");
        if (!string.IsNullOrWhiteSpace(internalToken))
        {
            AddArgument(startInfo, "--internal-token", internalToken);
        }

        foreach (var key in new[] { "CONTROL_API_BASE_URL", "INTERNAL_API_TOKEN" })
        {
            var value = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrWhiteSpace(value))
            {
                startInfo.Environment[key] = value;
            }
        }

        var stdoutLog = Path.Combine(logDir, "local-model-worker-service.out.log");
        var stderrLog = Path.Combine(logDir, "local-model-worker-service.err.log");
        var stdout = TextWriter.Synchronized(new StreamWriter(stdoutLog, append: true) { AutoFlush = true });
        var stderr = TextWriter.Synchronized(new StreamWriter(stderrLog, append: true) { AutoFlush = true });

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data is not null) stdout.WriteLine(e.Data);
        };
        process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is not null) stderr.WriteLine(e.Data);
        };
        process.Exited += (_, _) =>
        {
            stdout.Dispose();
            stderr.Dispose();
        };

        if (!process.Start())
        {
            stdout.Dispose();
            stderr.Dispose();
            throw new InvalidOperationException("Failed to start local model worker process.");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        logger.LogInformation("Started local model worker process {ProcessId}.", process.Id);
        return process;
    }

    private static void AddArgument(ProcessStartInfo startInfo, string name, string value)
    {
        startInfo.ArgumentList.Add(name);
        startInfo.ArgumentList.Add(value);
    }

    private static string ResolvePythonExe()
    {
        var pythonExe = Environment.GetEnvironmentVariable("PYTHON_EXE")
            ?? @"D:\soft\program\Python\Python312\python.exe";
        if (!File.Exists(pythonExe))
        {
            throw new FileNotFoundException($"Python executable not found: {pythonExe}", pythonExe);
        }

        return pythonExe;
    }

    private static string RequireEnvironment(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"{name} environment variable is required.");
        }

        return value;
    }

    private static void StopWorkerProcess(Process process)
    {
        if (process.HasExited)
        {
            return;
        }

        try
        {
            process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
        }
    }
}
