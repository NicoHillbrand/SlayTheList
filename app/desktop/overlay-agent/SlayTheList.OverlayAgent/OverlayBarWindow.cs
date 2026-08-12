using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Shell;
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

/// <summary>A WebView2 content window that hosts a single overlay panel. Opaque
/// (WebView2 can't render in a transparent window) with a matching thin gold
/// border. Reports its content height via postMessage so the window hugs the
/// content.
///
/// Two modes. With no <c>gripTitle</c> it is a dropdown owned by the bar
/// (?panel=base, ?panel=friends), positioned by the bar. With a
/// <c>gripTitle</c> it is a standalone window with its own drag grip and its
/// own remembered position — that is the Crawl window, which has no connection
/// to the bar at all.</summary>
internal sealed class OverlayPanelWindow : Window
{
    /// <summary>The width the page is designed for. A standalone panel keeps
    /// rendering at exactly this many CSS pixels and is scaled to whatever width
    /// the user drags it to, so shrinking the window shrinks the whole panel
    /// instead of introducing a scrollbar.</summary>
    private const double PanelWidth = 340;
    private const double MinPanelWidth = 190;
    private const double MaxPanelWidth = 510;
    private const double MinContentHeight = 48;
    private const double MaxContentHeight = 780;
    private const double GripHeight = 22;
    /// <summary>Grab width for the resize edges and corners.</summary>
    private const double ResizeBorder = 7;

    private static readonly string WebViewDataFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SlayTheList", "webview2");

    private readonly string _webBaseUrl;
    private readonly WebView2 _webView = new();
    private readonly TextBlock _fallbackText;
    private readonly DispatcherTimer _retryTimer;
    private readonly string? _boundsPath;
    private readonly double _chromeHeight;
    private readonly bool _resizable;
    private readonly DispatcherTimer? _saveBoundsTimer;
    private bool _webViewReady;
    private bool _pageLoaded;
    private string _pendingPanel = "base";
    private string _panelUrl = "";
    /// <summary>Last height the page reported, in CSS pixels (so zoom-independent).
    /// Kept so the window can be re-fitted when the zoom changes.</summary>
    private double _contentHeightCss;

    private sealed record PanelBounds(double Left, double Top, double Width);

    public OverlayPanelWindow(string webBaseUrl, string? gripTitle = null, string? boundsFileName = null)
    {
        _webBaseUrl = webBaseUrl;
        _chromeHeight = gripTitle is null ? 0 : GripHeight;
        _resizable = gripTitle is not null;
        _boundsPath = boundsFileName is null
            ? null
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SlayTheList", boundsFileName);

        WindowStyle = WindowStyle.None;
        // Only the standalone panel resizes; the bar's dropdowns are sized and
        // placed by the bar.
        ResizeMode = _resizable ? ResizeMode.CanResize : ResizeMode.NoResize;
        Topmost = true;
        ShowActivated = false;
        Focusable = false;
        ShowInTaskbar = false;
        // AllowsTransparency must stay false: WebView2 cannot render in a layered window.
        Background = new SolidColorBrush(Color.FromRgb(22, 22, 42));
        Width = PanelWidth;
        Height = 120;
        if (_resizable)
        {
            MinWidth = MinPanelWidth;
            MaxWidth = MaxPanelWidth;
            // WindowStyle.None + ResizeMode.CanResize leaves the system drawing a
            // pale non-client frame around the window (a white bar along the top,
            // a dead band at the bottom). WindowChrome keeps the window resizable
            // — edges and corners — while giving the client area the whole window,
            // so there is nothing left for the system to paint.
            WindowChrome.SetWindowChrome(this, new WindowChrome
            {
                CaptionHeight = 0,
                ResizeBorderThickness = new Thickness(ResizeBorder),
                CornerRadius = new CornerRadius(0),
                GlassFrameThickness = new Thickness(0),
                UseAeroCaptionButtons = false,
            });
        }

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

        UIElement body = grid;
        if (gripTitle is not null)
        {
            // WebView2 swallows every mouse event in the client area, so a
            // standalone window needs its own strip to grab hold of.
            var panel = new DockPanel { LastChildFill = true };
            var grip = BuildGrip(gripTitle);
            DockPanel.SetDock(grip, Dock.Top);
            panel.Children.Add(grip);
            panel.Children.Add(grid);
            body = panel;
        }

        Content = new Border
        {
            BorderBrush = new SolidColorBrush(Color.FromArgb(120, 212, 170, 71)),
            BorderThickness = new Thickness(1),
            Child = body,
        };

        if (_boundsPath is not null)
        {
            Left = SystemParameters.PrimaryScreenWidth - PanelWidth - 40;
            Top = 130;
            RestoreSavedBounds();
            _saveBoundsTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
            _saveBoundsTimer.Tick += (_, _) => { _saveBoundsTimer!.Stop(); SaveBounds(); };
        }

        if (_resizable)
        {
            SizeChanged += (_, args) =>
            {
                if (Math.Abs(args.NewSize.Width - args.PreviousSize.Width) < 0.5)
                    return;
                ApplyZoom();
                _saveBoundsTimer?.Stop();
                _saveBoundsTimer?.Start();
            };
        }

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
            // WindowStyle.None opts out of the Windows 11 rounding, so ask for it
            // back explicitly — a hard-cornered floating panel reads as unfinished
            // next to every other window on the desktop.
            NativeMethods.EnableRoundedCorners(handle);
            // Not excluded from capture — screenshottable, like the gold indicator.
        };

