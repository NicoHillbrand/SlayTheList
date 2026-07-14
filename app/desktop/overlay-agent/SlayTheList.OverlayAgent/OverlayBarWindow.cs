using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace SlayTheList.OverlayAgent;

/// <summary>
/// The always-on-top overlay bar: a compact native pill styled identically to
/// the gold indicator (transparent window, dark fill, thin gold border), holding
/// just the Base and Friends dropdown buttons. Clicking a button opens its
/// content in a separate WebView2 panel window docked below the bar. The pill is
/// draggable (grab anywhere but the buttons) and its position persists across runs.
/// </summary>
public sealed class OverlayBarWindow : Window
{
    private static readonly string BoundsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SlayTheList", "overlay-bar-window.json");

    private readonly string _webBaseUrl;
    private readonly Border _baseButton;
    private readonly Border _friendsButton;
    private readonly DispatcherTimer _saveBoundsTimer;
    private OverlayPanelWindow? _panelWindow;
    private string? _openPanel; // "base" | "friends" | null

    private sealed record WindowBounds(double Left, double Top);

    public OverlayBarWindow(string webBaseUrl)
    {
        _webBaseUrl = webBaseUrl.TrimEnd('/');

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        Topmost = true;
        ShowActivated = false;
        Focusable = false;
        ShowInTaskbar = false;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        SizeToContent = SizeToContent.WidthAndHeight;

        _baseButton = BuildBarButton();
        _friendsButton = BuildBarButton();
        _baseButton.MouseLeftButtonDown += (_, args) => { args.Handled = true; TogglePanel("base"); };
        _friendsButton.MouseLeftButtonDown += (_, args) => { args.Handled = true; TogglePanel("friends"); };

        var row = new StackPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(_baseButton);
        row.Children.Add(_friendsButton);

        // Same dark fill + thin gold border + rounded corners as the gold chip.
        var pill = new Border
        {
            Padding = new Thickness(6, 5, 6, 5),
            CornerRadius = new CornerRadius(6),
            Background = new SolidColorBrush(Color.FromArgb(180, 17, 24, 38)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(120, 212, 170, 71)),
            BorderThickness = new Thickness(1),
            Cursor = Cursors.SizeAll,
            ToolTip = "Drag to move — click Base or Friends to open",
            Child = row,
        };
        pill.MouseLeftButtonDown += (_, args) =>
        {
            if (args.ButtonState != MouseButtonState.Pressed)
                return;
            DragMove(); // blocks until the drag completes
            SaveBounds();
            RepositionPanel();
        };
        Content = pill;

        UpdateButtonStates();

        // Default to the top-right; restore the saved position if there is one.
        Left = SystemParameters.PrimaryScreenWidth - 180;
        Top = 80;
        RestoreSavedBounds();

        _saveBoundsTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _saveBoundsTimer.Tick += (_, _) => { _saveBoundsTimer.Stop(); SaveBounds(); };
        LocationChanged += (_, _) =>
        {
            _saveBoundsTimer.Stop();
            _saveBoundsTimer.Start();
            RepositionPanel();
        };

        Closed += (_, _) =>
        {
            _saveBoundsTimer.Stop();
            _panelWindow?.Close();
            _panelWindow = null;
        };
    }

    /// <summary>A pill button mirroring the web overlay's Base/Friends buttons.
    /// Text and colours are set by <see cref="UpdateButtonStates"/>.</summary>
    private static Border BuildBarButton()
    {
        return new Border
        {
            Margin = new Thickness(3, 0, 3, 0),
            Padding = new Thickness(12, 3, 12, 3),
            CornerRadius = new CornerRadius(6),
            BorderThickness = new Thickness(1),
            Cursor = Cursors.Hand,
            Child = new TextBlock
            {
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                IsHitTestVisible = false,
            },
        };
    }

    private void UpdateButtonStates()
    {
        StyleButton(_baseButton, "Base", _openPanel == "base");
        StyleButton(_friendsButton, "Friends", _openPanel == "friends");
    }

    private static void StyleButton(Border button, string label, bool active)
    {
        var text = (TextBlock)button.Child;
        text.Text = active ? $"{label}  ▴" : $"{label}  ▾";
        text.Foreground = new SolidColorBrush(active
            ? Color.FromRgb(0xf5, 0xc5, 0x42)
            : Color.FromRgb(0xcc, 0xcc, 0xcc));
        button.Background = new SolidColorBrush(active
            ? Color.FromRgb(0x2a, 0x2a, 0x4a)
            : Color.FromRgb(0x1e, 0x1e, 0x3a));
        button.BorderBrush = new SolidColorBrush(active
            ? Color.FromRgb(0xd4, 0xaa, 0x47)
            : Color.FromRgb(0x3a, 0x3a, 0x5a));
    }

    private void TogglePanel(string which)
    {
        if (_openPanel == which)
        {
            _openPanel = null;
            _panelWindow?.Hide();
        }
        else
        {
            _openPanel = which;
            _panelWindow ??= new OverlayPanelWindow(_webBaseUrl);
            _panelWindow.NavigatePanel(which);
            RepositionPanel();
            _panelWindow.Show();
        }
        UpdateButtonStates();
    }

    private void RepositionPanel()
    {
        if (_panelWindow is null || _openPanel is null)
            return;
        // Dock just below the bar, right edges aligned, clamped on-screen.
        var virtualLeft = SystemParameters.VirtualScreenLeft;
        var right = Left + (ActualWidth > 0 ? ActualWidth : Width);
        _panelWindow.Left = Math.Max(virtualLeft, right - _panelWindow.Width);
        _panelWindow.Top = Top + (ActualHeight > 0 ? ActualHeight : Height) + 6;
    }

