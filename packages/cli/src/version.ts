/**
 * `--version` 心智：壳包（nudojs）≠ 引擎（@nudojs/cli）。
 * 同屏打印 shell 包版本、@nudojs/cli 版本、以及可解析到的 @nudojs/core 版本。
 * 解析失败的包省略该行，不抛错。
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
  // src/version.ts → packages/cli/package.json；bundled dist/index.js 同理
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string; version?: string };
        if (pkg.name === "@nudojs/cli" && typeof pkg.version === "string") return pkg.version;
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

function cliPackageDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
        if (pkg.name === "@nudojs/cli") return dir;
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

function shellPackageVersion(): string | undefined {
  // 1) monorepo workspace: packages/cli → packages/nudojs
  // 2) npm layout: node_modules/nudojs/node_modules/@nudojs/cli → node_modules/nudojs
  // 3) npm hoisted: node_modules/@nudojs/cli → node_modules/nudojs
  const root = cliPackageDir();
  const candidates = [
    join(root, "..", "nudojs", "package.json"),
    join(root, "..", "..", "..", "nudojs", "package.json"),
    join(root, "..", "..", "nudojs", "package.json"),
  ];
  for (const p of candidates) {
    const v = readVersionAt(p);
    if (v) return v;
  }
  try {
    return readVersionAt(require.resolve("nudojs/package.json"));
  } catch {
    return undefined;
  }
}

function corePackageVersion(): string | undefined {
  const viaEntry = versionFromResolvedEntry("@nudojs/core");
  if (viaEntry) return viaEntry;
  const root = cliPackageDir();
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

/** `nudo --version` 多行输出：shell 包（nudojs）+ @nudojs/cli + core（可解析时省略失败行）。 */
export function formatVersionOutput(): string {
  const cli = findOwnPackageVersion();
  const shell = shellPackageVersion();
  const core = corePackageVersion();
  const lines: string[] = [];
  if (shell) lines.push("nudojs " + shell);
  lines.push("@nudojs/cli " + cli);
  if (core) lines.push("@nudojs/core " + core);
  return lines.join("\n");
}
