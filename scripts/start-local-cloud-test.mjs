import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const children = [];
let shuttingDown = false;

function startProcess(name, command, env = {}) {
  const child = spawn(command, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    shell: true,
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    process.stdout.write(`[${name}] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`);
    if (!shuttingDown && code && code !== 0) {
      shutdown(code);
    }
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Starting local cloud social test stack...");
console.log("Cloud social: http://localhost:8790");
console.log("API:          http://localhost:8788");
console.log("Web:          http://localhost:3000");

const cloudBaseUrl = process.env.CLOUD_SOCIAL_BASE_URL?.trim() || "http://localhost:8790";

startProcess("cloud", "npm run dev:cloud-social");
startProcess("api", "npm run dev:api", { CLOUD_SOCIAL_BASE_URL: cloudBaseUrl });
startProcess("web", "npm run dev:web");