    private void RestoreSavedBounds()
    {
        try
        {
            if (!File.Exists(BoundsPath))
                return;
            var bounds = JsonSerializer.Deserialize<WindowBounds>(File.ReadAllText(BoundsPath));
            if (bounds is null)
                return;
            var vLeft = SystemParameters.VirtualScreenLeft;
            var vTop = SystemParameters.VirtualScreenTop;
            var vRight = vLeft + SystemParameters.VirtualScreenWidth;
            var vBottom = vTop + SystemParameters.VirtualScreenHeight;
            Left = Math.Clamp(bounds.Left, vLeft, Math.Max(vLeft, vRight - 60));
            Top = Math.Clamp(bounds.Top, vTop, Math.Max(vTop, vBottom - 20));
        }
        catch
        {
            // Corrupt bounds file — fall back to the default top-right position.
        }
    }

    private void SaveBounds()
    {
        try
        {
            var dir = Path.GetDirectoryName(BoundsPath);
            if (dir is not null)
                Directory.CreateDirectory(dir);
            File.WriteAllText(BoundsPath, JsonSerializer.Serialize(new WindowBounds(Left, Top)));
        }
        catch
        {
            // Best-effort persistence; ignore write failures.
        }
    }
}

/// <summary>A WebView2 content window that hosts a single overlay panel
/// (?panel=base or ?panel=friends), docked below the bar. Opaque (WebView2 can't
/// render in a transparent window) with a matching thin gold border. Reports its
/// content height via postMessage so the window hugs the content.</summary>
internal sealed class OverlayPanelWindow : Window
{
    private const double PanelWidth = 340;
    private const double MinContentHeight = 48;
    private const double MaxContentHeight = 780;

    private static readonly string WebViewDataFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SlayTheList", "webview2");

    private readonly string _webBaseUrl;
    private readonly WebView2 _webView = new();
    private readonly TextBlock _fallbackText;
    private readonly DispatcherTimer _retryTimer;
    private bool _webViewReady;
    private bool _pageLoaded;
    private string _pendingPanel = "base";
    private string _panelUrl = "";

    public OverlayPanelWindow(string webBaseUrl)
    {
        _webBaseUrl = webBaseUrl;

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        Topmost = true;
        ShowActivated = false;
        Focusable = false;
        ShowInTaskbar = false;
        // AllowsTransparency must stay false: WebView2 cannot render in a layered window.
        Background = new SolidColorBrush(Color.FromRgb(22, 22, 42));
        Width = PanelWidth;
        Height = 120;

        _fallbackText = new TextBlock
        {
            Text = "Loading…",
            Foreground = new SolidColorBrush(Color.FromArgb(180, 148, 163, 184)),
            FontSize = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var grid = new Grid();
        grid.Children.Add(_fallbackText);
        grid.Children.Add(_webView);

        Content = new Border
        {
            BorderBrush = new SolidColorBrush(Color.FromArgb(120, 212, 170, 71)),
            BorderThickness = new Thickness(1),
            Child = grid,
        };

        _retryTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        _retryTimer.Tick += (_, _) =>
        {
            if (_pageLoaded)
            {
                _retryTimer.Stop();
                return;
            }
            if (_webViewReady)
                _webView.CoreWebView2?.Navigate(_panelUrl);
        };

        SourceInitialized += (_, _) =>
        {
            var handle = new WindowInteropHelper(this).Handle;
            NativeMethods.EnableNoActivate(handle);
            // Not excluded from capture — screenshottable, like the gold indicator.
        };

        Loaded += (_, _) => _ = InitializeWebViewAsync();
        Closed += (_, _) =>
        {
            _retryTimer.Stop();
            _webView.Dispose();
        };
    }

    /// <summary>Point the panel at base or friends. Navigates immediately if the
    /// WebView is ready, otherwise defers until initialization completes.</summary>
    public void NavigatePanel(string which)
    {
        _pendingPanel = which;
        _panelUrl = $"{_webBaseUrl}/overlay?panel={which}";
        if (_webViewReady)
        {
            _pageLoaded = false;
            _webView.CoreWebView2?.Navigate(_panelUrl);
        }
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, WebViewDataFolder);
            await _webView.EnsureCoreWebView2Async(environment);
            _webViewReady = true;

            var core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;

            core.NavigationCompleted += (_, args) =>
            {
                _pageLoaded = args.IsSuccess;
                _fallbackText.Visibility = args.IsSuccess ? Visibility.Collapsed : Visibility.Visible;
                if (!args.IsSuccess)
                {
                    _fallbackText.Text = "Waiting for web app…";
                    _retryTimer.Start();
                }
            };

            // The page reports its content height ({type:"resize", height:N}) so
            // the window hugs the content as data loads or the panel changes.
            core.WebMessageReceived += (_, args) =>
            {
                try
                {
                    using var doc = JsonDocument.Parse(args.WebMessageAsJson);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object
                        && doc.RootElement.TryGetProperty("type", out var type)
                        && type.GetString() == "resize"
                        && doc.RootElement.TryGetProperty("height", out var height)
                        && height.TryGetDouble(out var contentHeight))
                    {
                        Height = Math.Clamp(contentHeight + 2, MinContentHeight, MaxContentHeight);
                    }
                }
                catch
                {
                    // Malformed message — ignore.
                }
            };

            _panelUrl = $"{_webBaseUrl}/overlay?panel={_pendingPanel}";
            core.Navigate(_panelUrl);
        }
        catch
        {
            // WebView2 runtime missing or failed to initialize.
            _fallbackText.Text = "Panel unavailable (WebView2 runtime missing)";
        }
    }
}
