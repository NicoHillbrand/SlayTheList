import { mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "assets", "blocked-overlays");
const targetDir = path.join(repoRoot, "frontend", "web", "public", "blocked-overlays");
const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

await mkdir(targetDir, { recursive: true });

let copiedCount = 0;

try {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      continue;
    }

    await copyFile(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    copiedCount += 1;
  }
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    console.log("No blocked overlay source directory found; created target directory only.");
    process.exit(0);
  }

  throw error;
}

console.log(`Synced ${copiedCount} blocked overlay image${copiedCount === 1 ? "" : "s"}.`);
