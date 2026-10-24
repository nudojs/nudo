/**
 * Bug 526 / Bug 553 —— dts 顶层形参的**可选性**。
 *
 * 526：可选性取自「**观测到的调用元数**」而非**声明形参表** ⇒ 带**默认值**
 *      的形参在 `.d.ts` 里被渲染成**必填**（消费方 TS2554）。
 * 553：同一根因的另一形态——实现签名里的默认参数被当成必填 ⇒
 *      `export declare function def(x: unknown): unknown;` ⇒ 消费方 `def()`
 *      报 TS2554 ⇒ 生成的 `.d.ts` **拒绝实现本身允许的调用**。
 *
 * 修法：可选性来源改为
 *   ① 契约级（手写契约申报的调用域，权威；Bug 536）→
 *   ② 声明级（实现签名带默认值 ⇒ JS 语义可省略）→
 *   ③ 观测级（最短观测调用省略了该位）。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../dts-generator.ts";
import { tmpProject } from "../../__tests__/tmp-project.ts";

/** tsc --noEmit --strict 实测 */
function tscNoEmit(files: Record<string, string>): { ok: boolean; stderr: string } {
  const dir = tmpProject("nudo-dts-opt-");
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    writeFileSync(p, content.endsWith("\n") ? content : content + "\n", "utf-8");
    paths.push(p);
  }
  try {
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--ignoreConfig", ...paths],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("Bug 526 / 553 —— dts 顶层形参可选性来自声明形参表", () => {
  it("带默认值的形参渲染成可选（无调用证据时也是）", () => {
    const source = `
export function optNoEvidence(a, b = 2) { return a + b; }
`;
    const dts = generateDts(analyzeFile("/test/s2-opt.js", source));
    // 类型词（unknown / any）是类型渲染面的口径（不在本分片职责内）——
    // 本钉只关心**可选性**标记。
    expect(dts).toMatch(/export declare function optNoEvidence\(a: (unknown|any), b\?: (unknown|any)\)/);
  });

  it("有调用证据时形参表不缩水（观测元数不再裁剪声明形参表）", () => {
    const source = `
export function optWithEvidence(a, b = 2) { return a + b; }
optWithEvidence(1);
`;
    const dts = generateDts(analyzeFile("/test/s2-opt2.js", source));
    expect(dts).toContain("export declare function optWithEvidence(a: number, b?: unknown)");
  });

  it("默认值为 undefined 的形参同样可选", () => {
    const source = `
export function optUndefinedDefault(a, b = undefined) { return a; }
`;
    const dts = generateDts(analyzeFile("/test/s2-opt3.js", source));
    expect(dts).toMatch(/export declare function optUndefinedDefault\(a: (unknown|any), b\?: (unknown|any)\)/);
  });

  it("Bug 553：消费方按实现允许的零参调用不再吃 TS2554", () => {
    const source = `
export function def(x = 1) { return x; }
`;
    const dts = generateDts(analyzeFile("/test/s2-def.js", source));
    expect(dts).toMatch(/export declare function def\(x\?: (unknown|any)\): (unknown|any);/);
    const check = tscNoEmit({
      "mod.d.ts": dts,
      "use.ts": 'import { def } from "./mod.js";\nexport const r = def();\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：无默认值的形参仍是必填（不假造可选性）", () => {
    const source = `
export function need(a, b) { return a + b; }
`;
    const dts = generateDts(analyzeFile("/test/s2-need.js", source));
    expect(dts).toMatch(/export declare function need\(a: (unknown|any), b: (unknown|any)\)/);
    expect(dts).not.toContain("b?:");
  });
});
