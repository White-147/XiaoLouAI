$ErrorActionPreference = "Stop"

function Start-XiaoLouService {
  param([string]$Name)

  $service = Get-Service -Name $Name -ErrorAction Stop
  if ($service.Status -ne "Running") {
    Start-Service -Name $Name
  }

  $deadline = (Get-Date).AddSeconds(45)
  do {
    $service.Refresh()
    if ($service.Status -eq "Running") {
      Write-Host "$Name is running"
      return
    }

    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  throw "$Name did not reach Running status within 45 seconds. Current status: $($service.Status)"
}

Start-XiaoLouService XiaoLou-ControlApi
Start-XiaoLouService XiaoLou-LocalModelWorker
Start-XiaoLouService XiaoLou-ClosedApiWorker
