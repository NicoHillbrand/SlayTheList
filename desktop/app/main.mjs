import { app, BrowserWindow, dialog } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCAL_HOST = "localhost";
const API_PORT = 8788;
const PREFERRED_WEB_PORT = 3000;

let mainWindow = null;
let loadingWindow = null;
let stopping = false;
const childProcesses = [];
let logStream = null;
let webPort = PREFERRED_WEB_PORT;

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function getBundleRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app-bundle")
    : getRepoRoot();
}

function getDataDir() {
  if (!app.isPackaged) {
    return path.join(getRepoRoot(), "backend", "api", "data");
  }

  return path.join(app.getPath("userData"), "data");
}

function getLogFilePath() {
  return path.join(app.getPath("userData"), "logs", "launcher.log");
}

async function createLogStream() {
  const logFilePath = getLogFilePath();
  await mkdir(path.dirname(logFilePath), { recursive: true });
  return createWriteStream(logFilePath, { flags: "a" });
}

function writeLog(stream, message) {
  if (!stream) {
    return;
  }
  stream.write(`[${new Date().toISOString()}] ${message}\n`);
}

function resolveNodeRunnerEnv(extraEnv = {}) {
  if (!app.isPackaged) {
    return {
      ...process.env,
      ...extraEnv,
    };
  }

  return {
    ...process.env,
    ...extraEnv,
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function spawnNodeScript(scriptPath, args, options) {
  const nodeExecutable = app.isPackaged
    ? process.execPath
    : (process.env.npm_node_execpath || process.env.NODE || "node");
  const child = spawn(nodeExecutable, [scriptPath, ...args], {
    cwd: options.cwd,
    env: resolveNodeRunnerEnv(options.env),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  childProcesses.push(child);
  return child;
}

function pipeLogs(child, name, stream) {
  child.stdout.on("data", (chunk) => writeLog(stream, `[${name}] ${chunk.toString().trimEnd()}`));
  child.stderr.on("data", (chunk) => writeLog(stream, `[${name}:err] ${chunk.toString().trimEnd()}`));
  child.on("exit", (code, signal) => writeLog(stream, `[${name}] exited code=${code ?? "null"} signal=${signal ?? "null"}`));
  child.on("error", (error) => writeLog(stream, `[${name}:spawn] ${error.message}`));
}

async function waitForUrl(url, timeoutMs, stream) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        writeLog(stream, `Ready: ${url}`);
        return;
      }
    } catch {
      // Not ready yet.
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function getAppUrl() {
  return `http://${LOCAL_HOST}:${webPort}`;
}

function getApiHealthUrl() {
  return `http://${LOCAL_HOST}:${API_PORT}/health`;
}

async function ensurePortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => reject(error));
    server.listen(port, () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });
  });
}

async function reserveRandomPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine an open port.")));
        return;
      }

      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function resolveWebPort(stream) {
  try {
    await ensurePortAvailable(PREFERRED_WEB_PORT);
    return PREFERRED_WEB_PORT;
  } catch {
    const fallbackPort = await reserveRandomPort();
    writeLog(stream, `Port ${PREFERRED_WEB_PORT} is busy; using port ${fallbackPort} for the web app.`);
    return fallbackPort;
  }
}

async function ensureApiPortAvailable() {
  try {
    await ensurePortAvailable(API_PORT);
  } catch {
    throw new Error(`Port ${API_PORT} is already in use. Close the existing process and try again.`);
  }
}

async function syncAssetsIfNeeded(stream) {
  if (app.isPackaged) {
    return;
  }

  const scriptPath = path.join(getRepoRoot(), "scripts", "sync-blocked-overlays.mjs");
  const child = spawnNodeScript(scriptPath, [], {
    cwd: getRepoRoot(),
    env: {},
  });
  pipeLogs(child, "sync-assets", stream);

  const exitCode = await new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code ?? 0));
    child.once("error", reject);
  });

  if (exitCode !== 0) {
    throw new Error("Failed to sync blocked overlay images.");
  }
}

