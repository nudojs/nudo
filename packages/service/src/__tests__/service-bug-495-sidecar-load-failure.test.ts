/**
 * Bug 495：侧车（`*.nudo.js`）**加载失败**被误报成「没有契约根」
 * （`nudo:interface-entry-only`）⇒ 事实陈述错误 + 修复建议误导。
 *
 * 根因（analyzer-orchestrate-uncached-cases.ts）：用 `effectiveInterface(...)`
 * 的返回值是否存在来判定「有没有契约根」——它对「根本没有侧车」与「侧车存在
 * 但加载失败」返回**同一个 undefined**，两者不可区分 ⇒ 必然发「没有契约根」。
 *
 * 修法：把 core 侧 nudo:interface-load 通道的新诊断取进本文件的诊断通道
 * （error），并以「本文件侧车加载失败」粘滞标记抑制那条误导 info。
 *
 * 钉：坏侧车 → 有 nudo:interface-load（error）且**无** nudo:interface-entry-only；
 * 无侧车 → 仍有 nudo:interface-entry-only（负控制）；好侧车 → 两者都无（负控制）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

function codes(result: { diagnostics: readonly { code?: string }[] }): (string | undefined)[] {
  return result.diagnostics.map((d) => d.code);
}

describe("Bug 495：侧车加载失败 ≠ 没有契约根", () => {
  it("坏侧车：报 nudo:interface-load（error），不发 nudo:interface-entry-only", () =>
    withTmpProject("nudo-b495-", (dir) => {
      const src = `export function add(a, b) { return a + b; }\n`;
      const file = writeTmpFile(dir, "calc.js", src);
      writeTmpFile(
        dir,
        "calc.nudo.js",
        `import { fn, number } from "@nudojs/core";
export const add = fn({ a: number(
`,
      );
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      expect(codes(result)).toContain("nudo:interface-load");
      expect(codes(result)).not.toContain("nudo:interface-entry-only");
    }));

  it("负控制：没有侧车 → 仍报 nudo:interface-entry-only（口径不变）", () =>
    withTmpProject("nudo-b495b-", (dir) => {
      const src = `export function add(a, b) { return a + b; }\n`;
      const file = writeTmpFile(dir, "calc.js", src);
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      expect(codes(result)).toContain("nudo:interface-entry-only");
      expect(codes(result)).not.toContain("nudo:interface-load");
    }));

  it("负控制：好侧车 → 两者都无", () =>
    withTmpProject("nudo-b495c-", (dir) => {
      const src = `export function add(a, b) { return a + b; }\n`;
      const file = writeTmpFile(dir, "calc.js", src);
      writeTmpFile(
        dir,
        "calc.nudo.js",
        `import { fn, number } from "@nudojs/core";
export const add = fn({ a: number(), b: number() });
`,
      );
      const result = analyzeFile(file, readFileSync(file, "utf-8"));
      expect(codes(result)).not.toContain("nudo:interface-entry-only");
      expect(codes(result)).not.toContain("nudo:interface-load");
    }));
});
