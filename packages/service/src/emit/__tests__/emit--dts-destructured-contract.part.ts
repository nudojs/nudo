/**
 * Bug 538 —— **dts 面**对**解构形参**把**整份手写契约丢掉** ⇒ 生成的
 * `.d.ts` 声明 `act(_p0: unknown): number` ⇒ TS 消费方**零类型检查**
 * （错误调用 `tsc` exit 0 静默放行），而同一次导出的 check / zod /
 * standard 三面**都保真**。
 *
 * 根因：dts 生成器把「契约的形参位」与「分析的形参表」**按名字 join**
 * （`contractByParam.get(bare)`）。分析侧的形参名来自
 * `formalParamDisplayNames` —— 对**解构（pattern）形参**返回**求值占位**
 * `_p0`；而契约侧的键是**绑定名**（`a` / `b`）⇒ 两者永不相交 ⇒ 契约
 * Abs 恒为 undefined ⇒ 形参类型回落成 `unknown`。
 *
 * 修法：解构形参的契约**字段级**条目聚合成该形参的**形状**；形参名用
 * **签名展示名**（`{ a, b }`），不再把求值占位 `_p0` 写进公共 API 声明。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { num, type Abs } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { projectFunctionDts } from "../dts-generator.ts";
import { tmpProject } from "../../__tests__/tmp-project.ts";

const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, conf: "exact" }) as unknown as Abs;

/** tsc --noEmit --strict 实测 */
function tscNoEmit(files: Record<string, string>): { ok: boolean; stderr: string } {
  const dir = tmpProject("nudo-dts-destr-");
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

describe("Bug 538 —— dts 解构形参吃契约", () => {
  it("契约的字段级条目聚合成该形参的形状（不再是 unknown）", () => {
    const source = `export function act({ a, b }) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-destr.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act({ a, b }: { a: number; b: number })",
    );
    expect(p.lines.join("\n")).not.toContain("_p0");
  });

  it("消费方错误调用不再静默放行（改前 exit 0）", () => {
    const source = `export function act({ a, b }) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-destr2.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    const check = tscNoEmit({
      "mod.d.ts": p.lines.join("\n") + "\n",
      "use.ts": 'import { act } from "./mod.js";\nexport const r = act({ a: "wrong", b: 2 });\n',
    });
    expect(check.ok).toBe(false);
    // 对象字面量内的类型不匹配 ⇒ TS2322（整体不匹配 ⇒ TS2345）
    expect(check.stderr).toMatch(/TS2322|TS2345/);
  });

  it("负控制：契约缺该绑定时回落求值占位（不产出不可编译的模式形态）", () => {
    const source = `export function act({ a, b }) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-destr3.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      // 契约只覆盖 a —— b 无契约证据 ⇒ 模式形态与类型不匹配 ⇒ 回落占位名
      params: [{ name: "a", abs: num() }],
    });
    expect(p.lines.join("\n")).toContain("act(_p0:");
    const check = tscNoEmit({ "mod.d.ts": p.lines.join("\n") + "\n" });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：具名形参的契约投影不受影响", () => {
    const source = `export function act(a, b) { return a + b; }\n`;
    const result = analyzeFile("/test/s2-named.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(a: number, b: number)",
    );
  });
});
