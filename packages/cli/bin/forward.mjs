#!/usr/bin/env node
// DEPRECATED migration stub. The `nudo` CLI lives in `nudojs` (packages/nudojs).
// Keep argv/exit-code transparent: re-import the real entry in this process.
// stderr notice only for interactive invocations: version/help probes (package
// managers resolving the bin) and NUDO_SUPPRESS_DEPRECATION=1 (scripted
// migration windows) stay silent.
const argv = process.argv.slice(2);
const quiet =
  process.env.NUDO_SUPPRESS_DEPRECATION === "1" ||
  argv.includes("--version") ||
  argv.includes("-v") ||
  argv.includes("-V") ||
  argv.includes("--help") ||
  argv.includes("-h");
if (!quiet) {
  console.error(
    "[nudo] `@nudojs/cli` is deprecated — install `nudojs` (same `nudo` bin). This stub will be removed.",
  );
}
// Dynamic import: a static `import "nudojs"` is hoisted above this module
// body, so the real CLI (whose --version/usage paths exit synchronously)
// would run before — and sometimes instead of — the notice.
await import("nudojs");
