// Compiles helper/src/main.ts into one executable with Bun and puts it where
// Tauri expects its sidecar: src-tauri/binaries/pia-helper-<target triple>.
//   node scripts/build-helper.mjs                  build for this computer
//   node scripts/build-helper.mjs --target=windows build the Windows helper

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const wantWindows = process.argv.includes("--target=windows");

const hostTriple = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)[1].trim();
const triple = wantWindows ? "x86_64-pc-windows-msvc" : hostTriple;
const bunTarget = {
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-apple-darwin": "bun-darwin-arm64",
}[triple];
if (!bunTarget) throw new Error(`No Bun target for ${triple}`);

const outDir = path.join(root, "src-tauri", "binaries");
mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, `pia-helper-${triple}${triple.includes("windows") ? ".exe" : ""}`);
const bun = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "bun.exe" : "bun");

execFileSync(
  bun,
  ["build", path.join(root, "helper", "src", "main.ts"), "--compile", "--minify", `--target=${bunTarget}`, "--outfile", outfile],
  { stdio: "inherit", cwd: root },
);
console.error(`helper: ${path.relative(root, outfile)}`);
