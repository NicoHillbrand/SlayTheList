using System.Net.WebSockets;
using System.Net.Http;
using System.IO;
using System.Media;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace SlayTheList.OverlayAgent;

public partial class MainWindow : Window
{
    private const int ZoneGoldUnlockCost = 10;
    private readonly DispatcherTimer _windowSyncTimer;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);
    private readonly bool _visualOnlyOverlay = ReadVisualOnlySetting();
    private readonly HttpClient _httpClient = new();
    private readonly string _apiBaseUrl = ResolveApiBaseUrl();
    private readonly string? _goldUnlockSoundPath = ResolveGoldUnlockSoundPath();
    private const int FocusAcquireTicks = 1;
    private const int FocusReleaseTicks = 3;
    private const int WmMouseActivate = 0x0021;
    private const int MaNoActivate = 3;
    private const uint SndAsync = 0x0001;
    private const uint SndNodefault = 0x0002;
    private const uint SndFilename = 0x00020000;

    private OverlayPayload? _lastOverlayState;
    private IntPtr _gameWindowHandle = IntPtr.Zero;
    private IntPtr _overlayWindowHandle = IntPtr.Zero;
    private string _titleHint = "Slay the Spire 2";
    private bool _isGameInForeground;
    private int _focusPositiveStreak;
    private int _focusNegativeStreak;
    private readonly List<string> _overlayImagePaths = [];
    private string? _statusOverrideText;
    private DateTime _statusOverrideUntilUtc;

    [DllImport("winmm.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool PlaySound(string? soundName, IntPtr moduleHandle, uint soundFlags);

    public MainWindow()
    {
        InitializeComponent();

        _windowSyncTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(250),
        };
        _windowSyncTimer.Tick += (_, _) => SyncOverlayWindow();
        _windowSyncTimer.Start();

        LoadOverlayImagePaths();
        SourceInitialized += (_, _) => AttachNoActivateWindowHook();
        Loaded += (_, _) => _ = RunWebSocketLoop();
        Closed += (_, _) =>
        {
            _windowSyncTimer.Stop();
            _httpClient.Dispose();
        };
    }

    private async Task RunWebSocketLoop()
    {
        var wsUrl = Environment.GetEnvironmentVariable("SLAYTHELIST_WS_URL") ?? "ws://localhost:8788/ws";
        var backoffMs = 1000;

        while (true)
        {
            try
            {
                using var socket = new ClientWebSocket();
                await socket.ConnectAsync(new Uri(wsUrl), CancellationToken.None);
                backoffMs = 1000;
                Dispatcher.Invoke(() => StatusText.Text = "Connected to API");

                while (socket.State == WebSocketState.Open)
                {
                    var message = await ReceiveText(socket);
                    if (string.IsNullOrWhiteSpace(message))
                    {
                        continue;
                    }

                    EventEnvelope? envelope = null;
                    try
                    {
                        envelope = JsonSerializer.Deserialize<EventEnvelope>(message, _jsonOptions);
                    }
                    catch
                    {
                        // Ignore malformed payloads and keep receiving.
                    }

                    if (envelope?.Type == "overlay_state" && envelope.Payload is not null)
                    {
                        _lastOverlayState = envelope.Payload;
                        _titleHint = envelope.Payload.GameWindow.TitleHint;
                        Dispatcher.Invoke(RenderLockedZones);
                    }
                }
            }
            catch
            {
                Dispatcher.Invoke(() => StatusText.Text = $"Disconnected, retrying in {backoffMs / 1000.0:0.0}s");
            }

            await Task.Delay(backoffMs);
            backoffMs = Math.Min(backoffMs * 2, 8000);
        }
    }

    private static async Task<string> ReceiveText(ClientWebSocket socket)
    {
        var buffer = new byte[8192];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return string.Empty;
            }
            stream.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);

        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private void SyncOverlayWindow()
    {
        if (_gameWindowHandle == IntPtr.Zero)
        {
            _gameWindowHandle = NativeMethods.FindWindowByTitleContains(_titleHint);
            if (_gameWindowHandle == IntPtr.Zero)
            {
                StatusText.Text = "Waiting for game window...";
                SetOverlayVisible(false);
                return;
            }
        }

        if (!NativeMethods.GetWindowRect(_gameWindowHandle, out var rect))
        {
            _gameWindowHandle = IntPtr.Zero;
            StatusText.Text = "Lost game window handle, reacquiring...";
            SetOverlayVisible(false);
            return;
        }

        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0)
        {
            return;
        }

        var rawFocus = IsGameInForeground();
        UpdateDebouncedFocusState(rawFocus);
        UpdateStatusText();
        if (!_isGameInForeground)
        {
            SetOverlayVisible(false);
            return;
        }

        Left = rect.Left;
        Top = rect.Top;
        Width = width;
        Height = height;
        SetOverlayVisible(true);
    }

    private void RenderLockedZones()
    {
        OverlayCanvas.Children.Clear();
        var allZones = _lastOverlayState?.Zones ?? [];
        var lockedZones = allZones.Where((z) => z.IsLocked && z.Zone.Enabled).ToList();

        foreach (var zoneState in lockedZones)
        {
            var lockText = BuildLockText(zoneState.Zone.UnlockMode, zoneState.RequiredTodoTitles);
            var lockFontSize = CalculateLockFontSize(zoneState.Zone.Width, zoneState.Zone.Height);
            var isGoldUnlock = string.Equals(zoneState.Zone.UnlockMode, "gold", StringComparison.OrdinalIgnoreCase);
            var contentStack = new StackPanel
            {
                Orientation = Orientation.Vertical,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };
            contentStack.Children.Add(new TextBlock
            {
                Text = lockText,
                Foreground = new SolidColorBrush(Color.FromArgb(248, 248, 250, 252)),
                FontSize = lockFontSize,
                FontWeight = FontWeights.Bold,
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                FontFamily = new FontFamily("Georgia"),
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            if (isGoldUnlock)
            {
                contentStack.Children.Add(new Border
                {
                    Margin = new Thickness(0, 10, 0, 0),
                    Padding = new Thickness(10, 5, 10, 5),
                    CornerRadius = new CornerRadius(999),
                    Background = new SolidColorBrush(Color.FromArgb(232, 73, 53, 18)),
                    BorderBrush = new SolidColorBrush(Color.FromArgb(210, 212, 170, 71)),
                    BorderThickness = new Thickness(1),
                    IsHitTestVisible = false,
                    Child = new TextBlock
                    {
                        Text = $"Unlock for {ZoneGoldUnlockCost} gold",
                        Foreground = new SolidColorBrush(Color.FromArgb(255, 248, 223, 139)),
                        FontSize = Math.Max(11, lockFontSize * 0.82),
                        FontWeight = FontWeights.SemiBold,
                        TextAlignment = TextAlignment.Center,
                        HorizontalAlignment = HorizontalAlignment.Center,
                    },
                });
            }
            var border = new Border
            {
                Width = zoneState.Zone.Width,
                Height = zoneState.Zone.Height,
                Background = CreateBlockedBackgroundBrush(zoneState.Zone.Id),
                BorderBrush = new SolidColorBrush(Color.FromArgb(220, 22, 101, 52)),
                BorderThickness = new Thickness(2),
                ToolTip = isGoldUnlock
                    ? $"Click to unlock {zoneState.Zone.Name} for {ZoneGoldUnlockCost} gold"
                    : $"Locked: {zoneState.Zone.Name}",
                IsHitTestVisible = !_visualOnlyOverlay,
                Cursor = isGoldUnlock
                    ? Cursors.Hand
                    : Cursors.Arrow,
                Child = new Border
                {
                    Background = Brushes.Transparent,
                    Padding = new Thickness(6, 4, 6, 4),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    Child = contentStack,
                    IsHitTestVisible = false,
                },
            };
            if (isGoldUnlock)
            {
                border.MouseLeftButtonUp += async (_, args) =>
                {
                    args.Handled = true;
                    await TryUnlockZoneWithGold(zoneState.Zone.Id, zoneState.Zone.Name);
                };
            }
            Canvas.SetLeft(border, zoneState.Zone.X);
            Canvas.SetTop(border, zoneState.Zone.Y);
            OverlayCanvas.Children.Add(border);
        }

        if (_visualOnlyOverlay && lockedZones.Count == 0)
        {
            // Fallback visual sign so users can confirm overlay rendering even without active locked zones.
            const double previewWidth = 320;
            const double previewHeight = 120;
            var preview = new Border
            {
                Width = previewWidth,
                Height = previewHeight,
                Background = new SolidColorBrush(Color.FromArgb(70, 59, 130, 246)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(190, 147, 197, 253)),
                BorderThickness = new Thickness(2),
                IsHitTestVisible = false,
                Child = new TextBlock
                {
                    Text = "Overlay visual sign active",
                    Foreground = new SolidColorBrush(Color.FromArgb(245, 219, 234, 254)),
                    FontSize = 14,
                    FontWeight = FontWeights.SemiBold,
                    TextAlignment = TextAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    Margin = new Thickness(8),
                },
            };
            Canvas.SetLeft(preview, Math.Max(0, (Width - previewWidth) / 2));
            Canvas.SetTop(preview, Math.Max(0, Height * 0.1));
            OverlayCanvas.Children.Add(preview);
        }

        UpdateStatusText();
    }

    private async Task TryUnlockZoneWithGold(string zoneId, string zoneName)
    {
        try
        {
            using var response = await _httpClient.PostAsync($"{_apiBaseUrl}/api/zones/{zoneId}/gold-unlock", content: null);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                Dispatcher.Invoke(() => ShowTransientStatus(
                    string.IsNullOrWhiteSpace(body) ? $"Failed to unlock {zoneName}" : body,
                    3500));
                return;
            }

            var soundPlayed = PlayGoldUnlockSound();
            Dispatcher.Invoke(() => ShowTransientStatus(
                soundPlayed
                    ? $"Unlocked {zoneName} for {ZoneGoldUnlockCost} gold"
                    : $"Unlocked {zoneName} for {ZoneGoldUnlockCost} gold | sound failed",
                3500));
        }
        catch
        {
            Dispatcher.Invoke(() => ShowTransientStatus($"Failed to reach API for {zoneName} unlock", 3500));
        }
    }

    private bool PlayGoldUnlockSound()
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(_goldUnlockSoundPath) && File.Exists(_goldUnlockSoundPath))
            {
                if (PlaySound(_goldUnlockSoundPath, IntPtr.Zero, SndAsync | SndFilename | SndNodefault))
                {
                    return true;
                }
            }
        }
        catch
        {
            // Fall back below.
        }

        try
        {
            SystemSounds.Asterisk.Play();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private bool IsGameInForeground()
    {
        if (_gameWindowHandle == IntPtr.Zero)
        {
            return false;
        }

        var foregroundWindow = NativeMethods.GetForegroundWindow();
        if (foregroundWindow == IntPtr.Zero)
        {
            return false;
        }

        if (foregroundWindow == _gameWindowHandle)
        {
            return true;
        }

        if (foregroundWindow == _overlayWindowHandle)
        {
            return true;
        }

        var foregroundTitle = NativeMethods.GetWindowTitle(foregroundWindow);
        if (!string.IsNullOrWhiteSpace(foregroundTitle) &&
            foregroundTitle.Contains(_titleHint, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        _ = NativeMethods.GetWindowThreadProcessId(_gameWindowHandle, out var gamePid);
        _ = NativeMethods.GetWindowThreadProcessId(foregroundWindow, out var foregroundPid);
        return gamePid != 0 && foregroundPid != 0 && gamePid == foregroundPid;
    }

    private void SetOverlayVisible(bool shouldBeVisible)
    {
        var actuallyVisible = IsVisible;
        if (shouldBeVisible == actuallyVisible)
        {
            return;
        }

        if (shouldBeVisible)
        {
            Show();
        }
        else
        {
            Hide();
        }
    }

    private void UpdateDebouncedFocusState(bool isFocusedNow)
    {
        if (isFocusedNow)
        {
            _focusPositiveStreak = Math.Min(FocusAcquireTicks, _focusPositiveStreak + 1);
            _focusNegativeStreak = 0;
            if (_focusPositiveStreak >= FocusAcquireTicks)
            {
                _isGameInForeground = true;
            }
            return;
        }

        _focusNegativeStreak = Math.Min(FocusReleaseTicks, _focusNegativeStreak + 1);
        _focusPositiveStreak = 0;
        if (_focusNegativeStreak >= FocusReleaseTicks)
        {
            _isGameInForeground = false;
        }
    }

    private void UpdateStatusText()
    {
        if (!string.IsNullOrWhiteSpace(_statusOverrideText) && DateTime.UtcNow < _statusOverrideUntilUtc)
        {
            StatusText.Text = _statusOverrideText;
            return;
        }

        _statusOverrideText = null;
        var lockedCount = _lastOverlayState?.Zones.Count((z) => z.IsLocked && z.Zone.Enabled) ?? 0;
        var focusLabel = _isGameInForeground ? "focused" : "background";
        if (lockedCount > 0)
        {
            StatusText.Text = $"Tracking {_titleHint} ({focusLabel}) | Locked zones: {lockedCount} | {(_visualOnlyOverlay ? "visual only" : "blocking")}";
            return;
        }

        StatusText.Text = $"Tracking {_titleHint} ({focusLabel}) | No locked zones | {(_visualOnlyOverlay ? "visual sign active" : "blocking armed")}";
    }

    private void ShowTransientStatus(string text, int durationMs)
    {
        _statusOverrideText = text;
        _statusOverrideUntilUtc = DateTime.UtcNow.AddMilliseconds(durationMs);
        StatusText.Text = text;
    }

    private static string BuildLockText(string unlockMode, IReadOnlyList<string> requiredTodoTitles)
    {
        if (string.Equals(unlockMode, "gold", StringComparison.OrdinalIgnoreCase))
        {
            return $"Unlock for\n\n{ZoneGoldUnlockCost} gold";
        }

        if (requiredTodoTitles.Count == 0)
        {
            return "Unlock via\n\nto-do";
        }

        if (requiredTodoTitles.Count == 1)
        {
            return $"Unlock via\n\n{Truncate(requiredTodoTitles[0], 42)}";
        }

        return $"Unlock via\n\n{requiredTodoTitles.Count} to-dos";
    }

    private static string Truncate(string value, int maxLength)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= maxLength)
        {
            return value;
        }

        return $"{value[..(maxLength - 1)]}…";
    }

    private static string ResolveApiBaseUrl()
    {
        var wsUrl = Environment.GetEnvironmentVariable("SLAYTHELIST_WS_URL") ?? "ws://localhost:8788/ws";
        if (!Uri.TryCreate(wsUrl, UriKind.Absolute, out var uri))
        {
            return "http://localhost:8788";
        }

        var builder = new UriBuilder(uri)
        {
            Scheme = uri.Scheme.Equals("wss", StringComparison.OrdinalIgnoreCase) ? "https" : "http",
            Path = string.Empty,
            Query = string.Empty,
        };
        return builder.Uri.ToString().TrimEnd('/');
    }

    private static double CalculateLockFontSize(double width, double height)
    {
        var minDim = Math.Max(1, Math.Min(width, height));
        var aspectRatio = width / Math.Max(1, height);
        var narrowScale = Math.Clamp(aspectRatio * 1.2, 0.68, 1.0);
        return Math.Clamp(minDim * 0.043 * narrowScale, 7, 13);
    }

    private Brush CreateBlockedBackgroundBrush(string zoneId)
    {
        var imagePath = GetImagePathForZone(zoneId);
        if (imagePath is null)
        {
            return new SolidColorBrush(Color.FromArgb(95, 22, 101, 52));
        }

        try
        {
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.UriSource = new Uri(imagePath, UriKind.Absolute);
            bitmap.EndInit();
            bitmap.Freeze();

            return new ImageBrush(bitmap)
            {
                Stretch = Stretch.UniformToFill,
                AlignmentX = AlignmentX.Center,
                AlignmentY = AlignmentY.Center,
                Opacity = 0.95,
            };
        }
        catch
        {
            return new SolidColorBrush(Color.FromArgb(95, 22, 101, 52));
        }
    }

    private string? GetImagePathForZone(string zoneId)
    {
        if (_overlayImagePaths.Count == 0)
        {
            return null;
        }

        var hash = 0;
        foreach (var c in zoneId)
        {
            hash = (hash * 31 + c) & int.MaxValue;
        }

        return _overlayImagePaths[hash % _overlayImagePaths.Count];
    }

    private void LoadOverlayImagePaths()
    {
        _overlayImagePaths.Clear();
        var directory = ResolveOverlayImageDirectory();
        if (directory is null)
        {
            return;
        }

        var supportedExtensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".bmp",
        };

        foreach (var path in Directory.EnumerateFiles(directory))
        {
            if (!supportedExtensions.Contains(System.IO.Path.GetExtension(path)))
            {
                continue;
            }

            _overlayImagePaths.Add(path);
        }
    }

    private static string? ResolveOverlayImageDirectory()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = System.IO.Path.Combine(current.FullName, "assets", "blocked-overlays");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        return null;
    }

    private static string ResolveGoldUnlockSoundPath()
    {
        return System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "gold-sack.wav");
    }

    private static bool ReadVisualOnlySetting()
    {
        var setting = Environment.GetEnvironmentVariable("SLAYTHELIST_VISUAL_ONLY");
        if (string.IsNullOrWhiteSpace(setting))
        {
            return false;
        }

        return setting.Equals("1", StringComparison.OrdinalIgnoreCase) ||
               setting.Equals("true", StringComparison.OrdinalIgnoreCase) ||
               setting.Equals("yes", StringComparison.OrdinalIgnoreCase);
    }

    private void AttachNoActivateWindowHook()
    {
        _overlayWindowHandle = new WindowInteropHelper(this).Handle;
        NativeMethods.EnableNoActivate(_overlayWindowHandle);
        if (PresentationSource.FromVisual(this) is HwndSource source)
        {
            source.AddHook(WndProc);
        }
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == WmMouseActivate)
        {
            handled = true;
            return (IntPtr)MaNoActivate;
        }

        return IntPtr.Zero;
    }
}
