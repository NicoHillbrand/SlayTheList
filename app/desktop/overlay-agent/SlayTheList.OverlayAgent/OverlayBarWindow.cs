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
/// The always-on-top overlay taskbar, rendered by the web app's /overlay route
/// inside WebView2: gold always visible, with Base and Friends dropdown
/// panels. The page reports its content height via postMessage and the window
/// hugs it. Draggable via the top bar; position and width persist across
/// runs. Collapsible into a small floating arrow (the « chip) that expands
/// back on click; the collapsed state persists too.
/// </summary>
public sealed class OverlayBarWindow : Window
{
    private static readonly string BoundsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SlayTheList", "overlay-bar-window.json");

    private static readonly string WebViewDataFolder = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "SlayTheList", "webview2");

    private const double CollapsedSize = 30;
    private const double ExpandedMinWidth = 320;
    // The bar row alone is ~40px of content; height is otherwise content-driven.
    private const double ExpandedMinHeight = 56;
    private const double MaxContentHeight = 780;
    private const double DragBarHeight = 22;

    private readonly string _overlayUrl;
    private readonly WebView2 _webView = new();
    private readonly TextBlock _fallbackText;
    private readonly Border _expandedRoot;
    private readonly Border _collapsedRoot;
    private readonly DispatcherTimer _saveBoundsTimer;
    private readonly DispatcherTimer _retryTimer;
    private bool _webViewReady;
    private bool _pageLoaded;
    private bool _collapsed;
    private double _expandedWidth;
    private double _expandedHeight;

    private sealed record WindowBounds(double Left, double Top, double Width, double Height, bool Collapsed = false);

    public OverlayBarWindow(string webBaseUrl)
    {
        _overlayUrl = $"{webBaseUrl.TrimEnd('/')}/overlay";

        WindowStyle = WindowStyle.None;
        // AllowsTransparency must stay false: WebView2 cannot render inside a
        // layered (transparent) window.
        ResizeMode = ResizeMode.CanResizeWithGrip;
        Topmost = true;
        ShowActivated = false;
        Focusable = false;
        ShowInTaskbar = false;
        Background = new SolidColorBrush(Color.FromRgb(26, 26, 46));
        // Height is content-driven (the page reports it); width is the user's.
        Width = 440;
        Height = 88;
        MinWidth = ExpandedMinWidth;
        MinHeight = ExpandedMinHeight;

        var screenWidth = SystemParameters.PrimaryScreenWidth;
        Left = screenWidth - Width - 16;
        Top = 80;
        var startCollapsed = RestoreBounds_();

        var collapseChip = new Border
        {
            Cursor = Cursors.Hand,
            ToolTip = "Collapse",
            Padding = new Thickness(8, 0, 8, 0),
            Background = Brushes.Transparent,
            Child = new TextBlock
            {
                Text = "»",
                Foreground = new SolidColorBrush(Color.FromArgb(200, 212, 170, 71)),
                FontSize = 13,
                VerticalAlignment = VerticalAlignment.Center,
                IsHitTestVisible = false,
            },
        };
        collapseChip.MouseLeftButtonDown += (_, args) =>
        {
            args.Handled = true;
            SetCollapsed(true);
        };
        DockPanel.SetDock(collapseChip, Dock.Right);

        var dragBarContent = new DockPanel();
        dragBarContent.Children.Add(collapseChip);
        dragBarContent.Children.Add(new TextBlock
        {
            Text = "☰  SlayTheList",
            Foreground = new SolidColorBrush(Color.FromArgb(200, 229, 231, 235)),
            FontSize = 11,
            Margin = new Thickness(8, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            IsHitTestVisible = false,
        });

        var dragBar = new Border
        {
            Height = 22,
            Background = new SolidColorBrush(Color.FromArgb(255, 22, 22, 42)),
            Cursor = Cursors.SizeAll,
            Child = dragBarContent,
        };
        dragBar.MouseLeftButtonDown += (_, args) =>
        {
            if (args.ButtonState == MouseButtonState.Pressed)
            {
                DragMove();
            }
        };
        DockPanel.SetDock(dragBar, Dock.Top);

        _fallbackText = new TextBlock
        {
            Text = "Loading base…",
            Foreground = new SolidColorBrush(Color.FromArgb(180, 148, 163, 184)),
            FontSize = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var contentGrid = new Grid();
        contentGrid.Children.Add(_fallbackText);
        contentGrid.Children.Add(_webView);

        var dock = new DockPanel();
        dock.Children.Add(dragBar);
        dock.Children.Add(contentGrid);

        _expandedRoot = new Border
        {
            BorderBrush = new SolidColorBrush(Color.FromArgb(120, 212, 170, 71)),
            BorderThickness = new Thickness(1),
            Child = dock,
        };

        // The collapsed form: a small floating « chip. Click expands; drag moves.
        _collapsedRoot = new Border
        {
            Visibility = Visibility.Collapsed,
            Background = new SolidColorBrush(Color.FromRgb(22, 22, 42)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(120, 212, 170, 71)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Cursor = Cursors.Hand,
            ToolTip = "Show base",
            Child = new TextBlock
            {
                Text = "«",
                Foreground = new SolidColorBrush(Color.FromArgb(230, 212, 170, 71)),
                FontSize = 15,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, -2, 0, 0),
                IsHitTestVisible = false,
            },
        };
        _collapsedRoot.MouseLeftButtonDown += (_, args) =>
        {
            args.Handled = true;
            var beforeLeft = Left;
            var beforeTop = Top;
            DragMove();
            // A press that barely moved is a click — expand. A real drag just
            // repositions the chip.
            if (Math.Abs(Left - beforeLeft) + Math.Abs(Top - beforeTop) < 4)
            {
                SetCollapsed(false);
            }
        };

        var root = new Grid();
        root.Children.Add(_expandedRoot);
        root.Children.Add(_collapsedRoot);
        Content = root;

        _saveBoundsTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
        _saveBoundsTimer.Tick += (_, _) => { _saveBoundsTimer.Stop(); SaveBounds(); };
        LocationChanged += (_, _) => { _saveBoundsTimer.Stop(); _saveBoundsTimer.Start(); };
        SizeChanged += (_, _) => { _saveBoundsTimer.Stop(); _saveBoundsTimer.Start(); };

        if (startCollapsed)
        {
            SetCollapsed(true);
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
            {
                _webView.CoreWebView2?.Navigate(_overlayUrl);
            }
        };

        SourceInitialized += (_, _) =>
        {
            var handle = new WindowInteropHelper(this).Handle;
            NativeMethods.EnableNoActivate(handle);
            NativeMethods.ExcludeFromCapture(handle);
        };

        Loaded += (_, _) => _ = InitializeWebViewAsync();
        Closed += (_, _) =>
        {
            _saveBoundsTimer.Stop();
            _retryTimer.Stop();
            _webView.Dispose();
        };
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

            // The page reports its content height ({type:"resize", height:N})
            // whenever a dropdown opens/closes, so the window hugs the content.
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
                        ApplyContentHeight(contentHeight);
                    }
                }
                catch
                {
                    // Malformed message — ignore.
                }
            };

            core.Navigate(_overlayUrl);
        }
        catch
        {
            // WebView2 runtime missing or failed to initialize.
            _fallbackText.Text = "Base view unavailable (WebView2 runtime missing)";
        }
    }

    private void ApplyContentHeight(double contentHeight)
    {
        var total = Math.Clamp(contentHeight + DragBarHeight + 2, ExpandedMinHeight, MaxContentHeight);
        if (_collapsed)
        {
            _expandedHeight = total;
        }
        else
        {
            Height = total;
        }
    }

    /// <summary>Toggle between the full preview and the small « chip. The
    /// chip keeps the window's right edge in place, so the preview collapses
    /// toward (and expands from) the same corner.</summary>
    private void SetCollapsed(bool collapsed)
    {
        if (_collapsed == collapsed)
        {
            return;
        }
        _collapsed = collapsed;

        if (collapsed)
        {
            _expandedWidth = Width;
            _expandedHeight = Height;
            _expandedRoot.Visibility = Visibility.Collapsed;
            _collapsedRoot.Visibility = Visibility.Visible;
            ResizeMode = ResizeMode.NoResize;
            MinWidth = CollapsedSize;
            MinHeight = CollapsedSize;
            Width = CollapsedSize;
            Height = CollapsedSize;
            Left += _expandedWidth - CollapsedSize;
        }
        else
        {
            _expandedRoot.Visibility = Visibility.Visible;
            _collapsedRoot.Visibility = Visibility.Collapsed;
            MinWidth = ExpandedMinWidth;
            MinHeight = ExpandedMinHeight;
            Width = _expandedWidth;
            Height = _expandedHeight;
            ResizeMode = ResizeMode.CanResizeWithGrip;
            var virtualLeft = SystemParameters.VirtualScreenLeft;
            Left = Math.Max(virtualLeft, Left - (_expandedWidth - CollapsedSize));
        }

        _saveBoundsTimer.Stop();
        _saveBoundsTimer.Start();
    }

    /// <summary>Restores saved bounds (always stored in expanded-window
    /// coordinates). Returns whether the window should start collapsed.</summary>
    private bool RestoreBounds_()
    {
        try
        {
            if (!File.Exists(BoundsPath))
            {
                return false;
            }

            var bounds = JsonSerializer.Deserialize<WindowBounds>(File.ReadAllText(BoundsPath));
            if (bounds is null || bounds.Width < MinWidth || bounds.Height < MinHeight)
            {
                return false;
            }

            // Keep the window reachable if screens changed since last run.
            var virtualLeft = SystemParameters.VirtualScreenLeft;
            var virtualTop = SystemParameters.VirtualScreenTop;
            var virtualRight = virtualLeft + SystemParameters.VirtualScreenWidth;
            var virtualBottom = virtualTop + SystemParameters.VirtualScreenHeight;
            Left = Math.Clamp(bounds.Left, virtualLeft, Math.Max(virtualLeft, virtualRight - bounds.Width));
            Top = Math.Clamp(bounds.Top, virtualTop, Math.Max(virtualTop, virtualBottom - bounds.Height));
            Width = bounds.Width;
            Height = bounds.Height;
            return bounds.Collapsed;
        }
        catch
        {
            // Corrupt bounds file — fall back to defaults.
            return false;
        }
    }

    private void SaveBounds()
    {
        try
        {
            var dir = Path.GetDirectoryName(BoundsPath);
            if (dir is not null)
            {
                Directory.CreateDirectory(dir);
            }
            // Always persist expanded-window coordinates so restore + collapse
            // reproduces the same chip position.
            var left = _collapsed ? Left - (_expandedWidth - CollapsedSize) : Left;
            var width = _collapsed ? _expandedWidth : Width;
            var height = _collapsed ? _expandedHeight : Height;
            File.WriteAllText(BoundsPath, JsonSerializer.Serialize(new WindowBounds(left, Top, width, height, _collapsed)));
        }
        catch
        {
            // Non-critical.
        }
    }
}
