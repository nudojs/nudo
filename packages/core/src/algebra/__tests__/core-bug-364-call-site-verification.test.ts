/**
 * Bug 364 —— `checkArg` / `checkCall` 是**死码**（无生产者）⇒ 文档承诺的
 * 调用点验证面在产品里**整体静默**：`nudo:arg-count` / `nudo:arg-opaque` /
 * `nudo:constraint-unproven` / `nudo:fn-not-found` / `nudo:partial-result`
 * 五个码在 `nudo check` 里**从不产生**。
 *
 * 修法（core/algebra/diagnostics.ts + core/algebra/scan-literal-calls.ts）：
 * ① 把调用点验证接进产品路径——调用点扫描调 `checkCallSite`（通用化参数面
 *    的实参个数 / 实参义务 / 结果置信度）；
 * ② `checkArg` 判定前把期望 pred 的**主题项**对齐到实参 term（此前
 *    expect 的主题项是参数位 term（`A1`）、实参 pred 相对实参 term（`x`）
 *    ⇒ 永不同一 ⇒ 任何非字面量实参都被判 `nudo:constraint-unproven` 假红）。
 *
 * 口径：`nudo:fn-not-found` **不**进产品路径（调用点能否解析由调用点扫描
 * 判，宿主全局 / 跨文件导入另有码）⇒ 此处报会误伤。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, checkArg, numVar, gtNum, v } from "../index.ts";

const codes = (r: { issues: Array<{ code: string }> }): string[] =>
  r.issues.map((i) => i.code);

describe("Bug 364：调用点验证面接进产品路径（五个码不再是死码）", () => {
  it("少传必填实参 → nudo:arg-count（此前从不产生）", () => {
    const r = checkSource(
      "arity.js",
      `
export function add(a, b) { return a + b; }
add(1);
`,
      pTrue,
    );
    const argCount = r.issues.filter((i) => i.code === "nudo:arg-count");
    expect(argCount.length).toBe(1);
    expect(argCount[0]?.severity).toBe("error");
    expect(argCount[0]?.message).toContain("expects 2 argument(s), got 1");
  });

  it("零实参调用被调方（必填位） → nudo:arg-count", () => {
    const r = checkSource(
      "arity0.js",
      `
export function one(x) { return x + 1; }
one();
`,
      pTrue,
    );
    expect(codes(r)).toContain("nudo:arg-count");
    expect(
      r.issues.find((i) => i.code === "nudo:arg-count")?.message,
    ).toContain("expects 1 argument(s), got 0");
  });

  it("默认形参 / rest 形参**不吃**实参位 ⇒ 不误报 arg-count", () => {
    const r = checkSource(
      "arity-ok.js",
      `
export function opt(a, b = 2) { return a + b; }
export function rest(...xs) { return xs.length; }
opt(1);
rest();
rest(1, 2, 3);
`,
      pTrue,
    );
    expect(codes(r)).not.toContain("nudo:arg-count");
  });

  it("实参个数正确 ⇒ 无 arg-count（不多传也不算错）", () => {
    const r = checkSource(
      "arity-ok2.js",
      `
export function add(a, b) { return a + b; }
add(1, 2);
`,
      pTrue,
    );
    expect(codes(r)).not.toContain("nudo:arg-count");
  });

  it("checkArg：期望主题项对齐到实参 term ⇒ 非字面量实参不再恒判 unproven", () => {
    // 实参 pred 相对实参 term（x），期望相对参数位 term（t）
    const d = checkArg(numVar("x", gtNum(v("x"), 0)), gtNum(v("t"), 0));
    expect(d).toBeUndefined();
  });
});
