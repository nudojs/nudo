/**
 * Bug 458 回归钉：只含 @nudo:assume / @nudo:invariant / @nudo:throws /
 * @nudo:budget 的文件，在 analysis.mode=directives 下必须**纳入分析面**。
 *
 * 改前：hasNudoDirectives 的名单漏掉这四个指令名 → 文件被判定为
 * 「非 nudo 文件」→ LSP 静默跳过（整份文件零诊断，假绿）。
 *
 * 负控制：无指令文件 / 指令只出现在字符串字面量里 → 仍不纳入；
 * 已在名单里的指令名不得被本次改动弄丢。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hasNudoDirectives, shouldAnalyzeFile } from "../analysis-scope.ts";
import { analysisConfig } from "../evaluator/config.ts";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

const directivesCfg = analysisConfig({ analysis: { mode: "directives" } });

/** 本次补齐的四个指令名（改前缺席）。 */
const MISSING = ["assume", "invariant", "throws", "budget"] as const;
/** 改前已在名单里的指令名（负控制：不得回退）。 */
const PRESENT = [
  "case", "mock", "pure", "skip", "sample", "contract", "import",
  "env", "mock-module", "as", "replace",
] as const;

function sourceWith(name: string): string {
  return `/**\n * @nudo:${name} x\n */\nexport function f(x) {\n  return x;\n}\n`;
}

function tmpDirProject(): string {
  return makeTmpProject("nudo-scope-458-", {
    "package.json": JSON.stringify({ name: "fx", nudo: { analysis: { mode: "directives" } } }),
  });
}

describe("Bug 458 — mode=directives 的指令名单要全（assume/invariant/throws/budget）", () => {
  it("hasNudoDirectives 认得 assume/invariant/throws/budget", () => {
    for (const name of MISSING) {
      expect(hasNudoDirectives(sourceWith(name)), name).toBe(true);
    }
  });

  it("shouldAnalyzeFile 纳入只含这四个指令的文件（改前：整份文件被跳过 → 假绿）", () => {
    const dir = tmpDirProject();
    for (const name of MISSING) {
      const file = join(dir, `only-${name}.js`);
      const source = sourceWith(name);
      writeFileSync(file, source);
      expect(shouldAnalyzeFile(file, source), name).toBe(true);
    }
  });

  it("负控制：无指令 / 指令只在字符串里 → 仍不纳入", () => {
    const dir = tmpDirProject();
    const plain = join(dir, "plain.js");
    const plainSrc = "export function f(x) {\n  return x;\n}\n";
    writeFileSync(plain, plainSrc);
    expect(shouldAnalyzeFile(plain, plainSrc)).toBe(false);

    const strOnly = join(dir, "str-only.js");
    const strSrc = 'export const s = "@nudo:assume d <= max";\n';
    writeFileSync(strOnly, strSrc);
    expect(shouldAnalyzeFile(strOnly, strSrc)).toBe(false);
  });

  it("负控制：已在名单里的指令名不得回退", () => {
    for (const name of PRESENT) {
      expect(hasNudoDirectives(sourceWith(name)), name).toBe(true);
    }
  });

  it("文件级指令形态（/// @nudo:env）也纳入", () => {
    const dir = tmpDirProject();
    const file = join(dir, "env.js");
    const source = "/// @nudo:env node\nexport function f(x) {\n  return x;\n}\n";
    writeFileSync(file, source);
    mkdirSync(dir, { recursive: true });
    expect(shouldAnalyzeFile(file, source)).toBe(true);
  });
});
