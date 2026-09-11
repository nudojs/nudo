import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { checkSource } from "../index.ts";

/**
 * 真实包精度门禁：error 级误报必须为 0。
 * 包不存在时跳过（非 monorepo / 未装依赖）。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(import.meta.url);

const ERROR_CODES = [
  "nudo:constraint-violated",
  "nudo:assign-mismatch",
  "nudo:arg-structure",
  "nudo:case-inconsistency",
] as const;

function pkgJsFiles(pkgName: string): { label: string; source: string }[] {
  let pkgRoot: string | undefined;
  // 先试 package.json；exports 未暴露时从主入口反推
  try {
    pkgRoot = dirname(require.resolve(`${pkgName}/package.json`));
  } catch {
    try {
      let p = require.resolve(pkgName);
      // 主入口可能在 lib/ 或 src/；向上找到含 package.json 的目录
      for (let i = 0; i < 4; i++) {
        const parent = dirname(p);
        if (existsSync(join(parent, "package.json"))) {
          pkgRoot = parent;
          break;
        }
        p = parent;
      }
    } catch {
      return [];
    }
  }
  if (!pkgRoot) return [];
  const out: { label: string; source: string }[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "tests" || e.name === "typings") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.(mjs|cjs)$/.test(e.name) || e.name.endsWith(".js")) {
        try {
          out.push({
            label: `${pkgName}/${p.slice(pkgRoot!.length + 1)}`,
            source: readFileSync(p, "utf8"),
          });
        } catch {
          // skip
        }
      }
    }
  };
  walk(pkgRoot);
  return out;
}

function scanPackage(pkgName: string): { scanned: number; violations: string[] } {
  const files = pkgJsFiles(pkgName);
  const violations: string[] = [];
  let scanned = 0;
  for (const { label, source } of files) {
    let r;
    try {
      r = checkSource(label, source);
    } catch {
      continue;
    }
    scanned++;
    for (const i of r.issues) {
      if (i.severity === "error" && (ERROR_CODES as readonly string[]).includes(i.code)) {
        violations.push(`${label}:${i.line ?? "?"} [${i.code}] ${i.message}`);
      }
    }
  }
  return { scanned, violations };
}

describe("real package precision", () => {
  it.runIf(existsSync(join(root, "node_modules/commander/lib")))(
    "commander: no false-positive errors",
    () => {
      const { scanned, violations } = scanPackage("commander");
      expect(scanned).toBeGreaterThan(3);
      expect(violations, violations.join("\n")).toEqual([]);
    },
  );

  it("escape-string-regexp: no false-positive errors", () => {
    const { scanned, violations } = scanPackage("escape-string-regexp");
    expect(scanned).toBeGreaterThan(0);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("is-plain-obj: no false-positive errors", () => {
    const { scanned, violations } = scanPackage("is-plain-obj");
    expect(scanned).toBeGreaterThan(0);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("debug: no false-positive errors", () => {
    const { scanned, violations } = scanPackage("debug");
    expect(scanned).toBeGreaterThan(0);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
