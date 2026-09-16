import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { checkSource } from "../index.ts";

/**
 * 真实包精度门禁：error 级误报必须为 0。
 *
 * 门禁必须响：任一包解析失败、文件读取失败、checkSource 抛错或候选
 * 文件数为 0 都直接红——不再 runIf 静默 skip、不再 try-catch 静默
 * continue（历史上两者会让整批包免检而门禁仍然绿灯）。
 * 包定位沿用 check-real-commander.test.ts 的 createRequire 方案按
 * Node 解析规则走；fixture 包保持可解析（commander 是本包 devDependency，
 * 其余为工作区可解析依赖）。
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
      r = checkSource(label, source);
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
  it("commander: no false-positive errors", () => {
    expectNoFalsePositives("commander", 3);
  });

  it("escape-string-regexp: no false-positive errors", () => {
    expectNoFalsePositives("escape-string-regexp", 0);
  });

  it("is-plain-obj: no false-positive errors", () => {
    expectNoFalsePositives("is-plain-obj", 0);
  });

  it("debug: no false-positive errors", () => {
    expectNoFalsePositives("debug", 0);
  });

  it("yocto-queue (class): no false-positive errors", () => {
    expectNoFalsePositives("yocto-queue", 0);
  });

  it("p-limit: no false-positive errors", () => {
    expectNoFalsePositives("p-limit", 0);
  });

  it("kleur: no false-positive errors", () => {
    expectNoFalsePositives("kleur", 0);
  });

  it("eventemitter3: no false-positive errors", () => {
    expectNoFalsePositives("eventemitter3", 0);
  });

  it("ms: no false-positive errors", () => {
    expectNoFalsePositives("ms", 0);
  });

  it("lodash: no false-positive errors", () => {
    // lodash 体积大：至少扫到一批入口文件
    expectNoFalsePositives("lodash", 5);
  });
});
