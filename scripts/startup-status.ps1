# SlayTheList — Startup Status GUI (Windows / PowerShell + WPF)
# Launched by start.bat to show real-time service health.
#
# Usage: powershell -ExecutionPolicy Bypass -File startup-status.ps1 -WebPort 4000

param(
  [int]$WebPort = 4000,
  [int]$ApiPort = 8788,
  [switch]$HasOverlay
)

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="SlayTheList" Width="360" Height="280"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#1a1a2e" Foreground="#e0e0e0">
  <Window.Resources>
    <Style x:Key="StatusDot" TargetType="Ellipse">
      <Setter Property="Width" Value="14"/>
      <Setter Property="Height" Value="14"/>
      <Setter Property="Margin" Value="0,0,10,0"/>
      <Setter Property="VerticalAlignment" Value="Center"/>
    </Style>
    <Style x:Key="Label" TargetType="TextBlock">
      <Setter Property="FontSize" Value="14"/>
      <Setter Property="VerticalAlignment" Value="Center"/>
      <Setter Property="Foreground" Value="#e0e0e0"/>
    </Style>
    <Style x:Key="StatusText" TargetType="TextBlock">
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="VerticalAlignment" Value="Center"/>
      <Setter Property="HorizontalAlignment" Value="Right"/>
      <Setter Property="Foreground" Value="#888"/>
    </Style>
  </Window.Resources>
  <Grid Margin="24">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="20"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="12"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="12"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <TextBlock Grid.Row="0" Text="SlayTheList" FontSize="22" FontWeight="Bold"
               Foreground="#c084fc" HorizontalAlignment="Center"/>

    <!-- API row -->
    <Grid Grid.Row="2">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="Auto"/>
        <ColumnDefinition Width="*"/>
        <ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>
      <Ellipse x:Name="DotApi" Grid.Column="0" Style="{StaticResource StatusDot}" Fill="#555"/>
      <TextBlock Grid.Column="1" Style="{StaticResource Label}">API Server</TextBlock>
      <TextBlock x:Name="TxtApi" Grid.Column="2" Style="{StaticResource StatusText}">starting...</TextBlock>
    </Grid>

    <!-- Web row -->
    <Grid Grid.Row="4">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="Auto"/>
        <ColumnDefinition Width="*"/>
        <ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>
      <Ellipse x:Name="DotWeb" Grid.Column="0" Style="{StaticResource StatusDot}" Fill="#555"/>
      <TextBlock Grid.Column="1" Style="{StaticResource Label}">Web App</TextBlock>
      <TextBlock x:Name="TxtWeb" Grid.Column="2" Style="{StaticResource StatusText}">starting...</TextBlock>
    </Grid>

    <!-- Overlay row -->
    <Grid Grid.Row="6">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="Auto"/>
        <ColumnDefinition Width="*"/>
        <ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>
      <Ellipse x:Name="DotOverlay" Grid.Column="0" Style="{StaticResource StatusDot}" Fill="#555"/>
      <TextBlock Grid.Column="1" Style="{StaticResource Label}">Overlay Agent</TextBlock>
      <TextBlock x:Name="TxtOverlay" Grid.Column="2" Style="{StaticResource StatusText}">checking...</TextBlock>
    </Grid>

    <!-- Footer -->
    <TextBlock x:Name="TxtFooter" Grid.Row="8" FontSize="11" Foreground="#666"
               HorizontalAlignment="Center" TextAlignment="Center"
               Text="Checking services..."/>
  </Grid>
</Window>
"@

$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xaml))
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$dotApi     = $window.FindName("DotApi")
$dotWeb     = $window.FindName("DotWeb")
$dotOverlay = $window.FindName("DotOverlay")
$txtApi     = $window.FindName("TxtApi")
$txtWeb     = $window.FindName("TxtWeb")
$txtOverlay = $window.FindName("TxtOverlay")
$txtFooter  = $window.FindName("TxtFooter")

$green  = [System.Windows.Media.Brushes]::LimeGreen
$red    = [System.Windows.Media.Brushes]::Tomato
$yellow = [System.Windows.Media.Brushes]::Gold
$gray   = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(85,85,85))

function Test-Endpoint([string]$url) {
  try {
    $resp = [System.Net.WebRequest]::Create($url).GetResponse()
    $resp.Close()
    return $true
  } catch {
    return $false
  }
}

function Test-ProcessRunning([string]$name) {
  return (Get-Process -Name $name -ErrorAction SilentlyContinue).Count -gt 0
}

$allGreen = $false

$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(2)
$timer.Add_Tick({
  # API check
  $apiOk = Test-Endpoint "http://localhost:$ApiPort/api/health"
  if (-not $apiOk) { $apiOk = Test-Endpoint "http://localhost:$ApiPort/" }
  if ($apiOk) {
    $dotApi.Fill = $green
    $txtApi.Text = "port $ApiPort"
    $txtApi.Foreground = $green
  } else {
    $dotApi.Fill = $yellow
    $txtApi.Text = "starting..."
    $txtApi.Foreground = $yellow
  }

  # Web check
  $webOk = Test-Endpoint "http://localhost:$WebPort/"
  if ($webOk) {
    $dotWeb.Fill = $green
    $txtWeb.Text = "port $WebPort"
    $txtWeb.Foreground = $green
  } else {
    $dotWeb.Fill = $yellow
    $txtWeb.Text = "starting..."
    $txtWeb.Foreground = $yellow
  }

  # Overlay check
  if ($HasOverlay) {
    $overlayOk = Test-ProcessRunning "SlayTheList.OverlayAgent"
    if ($overlayOk) {
      $dotOverlay.Fill = $green
      $txtOverlay.Text = "running"
      $txtOverlay.Foreground = $green
    } else {
      $dotOverlay.Fill = $red
      $txtOverlay.Text = "not found"
      $txtOverlay.Foreground = $red
    }
  } else {
    $dotOverlay.Fill = $gray
    $txtOverlay.Text = "not installed"
    $txtOverlay.Foreground = $gray
  }

  # Footer
  if ($apiOk -and $webOk) {
    $txtFooter.Text = "All services running  —  http://localhost:$WebPort"
    $txtFooter.Foreground = $green
  } else {
    $count = @($apiOk, $webOk) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
    $txtFooter.Text = "Starting services... ($count/2 ready)"
    $txtFooter.Foreground = $yellow
  }
})

$timer.Start()

$window.Add_Closed({ $timer.Stop() })
$window.ShowDialog() | Out-Null