function startApi(stream) {
  const bundleRoot = getBundleRoot();
  const scriptPath = app.isPackaged
    ? path.join(bundleRoot, "backend", "api", "dist", "server.js")
    : path.join(bundleRoot, "backend", "api", "src", "server.ts");
  const args = app.isPackaged ? [] : [path.join(bundleRoot, "node_modules", "tsx", "dist", "cli.mjs"), "watch"];
  const cwd = app.isPackaged
    ? path.join(bundleRoot, "backend", "api")
    : path.join(bundleRoot, "backend", "api");

  const child = app.isPackaged
    ? spawnNodeScript(scriptPath, [], {
        cwd,
        env: {
          NODE_ENV: "production",
          PORT: String(API_PORT),
          SLAYTHELIST_DATA_DIR: getDataDir(),
        },
      })
    : spawnNodeScript(args[0], ["watch", "src/server.ts"], {
        cwd,
        env: {
          PORT: String(API_PORT),
          SLAYTHELIST_DATA_DIR: getDataDir(),
        },
      });

  pipeLogs(child, "api", stream);
  return child;
}

function startWeb(stream) {
  const bundleRoot = getBundleRoot();
  const nextCliPath = path.join(bundleRoot, "node_modules", "next", "dist", "bin", "next");
  const cwd = path.join(bundleRoot, "frontend", "web");
  const args = app.isPackaged ? ["start", "-p", String(webPort)] : ["dev", "-p", String(webPort)];
  const child = spawnNodeScript(nextCliPath, args, {
    cwd,
    env: {
      NODE_ENV: app.isPackaged ? "production" : "development",
      NEXT_PUBLIC_API_BASE_URL: `http://${LOCAL_HOST}:${API_PORT}`,
    },
  });

  pipeLogs(child, "web", stream);
  return child;
}

async function stopChildren() {
  if (stopping) {
    return;
  }
  stopping = true;

  const children = childProcesses.splice(0, childProcesses.length);
  for (const child of children) {
    if (child.killed) {
      continue;
    }

    try {
      child.kill("SIGTERM");
    } catch {
      // Best effort shutdown.
    }
  }

  await delay(500);

  for (const child of children) {
    if (child.exitCode !== null) {
      continue;
    }

    try {
      child.kill("SIGKILL");
    } catch {
      // Best effort shutdown.
    }
  }

  stopping = false;
}

function closeLogStream() {
  if (!logStream) {
    return;
  }

  logStream.end();
  logStream = null;
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 420,
    height: 220,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#111827",
  });

  loadingWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`
        <html>
          <body style="margin:0;display:flex;align-items:center;justify-content:center;background:#111827;color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <div style="text-align:center;max-width:280px;">
              <h1 style="font-size:24px;margin:0 0 12px;">SlayTheList</h1>
              <p style="margin:0;color:#cbd5e1;line-height:1.5;">Starting the local app stack. This window will close when everything is ready.</p>
            </div>
          </body>
        </html>
      `),
  );
  loadingWindow.once("ready-to-show", () => loadingWindow?.show());
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#0b1020",
  });

  mainWindow.once("ready-to-show", () => {
    loadingWindow?.close();
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(getAppUrl());
}

async function startStack() {
  logStream = await createLogStream();
  writeLog(logStream, `Launcher starting in ${app.isPackaged ? "packaged" : "development"} mode.`);

  try {
    await mkdir(getDataDir(), { recursive: true });
    await ensureApiPortAvailable();
    webPort = await resolveWebPort(logStream);
    await syncAssetsIfNeeded(logStream);
    startApi(logStream);
    await waitForUrl(getApiHealthUrl(), 20000, logStream);
    startWeb(logStream);
    await waitForUrl(getAppUrl(), app.isPackaged ? 30000 : 60000, logStream);
    await createMainWindow();
  } catch (error) {
    writeLog(logStream, `Startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    loadingWindow?.close();
    const detail = error instanceof Error
      ? `${error.message}\n\nSee launcher log for details:\n${getLogFilePath()}`
      : `See launcher log for details:\n${getLogFilePath()}`;
    await dialog.showMessageBox({
      type: "error",
      title: "SlayTheList failed to start",
      message: "The local app stack could not be started.",
      detail,
    });
    await stopChildren();
    closeLogStream();
    app.quit();
  }
}

app.on("window-all-closed", async () => {
  await stopChildren();
  closeLogStream();
  app.quit();
});

app.on("before-quit", async () => {
  await stopChildren();
  closeLogStream();
});

app.whenReady().then(async () => {
  createLoadingWindow();
  await startStack();
});
