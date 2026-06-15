# SlayTheList — Setup / Update Wizard (Windows / PowerShell + WPF)
#
# A single GUI wizard shared by two entry points:
#   update.bat          -> -Mode Update   (every-launch updater for testers)
#   install-wizard.bat  -> -Mode Install  (first-time GUI setup)
#
# The wizard OWNS the work: it runs git / npm / dotnet on a background runspace
# and renders a live step list + streaming log, so the window never freezes.
# Errors keep the window open (the "pause" equivalent) so the tester can read them.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File setup-wizard.ps1 -Mode Update  -Root "C:\path\to\SlayTheList\"
#   powershell -ExecutionPolicy Bypass -File setup-wizard.ps1 -Mode Install -Root "C:\path\to\SlayTheList\"

param(
  [ValidateSet("Update", "Install")]
  [string]$Mode = "Update",
  [string]$Root
)

if (-not $Root) { $Root = (Split-Path -Parent $PSScriptRoot) }
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

# --- Shared state between the UI thread and the worker runspace --------------
$sync = [hashtable]::Synchronized(@{})
$sync.Steps    = [System.Collections.ArrayList]::Synchronized([System.Collections.ArrayList]::new())
$sync.LogLines = [System.Collections.ArrayList]::Synchronized([System.Collections.ArrayList]::new())
$sync.Done     = $false
$sync.Outcome  = ""   # success | warn | fail
$sync.Status   = "Starting..."
$sync.Launch   = $false
$sync.Mode     = $Mode

# Define the step list up front (some steps resolve to "skipped" at runtime).
function New-Step([string]$key, [string]$label) {
  return @{ Key = $key; Label = $label; Status = "Pending"; Detail = "" }
}
if ($Mode -eq "Update") {
  [void]$sync.Steps.Add((New-Step "check"     "Check installation"))
  [void]$sync.Steps.Add((New-Step "pull"      "Download latest version"))
  [void]$sync.Steps.Add((New-Step "deps"      "Update dependencies"))
  [void]$sync.Steps.Add((New-Step "contracts" "Build shared types"))
  [void]$sync.Steps.Add((New-Step "overlay"   "Rebuild overlay agent"))
  [void]$sync.Steps.Add((New-Step "launch"    "Launch SlayTheList"))
} else {
  [void]$sync.Steps.Add((New-Step "node"      "Check Node.js"))
  [void]$sync.Steps.Add((New-Step "dotnet"    "Check .NET (overlay)"))
  [void]$sync.Steps.Add((New-Step "deps"      "Install dependencies"))
  [void]$sync.Steps.Add((New-Step "contracts" "Build shared types"))
  [void]$sync.Steps.Add((New-Step "env"       "Create config file"))
  [void]$sync.Steps.Add((New-Step "overlay"   "Build overlay agent"))
}

# --- Window ------------------------------------------------------------------
$title    = if ($Mode -eq "Update") { "SlayTheList Updater" } else { "SlayTheList Setup" }
$subtitle = if ($Mode -eq "Update") { "Getting the latest version, then launching." } else { "First-time install. This only needs to run once." }

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="$title" Width="560" Height="600"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#1a1a2e" Foreground="#e0e0e0"
        FontFamily="Segoe UI">
  <Grid Margin="24">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="18"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="16"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="12"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="16"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <TextBlock x:Name="TxtTitle" Grid.Row="0" FontSize="22" FontWeight="Bold"
               Foreground="#c084fc" Text="$title"/>
    <TextBlock x:Name="TxtSubtitle" Grid.Row="1" FontSize="12" Foreground="#9aa" Margin="0,4,0,0"
               TextWrapping="Wrap" Text="$subtitle"/>

    <StackPanel x:Name="StepPanel" Grid.Row="3"/>

    <TextBlock Grid.Row="5" FontSize="11" Foreground="#666" Text="Details"/>
    <Border Grid.Row="6" Background="#11111f" BorderBrush="#333" BorderThickness="1" CornerRadius="4">
      <TextBox x:Name="TxtLog" Background="Transparent" Foreground="#9fb3c8" BorderThickness="0"
               FontFamily="Consolas" FontSize="11" IsReadOnly="True" Padding="8"
               TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"/>
    </Border>

    <TextBlock x:Name="TxtStatus" Grid.Row="8" FontSize="13" Foreground="#c084fc"
               TextWrapping="Wrap" Text="Starting..."/>

    <StackPanel Grid.Row="10" Orientation="Horizontal" HorizontalAlignment="Right">
      <Button x:Name="BtnLaunch" Content="Launch SlayTheList" Visibility="Collapsed"
              Padding="14,7" Margin="0,0,10,0" Background="#7c3aed" Foreground="White"
              BorderThickness="0" FontSize="13" Cursor="Hand"/>
      <Button x:Name="BtnClose" Content="Close" IsEnabled="False"
              Padding="14,7" Background="#2a2a44" Foreground="#e0e0e0"
              BorderThickness="0" FontSize="13" Cursor="Hand"/>
    </StackPanel>
  </Grid>
