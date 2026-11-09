/**
 * `nudo --version` 的包版本定位。
 *
 * 三个查询（自身版本 / 自身包目录 / 依赖包版本）共用一个「向上走找
 * package.json」骨架（findPkgDirUpwards）——此前三份手写循环各维护一份
 * （6 层上限 / root 停 / name 匹配），漂移风险在「层上限改一处漏两处」。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonText } from "./read-json.ts";

/** 向上（最多 6 层）找 `name` 所属包的目录：命中 = 该目录 package.json
 *  的 name 字段精确等于 name。未命中 / 不可读 → undefined（版本行缺省，
 *  不 fail loud——`--version` 不因环境残缺而崩）。 */
function findPkgDirUpwards(startDir: string, name: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = parseJsonText(readFileSync(pkgPath, "utf-8")) as { name?: string };
        if (pkg.name === name) return dir;
      } catch {
        /* optional: package.json unreadable — keep walking parent dirs */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function readVersionAt(pkgPath: string): string | undefined {
  try {
    const pkg = parseJsonText(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    /* optional: package.json unreadable — omit version line */
    return undefined;
  }
}

function srcDir(): string {
  // src/version.ts → packages/nudojs/package.json；bundled dist/index.js 同理
  return dirname(fileURLToPath(import.meta.url));
}

function findOwnPackageVersion(): string {
  const dir = findPkgDirUpwards(srcDir(), "nudojs");
  return dir ? readVersionAt(join(dir, "package.json")) ?? "0.0.0" : "0.0.0";
}

function ownPackageDir(): string {
  return findPkgDirUpwards(srcDir(), "nudojs") ?? srcDir();
}

function versionFromResolvedEntry(name: string): string | undefined {
  try {
    const entry = require.resolve(name);
    const dir = findPkgDirUpwards(dirname(entry), name);
    return dir ? readVersionAt(join(dir, "package.json")) : undefined;
  } catch {
    /* optional: package unresolvable — omit core version line */
    return undefined;
  }
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
