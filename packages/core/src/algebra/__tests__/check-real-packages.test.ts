import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { checkSource } from "../index.ts";

/**
 * 真实包精度门禁：L1 error 级误报必须为 0。
 *
 * 分层（design-cli-semantics §3 / conflicts E3）：
 * - **L2 off 基线**：本套件 `entryThrows: "off"`，只锁显式契约/调用点证据的
 *   zero-FP（ERROR_CODES）。入口 may-throw 不进此表。
 * - **L2 on**：`nudo:entry-may-throw` 默认 error，真实包上常见；由
 *   check-recall-gold L2 用例与 CLI `--ignore-throws` 覆盖，不在此 zero-FP 内。
 *
 * 门禁必须响：任一包解析失败、文件读取失败、checkSource 抛错或候选
 * 文件数为 0 都直接红。
 */

const require = createRequire(import.meta.url);

const ERROR_CODES = [
  "nudo:constraint-violated",
  "nudo:assign-mismatch",
  "nudo:arg-structure",
  "nudo:case-inconsistency",
  // interface 产品面新 error 码：同样要求真实包零 FP 背书
  "nudo:interface-load",
  "nudo:interface-cycle",
  "nudo:interface-conflict",
  "nudo:interface-domain-exceeds",
  "nudo:interface-name-clash",
] as const;

type ScanOutcome = { scanned: number; violations: string[]; errors: string[] };

function scanPackage(pkgName: string): ScanOutcome {
  const errors: string[] = [];
  const violations: string[] = [];
  const files: { label: string; source: string }[] = [];

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
      // 落到下方统一报错
    }
  }
  if (!pkgRoot) {
    return {
      scanned: 0,
      violations,
      errors: [`${pkgName}: 无法解析（未安装或不在 Node 解析路径上）`],
    };
  }

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      errors.push(`${pkgName}: 列目录 ${dir} 失败 — ${(e as Error).message}`);
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "tests" || e.name === "typings") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.(mjs|cjs)$/.test(e.name) || e.name.endsWith(".js")) {
        try {
          files.push({
            label: `${pkgName}/${p.slice(pkgRoot!.length + 1)}`,
            source: readFileSync(p, "utf8"),
          });
        } catch (e2) {
          errors.push(`${pkgName}: 读取 ${p} 失败 — ${(e2 as Error).message}`);
        }
      }
    }
  };
  walk(pkgRoot);

  let scanned = 0;
  for (const { label, source } of files) {
    let r;
    try {
      // L2 off：本套件只锁 L1 zero-FP（见文件头分层说明）
      r = checkSource(label, source, undefined, { entryThrows: "off" });
    } catch (e) {
      errors.push(`${label}: checkSource 抛错 — ${(e as Error).message}`);
      continue;
    }
    scanned++;
    for (const i of r.issues) {
      if (i.severity === "error" && (ERROR_CODES as readonly string[]).includes(i.code)) {
        violations.push(`${label}:${i.line ?? "?"} [${i.code}] ${i.message}`);
      }
    }
  }
  return { scanned, violations, errors };
}

/** 门禁断言：包可解析、扫到足量文件、扫描全程无错误、无 error 级误报。 */
function expectNoFalsePositives(pkgName: string, minFiles: number): void {
  const { scanned, violations, errors } = scanPackage(pkgName);
  expect(errors, `${pkgName} 扫描错误:\n${errors.join("\n")}`).toEqual([]);
  expect(scanned, `${pkgName} 仅扫到 ${scanned} 个候选文件（要求 > ${minFiles}）`).toBeGreaterThan(minFiles);
  expect(violations, violations.join("\n").slice(0, 2000)).toEqual([]);
}

describe("real package precision", () => {
  it("commander: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("commander", 3);
  });

  it("escape-string-regexp: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("escape-string-regexp", 0);
  });

  it("is-plain-obj: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("is-plain-obj", 0);
  });

  it("debug: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("debug", 0);
  });

  it("yocto-queue (class): no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("yocto-queue", 0);
  });

  it("p-limit: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("p-limit", 0);
  });

  it("kleur: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("kleur", 0);
  });

  it("eventemitter3: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("eventemitter3", 0);
  });

  it("ms: no false-positive errors", { timeout: 60_000 }, () => {
    expectNoFalsePositives("ms", 0);
  });

  it("lodash: no false-positive errors", { timeout: 120_000 }, () => {
    // lodash 体积大：至少扫到一批入口文件
    expectNoFalsePositives("lodash", 5);
  });
});