</Window>
"@

$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$stepPanel = $window.FindName("StepPanel")
$txtLog    = $window.FindName("TxtLog")
$txtStatus = $window.FindName("TxtStatus")
$btnLaunch = $window.FindName("BtnLaunch")
$btnClose  = $window.FindName("BtnClose")

# Brushes
$cGray   = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(85,85,85))
$cGold   = [System.Windows.Media.Brushes]::Gold
$cGreen  = [System.Windows.Media.Brushes]::LimeGreen
$cRed     = [System.Windows.Media.Brushes]::Tomato
$cOrange  = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(251,146,60))
$cText   = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(224,224,224))
$cMuted  = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(136,136,136))

# Build a UI row per step; keep references for fast updates.
$rows = @()
foreach ($s in $sync.Steps) {
  $grid = [System.Windows.Controls.Grid]::new()
  $grid.Margin = [System.Windows.Thickness]::new(0,0,0,9)
  $c0 = [System.Windows.Controls.ColumnDefinition]::new(); $c0.Width = "Auto"
  $c1 = [System.Windows.Controls.ColumnDefinition]::new(); $c1.Width = "*"
  $c2 = [System.Windows.Controls.ColumnDefinition]::new(); $c2.Width = "Auto"
  $grid.ColumnDefinitions.Add($c0); $grid.ColumnDefinitions.Add($c1); $grid.ColumnDefinitions.Add($c2)

  $dot = [System.Windows.Shapes.Ellipse]::new()
  $dot.Width = 13; $dot.Height = 13; $dot.Fill = $cGray
  $dot.Margin = [System.Windows.Thickness]::new(0,0,12,0)
  $dot.VerticalAlignment = "Center"
  [System.Windows.Controls.Grid]::SetColumn($dot, 0)

  $lbl = [System.Windows.Controls.TextBlock]::new()
  $lbl.Text = $s.Label; $lbl.FontSize = 14; $lbl.Foreground = $cMuted
  $lbl.VerticalAlignment = "Center"
  [System.Windows.Controls.Grid]::SetColumn($lbl, 1)

  $st = [System.Windows.Controls.TextBlock]::new()
  $st.FontSize = 12; $st.Foreground = $cMuted; $st.VerticalAlignment = "Center"
  $st.HorizontalAlignment = "Right"
  [System.Windows.Controls.Grid]::SetColumn($st, 2)

  [void]$grid.Children.Add($dot); [void]$grid.Children.Add($lbl); [void]$grid.Children.Add($st)
  [void]$stepPanel.Children.Add($grid)
  $rows += @{ Dot = $dot; Label = $lbl; Status = $st }
}

