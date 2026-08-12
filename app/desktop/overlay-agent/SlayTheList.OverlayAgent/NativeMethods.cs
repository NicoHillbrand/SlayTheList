using System.Runtime.InteropServices;
using System.Text;

namespace SlayTheList.OverlayAgent;

internal static class NativeMethods
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    private const int GwlExStyle = -20;
    private const int WsExNoActivate = 0x08000000;
    private const int WsExTransparent = 0x00000020;

    /// <summary>DWMWA_WINDOW_CORNER_PREFERENCE.</summary>
    private const int DwmwaWindowCornerPreference = 33;
    /// <summary>DWMWCP_ROUND — the standard Windows 11 corner radius.</summary>
    private const int DwmwcpRound = 2;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd, int attribute, ref int value, int valueSize);

    /// <summary>
    /// Ask the compositor to round this window's corners.
    ///
    /// Needed because these panels are WindowStyle.None: Windows 11 rounds
    /// ordinary windows on its own, but a chromeless one keeps hard corners
    /// unless it opts back in. Doing it through DWM rather than a CSS radius is
    /// what makes it a real rounded WINDOW — the corners are clipped by the
    /// compositor, so nothing of the page shows outside the curve. A CSS radius
    /// cannot achieve that here, since AllowsTransparency must stay false for
    /// WebView2 and the square window would still paint behind the curve.
    ///
    /// No-ops before Windows 11 (the attribute is simply unsupported), which is
    /// why the HRESULT is ignored.
    /// </summary>
    public static void EnableRoundedCorners(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero)
            return;
        var preference = DwmwcpRound;
        try
        {
            DwmSetWindowAttribute(hwnd, DwmwaWindowCornerPreference, ref preference, sizeof(int));
        }
        catch (DllNotFoundException)
        {
            // No dwmapi (very old Windows): square corners, nothing else breaks.
        }
        catch (EntryPointNotFoundException)
        {
            // Ditto.
        }
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
    private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
    private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hObject);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("gdi32.dll")]
    public static extern bool BitBlt(IntPtr hdc, int nXDest, int nYDest, int nWidth, int nHeight,
        IntPtr hdcSrc, int nXSrc, int nYSrc, uint dwRop);

    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;
    private const uint SrcCopy = 0x00CC0020;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static IntPtr FindWindowByTitleContains(string titleHint)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd))
            {
                return true;
            }

            var builder = new StringBuilder(512);
            _ = GetWindowText(hWnd, builder, builder.Capacity);
            var text = builder.ToString();
            if (text.Contains(titleHint, StringComparison.OrdinalIgnoreCase))
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static string GetWindowTitle(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero)
        {
            return string.Empty;
        }

        var builder = new StringBuilder(512);
        _ = GetWindowText(hWnd, builder, builder.Capacity);
        return builder.ToString();
    }

    public static byte[]? CaptureWindow(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return null;
        if (!GetWindowRect(hWnd, out var rect)) return null;

        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return null;

        var hdcWindow = GetDC(hWnd);
        var hdcMem = CreateCompatibleDC(hdcWindow);
        var hBitmap = CreateCompatibleBitmap(hdcWindow, width, height);
        var hOld = SelectObject(hdcMem, hBitmap);

        // PW_RENDERFULLCONTENT = 2 for better DWM capture
        PrintWindow(hWnd, hdcMem, 2);

        SelectObject(hdcMem, hOld);
        DeleteDC(hdcMem);
        ReleaseDC(hWnd, hdcWindow);

        try
        {
            using var bitmap = System.Drawing.Image.FromHbitmap(hBitmap);
            DeleteObject(hBitmap);
            using var ms = new System.IO.MemoryStream();
            bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Jpeg);
            return ms.ToArray();
        }
        catch
        {
            DeleteObject(hBitmap);
            return null;
        }
    }

    public static byte[]? CaptureScreen()
    {
        var width = GetSystemMetrics(SmCxScreen);
        var height = GetSystemMetrics(SmCyScreen);
        if (width <= 0 || height <= 0) return null;

        var hdcScreen = GetDC(IntPtr.Zero);
        var hdcMem = CreateCompatibleDC(hdcScreen);
        var hBitmap = CreateCompatibleBitmap(hdcScreen, width, height);
        var hOld = SelectObject(hdcMem, hBitmap);

        BitBlt(hdcMem, 0, 0, width, height, hdcScreen, 0, 0, SrcCopy);

        SelectObject(hdcMem, hOld);
        DeleteDC(hdcMem);
        ReleaseDC(IntPtr.Zero, hdcScreen);

        try
        {
            using var bitmap = System.Drawing.Image.FromHbitmap(hBitmap);
            DeleteObject(hBitmap);
            using var ms = new System.IO.MemoryStream();
            bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Jpeg);
            return ms.ToArray();
        }
        catch
        {
            DeleteObject(hBitmap);
            return null;
        }
    }

    public static System.Drawing.Bitmap? CaptureScreenBitmap()
    {
        var width = GetSystemMetrics(SmCxScreen);
        var height = GetSystemMetrics(SmCyScreen);
        if (width <= 0 || height <= 0) return null;

        var hdcScreen = GetDC(IntPtr.Zero);
        var hdcMem = CreateCompatibleDC(hdcScreen);
        var hBitmap = CreateCompatibleBitmap(hdcScreen, width, height);
        var hOld = SelectObject(hdcMem, hBitmap);

        BitBlt(hdcMem, 0, 0, width, height, hdcScreen, 0, 0, SrcCopy);

        SelectObject(hdcMem, hOld);
        DeleteDC(hdcMem);
        ReleaseDC(IntPtr.Zero, hdcScreen);

        try
        {
            var bitmap = System.Drawing.Image.FromHbitmap(hBitmap);
            DeleteObject(hBitmap);
            return (System.Drawing.Bitmap)bitmap;
        }
        catch
        {
            DeleteObject(hBitmap);
            return null;
        }
    }

    public static System.Drawing.Bitmap? CaptureWindowBitmap(IntPtr hWnd)
    {
        if (!GetWindowRect(hWnd, out var rect)) return null;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return null;

        var hdcScreen = GetDC(IntPtr.Zero);
        var hdcMem = CreateCompatibleDC(hdcScreen);
        var hBitmap = CreateCompatibleBitmap(hdcScreen, width, height);
        var hOld = SelectObject(hdcMem, hBitmap);

        BitBlt(hdcMem, 0, 0, width, height, hdcScreen, rect.Left, rect.Top, SrcCopy);

        SelectObject(hdcMem, hOld);
        DeleteDC(hdcMem);
        ReleaseDC(IntPtr.Zero, hdcScreen);

        try
        {
            var bitmap = System.Drawing.Image.FromHbitmap(hBitmap);
            DeleteObject(hBitmap);
            return (System.Drawing.Bitmap)bitmap;
        }
        catch
        {
            DeleteObject(hBitmap);
            return null;
        }
    }

    [DllImport("user32.dll")]
    private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    private const uint WdaNone = 0x00000000;
    private const uint WdaExcludeFromCapture = 0x00000011;

    public static void ExcludeFromCapture(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;
        SetWindowDisplayAffinity(hWnd, WdaExcludeFromCapture);
    }

    public static void EnableNoActivate(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;
        SetExStyleFlag(hWnd, WsExNoActivate);
    }

    public static void EnableClickThrough(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;
        SetExStyleFlag(hWnd, WsExTransparent);
    }

    private static void SetExStyleFlag(IntPtr hWnd, int flag)
    {
        if (IntPtr.Size == 8)
        {
            var current = GetWindowLongPtr64(hWnd, GwlExStyle).ToInt64();
            _ = SetWindowLongPtr64(hWnd, GwlExStyle, new IntPtr(current | flag));
            return;
        }

        var current32 = GetWindowLong32(hWnd, GwlExStyle);
        _ = SetWindowLong32(hWnd, GwlExStyle, current32 | flag);
    }

    // ---- Window dragging by a custom grip ---------------------------------
    // WPF's Window.DragMove() assumes the window can activate. The overlay
    // windows are WS_EX_NOACTIVATE so they never steal focus from whatever the
    // user is working in, so they drag the native way instead: tell Windows the
    // click landed on the title bar and let it run its own move loop.
    private const int WmNcLButtonDown = 0x00A1;
    private const int HtCaption = 0x0002;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    /// <summary>Starts a native move-drag for a window that cannot activate.
    /// Blocks until the user releases the mouse, so callers can persist the new
    /// position on the next line.</summary>
    public static void BeginWindowDrag(IntPtr hWnd)
    {
        if (hWnd == IntPtr.Zero) return;
        ReleaseCapture();
        SendMessage(hWnd, WmNcLButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
    }

    // ---- Global hotkey (RegisterHotKey / WM_HOTKEY) -----------------------
    public const int WmHotkey = 0x0312;
    public const uint ModAlt = 0x0001;
    public const uint ModControl = 0x0002;
    public const uint ModShift = 0x0004;
    public const uint ModWin = 0x0008;
    // Don't repeat-fire while the key is held down.
    public const uint ModNoRepeat = 0x4000;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    /// <summary>Parses a combo like "Ctrl+Shift+B" into (modifiers, virtual-key).
    /// Requires at least one modifier and a supported main key (A-Z, 0-9, F1-F12,
    /// Space). Returns null for anything unparseable.</summary>
    public static (uint Modifiers, uint Vk)? ParseHotkey(string? combo)
    {
        if (string.IsNullOrWhiteSpace(combo)) return null;

        uint modifiers = 0;
        uint vk = 0;
        foreach (var raw in combo.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var token = raw.ToUpperInvariant();
            switch (token)
            {
                case "CTRL":
                case "CONTROL":
                    modifiers |= ModControl;
                    break;
                case "ALT":
                    modifiers |= ModAlt;
                    break;
                case "SHIFT":
                    modifiers |= ModShift;
                    break;
                case "WIN":
                case "META":
                case "SUPER":
                    modifiers |= ModWin;
                    break;
                case "SPACE":
                    vk = 0x20;
                    break;
                default:
                    if (token.Length == 1 && token[0] >= 'A' && token[0] <= 'Z')
                    {
                        vk = token[0];
                    }
                    else if (token.Length == 1 && token[0] >= '0' && token[0] <= '9')
                    {
                        vk = token[0]; // '0'..'9' == VK_0..VK_9
                    }
                    else if (token.Length >= 2 && token[0] == 'F' && int.TryParse(token[1..], out var fn) && fn is >= 1 and <= 12)
                    {
                        vk = (uint)(0x70 + fn - 1); // VK_F1..VK_F12
                    }
                    break;
            }
        }

        if (modifiers == 0 || vk == 0) return null;
        return (modifiers, vk);
    }
}
