using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Windows.Forms;

namespace SlayTheList.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new LauncherForm());
    }
}

internal sealed class LauncherForm : Form
{
    private readonly TextBox _logBox;
    private readonly Button _startButton;
    private readonly Button _openButton;
    private readonly Button _stopButton;

    private readonly List<Process> _childProcesses = [];
    private readonly HttpClient _httpClient = new();

    private bool _isRunning;
    private string? _repoRoot;

    public LauncherForm()
    {
        Text = "SlayTheList Launcher";
        Width = 760;
        Height = 500;
        StartPosition = FormStartPosition.CenterScreen;

        var topBar = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 44,
            Padding = new Padding(8),
        };

        _startButton = new Button { Text = "Start Stack", Width = 120 };
        _openButton = new Button { Text = "Open Web App", Width = 120, Enabled = false };
        _stopButton = new Button { Text = "Stop Stack", Width = 120, Enabled = false };
        var exitButton = new Button { Text = "Exit", Width = 100 };

        _startButton.Click += async (_, _) => await StartStackAsync();
        _openButton.Click += (_, _) => OpenBrowser("http://localhost:3000");
        _stopButton.Click += (_, _) => StopStack();
        exitButton.Click += (_, _) => Close();

        topBar.Controls.Add(_startButton);
        topBar.Controls.Add(_openButton);
        topBar.Controls.Add(_stopButton);
        topBar.Controls.Add(exitButton);

        _logBox = new TextBox
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            Multiline = true,
            ScrollBars = ScrollBars.Vertical,
            Font = new Font("Consolas", 10),
        };

        Controls.Add(_logBox);
        Controls.Add(topBar);

        FormClosing += (_, _) => StopStack();
        Shown += async (_, _) => await StartStackAsync();
    }

    private async Task StartStackAsync()
    {
        if (_isRunning)
        {
            Log("Stack already running.");
            return;
        }

        _repoRoot = FindRepoRoot();
        if (_repoRoot is null)
        {
            MessageBox.Show(
                "Could not locate project root (package.json). Place launcher inside this repository.",
                "SlayTheList Launcher",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return;
        }

        try
        {
            Log($"Repo root: {_repoRoot}");

            var apiDist = Path.Combine(_repoRoot, "backend", "api", "dist", "server.js");
            var nextCli = Path.Combine(_repoRoot, "node_modules", "next", "dist", "bin", "next");
            if (!File.Exists(apiDist) || !File.Exists(nextCli))
            {
                throw new InvalidOperationException(
                    "Build artifacts missing. Run `npm install` and `npm run build` once before launching."
                );
            }

            StartChild("node", Quote(apiDist), _repoRoot, new Dictionary<string, string> { { "PORT", "8788" } });
            StartChild("node", $"{Quote(nextCli)} start -p 3000", _repoRoot, null);

            await WaitForUrlAsync("http://localhost:8788/health", 15000);
            await WaitForUrlAsync("http://localhost:3000", 30000);
            StartOverlayAgentIfPresent();

            _isRunning = true;
            _startButton.Enabled = false;
            _openButton.Enabled = true;
            _stopButton.Enabled = true;

            Log("Stack started successfully.");
            OpenBrowser("http://localhost:3000");
        }
        catch (Exception ex)
        {
            StopStack();
            MessageBox.Show(ex.Message, "Launcher startup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void StartOverlayAgentIfPresent()
    {
        var candidates = new[]
        {
            Path.Combine(_repoRoot!, "desktop", "overlay-agent", "SlayTheList.OverlayAgent", "bin", "Release", "net8.0-windows", "SlayTheList.OverlayAgent.exe"),
            Path.Combine(_repoRoot!, "desktop", "overlay-agent", "SlayTheList.OverlayAgent", "bin", "Debug", "net8.0-windows", "SlayTheList.OverlayAgent.exe"),
        };

        var overlayExe = candidates.FirstOrDefault(File.Exists);
        if (overlayExe is null)
        {
            Log("Overlay agent exe not found (skipping). Build overlay project if needed.");
            return;
        }

        StartChild(overlayExe, "", Path.GetDirectoryName(overlayExe)!, null);
    }

    private void StopStack()
    {
        if (_childProcesses.Count == 0)
        {
            _isRunning = false;
            _startButton.Enabled = true;
            _openButton.Enabled = false;
            _stopButton.Enabled = false;
            return;
        }

        foreach (var process in _childProcesses.ToList())
        {
            try
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(2000);
                }
            }
            catch
            {
                // Best effort process cleanup.
            }
            finally
            {
                process.Dispose();
            }
        }

        _childProcesses.Clear();
        _isRunning = false;
        _startButton.Enabled = true;
        _openButton.Enabled = false;
        _stopButton.Enabled = false;
        Log("Stack stopped.");
    }

    private void StartChild(
        string fileName,
        string arguments,
        string workingDirectory,
        Dictionary<string, string>? extraEnv
    )
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        if (extraEnv is not null)
        {
            foreach (var kv in extraEnv)
            {
                psi.Environment[kv.Key] = kv.Value;
            }
        }

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) Log(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) Log(e.Data); };
        process.Exited += (_, _) => Log($"Process exited: {Path.GetFileName(fileName)} (PID {process.Id})");

        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start process: {fileName}");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        _childProcesses.Add(process);
        Log($"Started {Path.GetFileName(fileName)} (PID {process.Id})");
    }

    private async Task WaitForUrlAsync(string url, int timeoutMs)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                using var response = await _httpClient.GetAsync(url);
                if (response.IsSuccessStatusCode)
                {
                    Log($"Ready: {url}");
                    return;
                }
            }
            catch
            {
                // Not ready yet.
            }

            await Task.Delay(500);
        }

        throw new TimeoutException($"Timed out waiting for {url}");
    }

    private static string? FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var packageJson = Path.Combine(dir.FullName, "package.json");
            if (File.Exists(packageJson))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        return null;
    }

    private void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            Log($"Failed to open browser: {ex.Message}");
        }
    }

    private void Log(string message)
    {
        var line = $"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}";
        if (InvokeRequired)
        {
            BeginInvoke(() => _logBox.AppendText(line));
            return;
        }

        _logBox.AppendText(line);
    }

    private static string Quote(string path) => $"\"{path}\"";
}