# --- The worker: does all the real work, mutating $sync ----------------------
$worker = {
  Set-Location -LiteralPath $Root

  function Log([string]$m) { [void]$sync.LogLines.Add($m) }
  function Step([string]$key) { foreach ($s in $sync.Steps) { if ($s.Key -eq $key) { return $s } } }
  function Begin([string]$key)  { (Step $key).Status = "Running" }
  function Ok([string]$key, [string]$d = "done")     { $s = Step $key; $s.Detail = $d; $s.Status = "Done" }
  function Skip([string]$key, [string]$d = "skipped"){ $s = Step $key; $s.Detail = $d; $s.Status = "Skip" }
  function Warn([string]$key, [string]$d)            { $s = Step $key; $s.Detail = $d; $s.Status = "Warn" }
  function Fail([string]$key, [string]$d)            { $s = Step $key; $s.Detail = $d; $s.Status = "Fail" }

  # Run an external command, streaming each output line into the log. Returns exit code.
  function Run([string]$file, [string[]]$cmdArgs) {
    Log ("> " + $file + " " + ($cmdArgs -join " "))
    try {
      & $file @cmdArgs 2>&1 | ForEach-Object { Log ([string]$_) }
      return $LASTEXITCODE
    } catch {
      Log ("ERROR: " + $_.Exception.Message)
      return 1
    }
  }

  function Refresh-Path {
    $m = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $u = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = ($m, $u | Where-Object { $_ }) -join ";"
  }

  function Has([string]$cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

  try {
    if ($sync.Mode -eq "Update") {
      # ---- 1. Check installation ------------------------------------------
      Begin "check"
      $sync.Status = "Checking your installation..."
      if (-not (Has "git")) {
        Fail "check" "git not found"
        Log "[!!] Git is not installed / not on PATH."
        $sync.Status = "This folder isn't set up for updates (git not installed). Ask Nico for help."
        $sync.Outcome = "fail"; $sync.Done = $true; return
      }
      if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
        Fail "check" "not a git checkout"
        Log "[!!] $Root is not a git checkout."
        $sync.Status = "This folder isn't a git checkout. Re-download SlayTheList or ask Nico."
        $sync.Outcome = "fail"; $sync.Done = $true; return
      }
      $old = (& git -C $Root rev-parse HEAD 2>$null)
      if ($old) { $old = $old.Trim() }
      Ok "check" "ok"

      # ---- 2. Pull latest (fast-forward only) ------------------------------
      Begin "pull"
      $sync.Status = "Downloading the latest version..."
      $pullCode = Run "git" @("-C", $Root, "pull", "--ff-only")
      $new = (& git -C $Root rev-parse HEAD 2>$null)
      if ($new) { $new = $new.Trim() }

      if ($pullCode -ne 0) {
        # Never hard-reset / stash silently. Warn and launch the existing copy.
        Warn "pull" "couldn't update"
        Log "[!!] Update couldn't be applied cleanly (local changes, diverged history, or no network)."
        Skip "deps" "skipped"; Skip "contracts" "skipped"; Skip "overlay" "skipped"
        $sync.Status = "Couldn't fetch updates - launching the current version. Tell Nico if this keeps happening."
        $sync.Outcome = "warn"
      }
      elseif ($old -eq $new) {
        Ok "pull" "already up to date"
        Skip "deps" "not needed"; Skip "contracts" "not needed"; Skip "overlay" "not needed"
        Log "[OK] Already up to date."
        $sync.Status = "Already up to date - launching."
        $sync.Outcome = "success"
      }
      else {
        Ok "pull" "updated"
        Log ("[OK] Updated " + $old.Substring(0, [Math]::Min(7, $old.Length)) + " -> " + $new.Substring(0, [Math]::Min(7, $new.Length)))
        $changed = @(& git -C $Root diff --name-only $old $new 2>$null)

        # ---- 3. Dependencies (only if package manifests changed) ----------
        $depsChanged = $false
        foreach ($f in $changed) {
          if ($f -match "(^|/)package-lock\.json$" -or $f -match "(^|/)package\.json$") { $depsChanged = $true; break }
        }
        if ($depsChanged) {
          Begin "deps"
          $sync.Status = "Updating dependencies (this can take a minute)..."
          $code = Run "npm" @("install")
          if ($code -ne 0) {
            Fail "deps" "failed"
            $sync.Status = "Dependency install failed. Show this window to Nico."
            $sync.Outcome = "fail"; $sync.Done = $true; return
          }
          Ok "deps" "updated"
        } else {
          Skip "deps" "no changes"
        }

        # ---- 4. Build shared types (always, after an update) --------------
        Begin "contracts"
        $sync.Status = "Building shared types..."
        $code = Run "npm" @("run", "build:contracts")
        if ($code -ne 0) {
          Fail "contracts" "failed"
          $sync.Status = "Shared types failed to build. Show this window to Nico."
          $sync.Outcome = "fail"; $sync.Done = $true; return
        }
        Ok "contracts" "built"

        # ---- 5. Rebuild overlay agent (only if its sources changed) -------
        $overlayChanged = $false
        foreach ($f in $changed) { if ($f -match "^desktop/overlay-agent/") { $overlayChanged = $true; break } }
        if ($overlayChanged -and (Has "dotnet")) {
          Begin "overlay"
          $sync.Status = "Rebuilding the overlay agent..."
          $code = Run "dotnet" @("publish", (Join-Path $Root "desktop\overlay-agent\SlayTheList.OverlayAgent"), "-c", "Release")
          if ($code -ne 0) { Warn "overlay" "build failed"; Log "[!!] Overlay rebuild failed - the web app still works." }
          else { Ok "overlay" "rebuilt" }
        } elseif ($overlayChanged) {
          Skip "overlay" ".NET missing"
          Log "[--] .NET not available - skipping overlay rebuild."
        } else {
          Skip "overlay" "no changes"
        }

        if ($sync.Outcome -ne "fail") {
          $sync.Status = "Update complete - launching SlayTheList..."
          $sync.Outcome = "success"
        }
      }

      # ---- 6. Launch (always, unless a fatal failure already returned) -----
      Begin "launch"
      $startBat = Join-Path $Root "start.bat"
      Log "> start.bat browser"
      Start-Process -FilePath $startBat -ArgumentList "browser" -WorkingDirectory $Root -WindowStyle Hidden
      Ok "launch" "launched"
      $sync.Launch = $true
      $sync.Done = $true
      return
    }

    # ======================== INSTALL MODE ================================
    # ---- 1. Node.js ------------------------------------------------------
    Begin "node"
    $sync.Status = "Checking Node.js..."
    $nodeOk = $false
    if (Has "node") {
      try {
        $major = & node -e "process.stdout.write(String(process.versions.node.split('.')[0]))"
        if ([int]$major -ge 20) { $nodeOk = $true; Ok "node" ("v" + $major) }
        else { Log ("[!!] Node v" + $major + " found but v20+ is required.") }
      } catch {}
    }
    if (-not $nodeOk) {
      $sync.Status = "Installing Node.js via winget..."
      $code = Run "winget" @("install", "OpenJS.NodeJS.LTS", "--accept-source-agreements", "--accept-package-agreements")
      Refresh-Path
      if (-not (Has "node")) {
        Fail "node" "install failed"
        Log "[!!] Could not install Node.js automatically. Install Node 20+ from https://nodejs.org then re-run."
        $sync.Status = "Node.js install failed. Install Node 20+ from nodejs.org, then run Install again."
        $sync.Outcome = "fail"; $sync.Done = $true; return
      }
      Ok "node" "installed"
    }

    # ---- 2. .NET (overlay agent, optional) -------------------------------
    Begin "dotnet"
    $sync.Status = "Checking .NET..."
    if (Has "dotnet") {
      Ok "dotnet" "found"
    } else {
      $sync.Status = "Installing .NET 8 SDK via winget..."
      $code = Run "winget" @("install", "Microsoft.DotNet.SDK.8", "--accept-source-agreements", "--accept-package-agreements")
      Refresh-Path
      if (Has "dotnet") { Ok "dotnet" "installed" }
      else { Warn "dotnet" "skipped"; Log "[--] .NET unavailable - the overlay won't build, but the web app will work." }
    }

    # ---- 3. npm install --------------------------------------------------
    Begin "deps"
    $sync.Status = "Installing dependencies (this can take a few minutes)..."
    $code = Run "npm" @("install")
    if ($code -ne 0) {
      Fail "deps" "failed"
      $sync.Status = "Dependency install failed. Show this window to Nico."
      $sync.Outcome = "fail"; $sync.Done = $true; return
    }
    Ok "deps" "installed"

    # ---- 4. Build shared contracts ---------------------------------------
    Begin "contracts"
    $sync.Status = "Building shared types..."
    $code = Run "npm" @("run", "build:contracts")
    if ($code -ne 0) {
      Fail "contracts" "failed"
      $sync.Status = "Shared types failed to build. Show this window to Nico."
      $sync.Outcome = "fail"; $sync.Done = $true; return
    }
    Ok "contracts" "built"

    # ---- 5. .env config --------------------------------------------------
    Begin "env"
    $envFile = Join-Path $Root "backend\api\.env"
    $envExample = Join-Path $Root "backend\api\.env.example"
    if (Test-Path -LiteralPath $envFile) {
      Ok "env" "already exists"
    } elseif (Test-Path -LiteralPath $envExample) {
      Copy-Item -LiteralPath $envExample -Destination $envFile
      Ok "env" "created"
      Log "[OK] Created backend\api\.env from .env.example"
    } else {
      Warn "env" "no template"
      Log "[--] No .env.example found - you may need to create backend\api\.env manually."
    }

    # ---- 6. Build overlay agent ------------------------------------------
    Begin "overlay"
    if (Has "dotnet") {
      $sync.Status = "Building the overlay agent..."
      $code = Run "dotnet" @("publish", (Join-Path $Root "desktop\overlay-agent\SlayTheList.OverlayAgent"), "-c", "Release")
      if ($code -ne 0) { Warn "overlay" "build failed"; Log "[!!] Overlay build failed - the web app still works without it." }
      else { Ok "overlay" "built" }
    } else {
      Skip "overlay" ".NET missing"
      Log "[--] .NET not available - skipping overlay build."
    }

    $sync.Status = "Installation complete! Click Launch SlayTheList to start."
    $sync.Outcome = "success"
    $sync.Done = $true
  }
  catch {
    Log ("FATAL: " + $_.Exception.Message)
    $sync.Status = "Something went wrong. Show this window to Nico."
    $sync.Outcome = "fail"
    $sync.Done = $true
  }
}

