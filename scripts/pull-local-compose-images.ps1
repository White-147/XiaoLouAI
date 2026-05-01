param(
    [string]$ComposeFile = "docker-compose.yml",
    [switch]$IncludePostgres
)

$ErrorActionPreference = "Stop"

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    throw "Docker CLI not found. Install Docker Desktop, then rerun this script."
}

$services = @("rabbitmq", "redis")
if ($IncludePostgres) {
    $services = @("postgres") + $services
}

Write-Host "Pulling XiaoLouAI local infrastructure images: $($services -join ', ')"
docker compose -f $ComposeFile pull @services
