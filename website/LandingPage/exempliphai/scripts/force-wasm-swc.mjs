import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// In some CI/container environments the native SWC binary can crash (SIGBUS).
// This script forces Next.js to use the wasm SWC fallback.
//
// Next 16 will:
// 1) try native (@next/swc-*)
// 2) if that fails, download wasm into: node_modules/next/wasm/
//    and then import: <wasmDir>/@next/swc-wasm-nodejs/wasm.js
//
// We remove native binaries and *pre-populate* next/wasm from the installed
// @next/swc-wasm-nodejs package.

const nativePkgs = [
  "@next/swc-linux-x64-gnu",
  "@next/swc-linux-x64-musl",
  "@next/swc-linux-arm64-gnu",
  "@next/swc-linux-arm64-musl",
];

for (const pkg of nativePkgs) {
  const p = join(process.cwd(), "node_modules", ...pkg.split("/"));
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.log(`[postinstall] Removed native SWC package: ${pkg}`);
  }
}

const wasmSrc = join(
  process.cwd(),
  "node_modules",
  "@next",
  "swc-wasm-nodejs",
);

// Ensure Next's wasm fallback directory is populated.
const wasmDest = join(
  process.cwd(),
  "node_modules",
  "next",
  "wasm",
  "@next",
  "swc-wasm-nodejs",
);

if (existsSync(wasmSrc)) {
  // Clean up any prior copy/symlink from previous installs.
  if (existsSync(wasmDest)) {
    rmSync(wasmDest, { recursive: true, force: true });
  }

  // wasmSrc is a pnpm-managed symlink. Dereference so we copy real files
  // and avoid creating a symlink where Next expects a directory tree.
  mkdirSync(join(wasmDest, ".."), { recursive: true });
  cpSync(wasmSrc, wasmDest, { recursive: true, dereference: true });
  // eslint-disable-next-line no-console
  console.log("[postinstall] Copied wasm SWC bindings into node_modules/next/wasm");
}
