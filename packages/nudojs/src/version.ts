/**
 * `--version`：产品包是 `nudojs`（CLI），引擎包 `@nudojs/core` 可解析时附带一行。
 * 解析失败的行省略，不抛错。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function readVersionAt(pkgPath: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function findOwnPackageVersion(): string {
  // src/version.ts → packages/nudojs/package.json；bundled dist/index.js 同理
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string; version?: string };
        if (pkg.name === "nudojs" && typeof pkg.version === "string") return pkg.version;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

function ownPackageDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
        if (pkg.name === "nudojs") return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(fileURLToPath(import.meta.url));
}

function versionFromResolvedEntry(name: string): string | undefined {
  try {
    const entry = require.resolve(name);
    let dir = dirname(entry);
    for (let i = 0; i < 6; i++) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string; version?: string };
          if (pkg.name === name && typeof pkg.version === "string") return pkg.version;
        } catch {
          /* keep walking */
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* unresolvable */
  }
  return undefined;
}

function corePackageVersion(): string | undefined {
  const viaEntry = versionFromResolvedEntry("@nudojs/core");
  if (viaEntry) return viaEntry;
  const root = ownPackageDir();
  const candidates = [
    join(root, "..", "core", "package.json"),
    join(root, "node_modules", "@nudojs", "core", "package.json"),
    join(root, "..", "..", "@nudojs", "core", "package.json"),
  ];
  for (const p of candidates) {
    const v = readVersionAt(p);
    if (v) return v;
  }
  return undefined;
}

/** `nudo --version`：`nudojs <ver>` + 可解析时 `@nudojs/core <ver>`。 */
export function formatVersionOutput(): string {
  const self = findOwnPackageVersion();
  const core = corePackageVersion();
  const lines: string[] = ["nudojs " + self];
  if (core) lines.push("@nudojs/core " + core);
  return lines.join("\n");
}