        Loaded += (_, _) => _ = InitializeWebViewAsync();
        Closed += (_, _) =>
        {
            _retryTimer.Stop();
            _saveBoundsTimer?.Stop();
            _webView.Dispose();
        };
    }

    /// <summary>The drag strip for a standalone panel: title on the left, a hide
    /// button on the right, grab anywhere else to move the window.</summary>
    private Border BuildGrip(string title)
    {
        var label = new TextBlock
        {
            Text = title,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(0xf5, 0xc5, 0x42)),
            VerticalAlignment = VerticalAlignment.Center,
            IsHitTestVisible = false,
        };

        var hide = new TextBlock
        {
            Text = "✕",
            FontSize = 11,
            Foreground = new SolidColorBrush(Color.FromRgb(0x8a, 0x89, 0xa6)),
            VerticalAlignment = VerticalAlignment.Center,
            Cursor = Cursors.Hand,
            Padding = new Thickness(6, 0, 2, 0),
            ToolTip = "Hide (the run is saved — nothing is lost)",
        };
        hide.MouseLeftButtonDown += (_, args) => { args.Handled = true; Hide(); };

        var row = new DockPanel { LastChildFill = true };
        DockPanel.SetDock(hide, Dock.Right);
        row.Children.Add(hide);
        row.Children.Add(label);

        var grip = new Border
        {
            Height = GripHeight,
            Padding = new Thickness(7, 0, 5, 0),
            Background = new SolidColorBrush(Color.FromRgb(0x1e, 0x1e, 0x38)),
            Cursor = Cursors.SizeAll,
            ToolTip = "Drag to move",
            Child = row,
        };
        grip.MouseLeftButtonDown += (_, args) =>
        {
            if (args.ButtonState != MouseButtonState.Pressed)
                return;
            // Native move loop; blocks until the mouse is released.
            NativeMethods.BeginWindowDrag(new WindowInteropHelper(this).Handle);
            SaveBounds();
        };
        return grip;
    }

    /// <summary>Scales the page so it always lays out at PanelWidth CSS pixels
    /// however wide the window is. Dragging the window narrower then shrinks the
    /// whole panel rather than cramping or scrolling it.</summary>
    private void ApplyZoom()
    {
        if (!_resizable || !_webViewReady)
            return;
        // Measure the WebView, not the window: the resize frame adds a few
        // pixels, and using the outer width would leave the panel permanently
        // scaled slightly above 1.0 at its default size.
        var width = _webView.ActualWidth;
        if (width <= 0)
            return;
        _webView.ZoomFactor = width / PanelWidth;
        FitHeightToContent();
    }

    /// <summary>Re-applies the last reported content height at the current zoom.
    /// The page reports CSS pixels and knows nothing about the scale or the
    /// grip, so both are added here.</summary>
    private void FitHeightToContent()
    {
        if (_contentHeightCss <= 0)
            return;
        var zoom = _webViewReady ? _webView.ZoomFactor : 1;
        var content = Math.Clamp(_contentHeightCss + 2, MinContentHeight, MaxContentHeight) * zoom;
        // Whatever the window wraps around the WebView (grip + resize frame),
        // measured rather than assumed so the window always hugs the content.
        var chrome = ActualHeight > 0 && _webView.ActualHeight > 0
            ? ActualHeight - _webView.ActualHeight
            : _chromeHeight;
        Height = content + chrome;
    }

    private void RestoreSavedBounds()
    {
        try
        {
            if (_boundsPath is null || !File.Exists(_boundsPath))
                return;
            var bounds = JsonSerializer.Deserialize<PanelBounds>(File.ReadAllText(_boundsPath));
            if (bounds is null)
                return;
            if (_resizable && bounds.Width > 0)
                Width = Math.Clamp(bounds.Width, MinPanelWidth, MaxPanelWidth);
            var vLeft = SystemParameters.VirtualScreenLeft;
            var vTop = SystemParameters.VirtualScreenTop;
            var vRight = vLeft + SystemParameters.VirtualScreenWidth;
            var vBottom = vTop + SystemParameters.VirtualScreenHeight;
            // Keep a grabbable sliver on screen even if the display setup changed.
            Left = Math.Clamp(bounds.Left, vLeft, Math.Max(vLeft, vRight - 80));
            Top = Math.Clamp(bounds.Top, vTop, Math.Max(vTop, vBottom - 40));
        }
        catch
        {
            // Corrupt bounds file — fall back to the default position.
        }
    }

    private void SaveBounds()
    {
        try
        {
            if (_boundsPath is null)
                return;
            var dir = Path.GetDirectoryName(_boundsPath);
            if (dir is not null)
                Directory.CreateDirectory(dir);
            var width = ActualWidth > 0 ? ActualWidth : Width;
            File.WriteAllText(_boundsPath, JsonSerializer.Serialize(new PanelBounds(Left, Top, width)));
        }
        catch
        {
            // Best-effort persistence; ignore write failures.
        }
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
            // A restored width needs its scale applied now that there is a
            // WebView to apply it to.
            ApplyZoom();

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
                        _contentHeightCss = contentHeight;
                        FitHeightToContent();
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
