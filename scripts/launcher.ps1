# SlayTheList - GUI Launcher (Windows / PowerShell + WPF)
# Replaces the CLI menu in start.bat with a proper windowed UI.

param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

# Ensure trailing backslash
# Normalize: strip trailing slashes then re-add one
$Root = $Root.TrimEnd('\', '/')
$Root = "$Root\"

$ApiPort = 8788

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="SlayTheList" Width="340" Height="370"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#1a1a2e" Foreground="#e0e0e0">
  <Grid Margin="28">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="16"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="24"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="12"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="24"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <TextBlock Grid.Row="0" Text="SlayTheList" FontSize="24" FontWeight="Bold"
               Foreground="#c084fc" HorizontalAlignment="Center"/>

    <TextBlock Grid.Row="2" Text="Choose how to launch:" FontSize="13"
               Foreground="#999" HorizontalAlignment="Center"/>

    <Button x:Name="BtnBrowser" Grid.Row="4" Height="42" FontSize="15" FontWeight="SemiBold"
            Content="Browser Mode" Cursor="Hand"
            Background="#6d28d9" Foreground="White" BorderThickness="0">
      <Button.Template>
        <ControlTemplate TargetType="Button">
          <Border x:Name="border" Background="{TemplateBinding Background}"
                  CornerRadius="6" Padding="12,0">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="border" Property="Background" Value="#7c3aed"/>
            </Trigger>
            <Trigger Property="IsPressed" Value="True">
              <Setter TargetName="border" Property="Background" Value="#5b21b6"/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Button.Template>
    </Button>

    <Button x:Name="BtnDesktop" Grid.Row="6" Height="42" FontSize="15" FontWeight="SemiBold"
            Content="Desktop Mode (Electron)" Cursor="Hand"
            Background="#374151" Foreground="#e0e0e0" BorderThickness="0">
      <Button.Template>
        <ControlTemplate TargetType="Button">
          <Border x:Name="border" Background="{TemplateBinding Background}"
                  CornerRadius="6" Padding="12,0">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="border" Property="Background" Value="#4b5563"/>
            </Trigger>
            <Trigger Property="IsPressed" Value="True">
              <Setter TargetName="border" Property="Background" Value="#1f2937"/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Button.Template>
    </Button>

    <Button x:Name="BtnStop" Grid.Row="8" Height="32" FontSize="12"
            Content="Stop running processes" Cursor="Hand"
            Background="Transparent" Foreground="#ef4444" BorderThickness="0">
      <Button.Template>
        <ControlTemplate TargetType="Button">
          <Border x:Name="border" Background="{TemplateBinding Background}"
                  CornerRadius="4" Padding="8,0">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True">
              <Setter TargetName="border" Property="Background" Value="#1f1020"/>
            </Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
      </Button.Template>
    </Button>

    <TextBlock x:Name="TxtStatus" Grid.Row="10" FontSize="11" Foreground="#666"
               HorizontalAlignment="Center" TextAlignment="Center" Text=""/>
  </Grid>
</Window>
"@

$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$btnBrowser = $window.FindName("BtnBrowser")
$btnDesktop = $window.FindName("BtnDesktop")
$btnStop    = $window.FindName("BtnStop")
$txtStatus  = $window.FindName("TxtStatus")

$selectedMode = $null

$btnBrowser.Add_Click({
  $script:selectedMode = "browser"
  $window.Close()
})

$btnDesktop.Add_Click({
  $script:selectedMode = "desktop"
  $window.Close()
})

$btnStop.Add_Click({
  $script:selectedMode = "stop"
  $window.Close()
})

$window.ShowDialog() | Out-Null

if (-not $selectedMode) {
  exit 0
}

# ---------------------------------------------------------------------------
# Helper: kill previous SlayTheList processes
# ---------------------------------------------------------------------------
function Stop-SlayTheList {
  $rootEscaped = [Regex]::Escape((Resolve-Path $Root).Path)
  $rx = '(dev:api|@slaythelist/api run dev|tsx watch src/server.ts|dev:web|@slaythelist/web run dev|next dev|startup-status)'
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    $cmd = $p.CommandLine
    if ($cmd -and ($cmd -match $rootEscaped) -and ($cmd -match $rx)) {
      cmd /c "taskkill /PID $($p.ProcessId) /T /F >nul 2>&1"
    }
  }
  # Kill SlayTheList processes on the API port or web dev ports (4000-4003)
  foreach ($killPort in @($ApiPort, 4000, 4001, 4002, 4003)) {
    $pids = Get-NetTCPConnection -LocalPort $killPort -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue
      if ($p -and $p.CommandLine -and $p.CommandLine -match $rootEscaped) {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Get-Process -Name 'SlayTheList.OverlayAgent' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

# ---------------------------------------------------------------------------
# Helper: preflight checks
# ---------------------------------------------------------------------------
function Test-Preflight {
  if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    [System.Windows.MessageBox]::Show("Dependencies not found. Run install.bat first.", "SlayTheList", "OK", "Error")
    return $false
  }
  if (-not (Test-Path (Join-Path $Root "shared\contracts\dist"))) {
    [System.Windows.MessageBox]::Show("Contracts not built. Run install.bat first.", "SlayTheList", "OK", "Error")
    return $false
  }
  return $true
}

# ---------------------------------------------------------------------------
# Stop mode
# ---------------------------------------------------------------------------
if ($selectedMode -eq "stop") {
  Stop-SlayTheList
  exit 0
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if (-not (Test-Preflight)) { exit 1 }

Stop-SlayTheList

# ---------------------------------------------------------------------------
# Desktop mode
# ---------------------------------------------------------------------------
if ($selectedMode -eq "desktop") {
  Start-Process powershell -WindowStyle Hidden -ArgumentList `
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    "Set-Location -LiteralPath '$Root'; npm run desktop:dev"
  exit 0
}

# ---------------------------------------------------------------------------
# Browser mode
# ---------------------------------------------------------------------------

# Sync overlay assets
$assetSrc = Join-Path $Root "assets\blocked-overlays"
$assetDst = Join-Path $Root "frontend\web\public\blocked-overlays"
if (-not (Test-Path $assetDst)) { New-Item -ItemType Directory -Path $assetDst -Force | Out-Null }
if (Test-Path $assetSrc) {
  Get-ChildItem -Path $assetSrc -File -ErrorAction SilentlyContinue |
    Where-Object { @('.png','.jpg','.jpeg','.webp','.gif') -contains $_.Extension.ToLowerInvariant() } |
    ForEach-Object { Copy-Item $_.FullName -Destination (Join-Path $assetDst $_.Name) -Force }
}

# Find available web port
$WebPort = 4000
while ($true) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $WebPort)
    $listener.Start(); $listener.Stop()
    break
  } catch {
    if ($listener) { try { $listener.Stop() } catch {} }
    $WebPort++
  }
}

# Launch API server
Start-Process powershell -WindowStyle Hidden -ArgumentList `
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
  "Set-Location -LiteralPath '$Root'; npm run dev:api"

# Launch Web dev server
Start-Process powershell -WindowStyle Hidden -ArgumentList `
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
  "Set-Location -LiteralPath '$Root'; `$env:PORT='$WebPort'; npm run dev:web"

# Launch overlay agent if available
$HasOverlay = $false
$overlayPaths = @(
  "desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\win-x64\publish\SlayTheList.OverlayAgent.exe",
  "desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Release\net8.0-windows\SlayTheList.OverlayAgent.exe",
  "desktop\overlay-agent\SlayTheList.OverlayAgent\bin\Debug\net8.0-windows\SlayTheList.OverlayAgent.exe"
)
foreach ($relPath in $overlayPaths) {
  $fullPath = Join-Path $Root $relPath
  if (Test-Path $fullPath) {
    Start-Process $fullPath
    $HasOverlay = $true
    break
  }
}

# Launch startup status GUI
$statusArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  (Join-Path $Root "scripts\startup-status.ps1"),
  "-WebPort", $WebPort, "-ApiPort", $ApiPort)
if ($HasOverlay) { $statusArgs += "-HasOverlay" }
Start-Process powershell -ArgumentList $statusArgs

# Open browser after a delay
Start-Sleep -Seconds 3
Start-Process "http://localhost:$WebPort"