# --- Start the worker on its own runspace ------------------------------------
$rs = [runspacefactory]::CreateRunspace()
$rs.ApartmentState = "STA"
$rs.ThreadOptions = "ReuseThread"
$rs.Open()
$rs.SessionStateProxy.SetVariable("sync", $sync)
$rs.SessionStateProxy.SetVariable("Root", $Root)
$ps = [powershell]::Create()
$ps.Runspace = $rs
[void]$ps.AddScript($worker.ToString())
$async = $ps.BeginInvoke()

# --- UI render loop ----------------------------------------------------------
$script:tick = 0
$script:logShown = 0
$script:finalized = $false
$script:closeAt = $null

$dotFor = @{ Pending = $cGray; Running = $cGold; Done = $cGreen; Warn = $cOrange; Fail = $cRed; Skip = $cGray }

function Launch-App {
  try {
    Start-Process -FilePath (Join-Path $Root "start.bat") -ArgumentList "browser" -WorkingDirectory $Root -WindowStyle Hidden
  } catch {}
}

$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromMilliseconds(180)
$timer.Add_Tick({
  $script:tick++
  $dots = "." * (($script:tick % 3) + 1)

  # Steps
  for ($i = 0; $i -lt $sync.Steps.Count; $i++) {
    $s = $sync.Steps[$i]
    $row = $rows[$i]
    $row.Dot.Fill = $dotFor[$s.Status]
    switch ($s.Status) {
      "Pending" { $row.Label.Foreground = $cMuted; $row.Status.Text = "";              $row.Status.Foreground = $cMuted }
      "Running" { $row.Label.Foreground = $cText;  $row.Status.Text = "working$dots";   $row.Status.Foreground = $cGold }
      "Done"    { $row.Label.Foreground = $cText;  $row.Status.Text = $s.Detail;        $row.Status.Foreground = $cGreen }
      "Warn"    { $row.Label.Foreground = $cText;  $row.Status.Text = $s.Detail;        $row.Status.Foreground = $cOrange }
      "Fail"    { $row.Label.Foreground = $cText;  $row.Status.Text = $s.Detail;        $row.Status.Foreground = $cRed }
      "Skip"    { $row.Label.Foreground = $cMuted; $row.Status.Text = $s.Detail;        $row.Status.Foreground = $cMuted }
    }
  }

  # Stream new log lines
  $count = $sync.LogLines.Count
  if ($count -gt $script:logShown) {
    $append = ($sync.LogLines.GetRange($script:logShown, $count - $script:logShown)) -join "`r`n"
    if ($txtLog.Text.Length -gt 0) { $txtLog.AppendText("`r`n") }
    $txtLog.AppendText($append)
    $txtLog.ScrollToEnd()
    $script:logShown = $count
  }

  $txtStatus.Text = $sync.Status
  switch ($sync.Outcome) {
    "fail"    { $txtStatus.Foreground = $cRed }
    "warn"    { $txtStatus.Foreground = $cOrange }
    "success" { $txtStatus.Foreground = $cGreen }
    default   { $txtStatus.Foreground = $cGold }
  }

  # Finalize once
  if ($sync.Done -and -not $script:finalized) {
    $script:finalized = $true
    $btnClose.IsEnabled = $true
    if ($sync.Mode -eq "Install" -and $sync.Outcome -eq "success") {
      $btnLaunch.Visibility = "Visible"
    }
    if ($sync.Mode -eq "Update" -and $sync.Outcome -ne "fail") {
      # Updater launched the app itself; auto-close shortly so the tester isn't left with two windows.
      $script:closeAt = $script:tick + 22   # ~4s at 180ms/tick
    }
  }

  if ($script:closeAt -and $script:tick -ge $script:closeAt) {
    $timer.Stop()
    $window.Close()
  }
})

$btnClose.Add_Click({ $timer.Stop(); $window.Close() })
$btnLaunch.Add_Click({ Launch-App; $btnLaunch.IsEnabled = $false; $script:closeAt = $script:tick + 8 })

$timer.Start()
$window.Add_Closed({
  $timer.Stop()
  try { if (-not $async.IsCompleted) { $ps.Stop() } } catch {}
  try { $ps.Dispose(); $rs.Close() } catch {}
})
$window.ShowDialog() | Out-Null
