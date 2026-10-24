/**
 * Bug 401 —— 对象解构形参：**未契约的兄弟绑定**被整个丢弃 ⇒ 合成出的形参
 * 形状是**闭对象** ⇒ 读兄弟绑定得 **exact `undefined`**（自信的错值；native
 * 是实值）。
 *
 * 根因：`generalize.ts` 的 `patternFields` 袋子只收**契约命中的字段** ⇒ 没有
 * 契约的兄弟绑定从头到尾不进袋子 ⇒ `buildPatternObjAbs` 把袋子原样变成形参
 * 的 obj shape ⇒ 形参类型写成 `{ a: number }`（源码里的 `{ a, b }` 只剩 a），
 * 函数体读 `b` 得 exact `undefined`。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：按「闭对象 → unknown」的语义补 ——
 * 合成前把该 pattern 的**全部顶层绑定**都放进袋子（未契约的用 `unknown`）。
 *
 * 反向钉：HEAD（未修）上形参类型是 `{ a: number }`、返回值是
 * `[number, undefined]` ⇒ 本文件在 HEAD 上**必失败**。
 */
import { describe, it, expect } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo, generalizeFromAst } from "../generalize.ts";

const TPL = `export const positive = number().gt(0);\n`;

/** 只契约 a 的解构形参 */
const PARTIAL = `/// @nudo:import { positive } from "./tpl.nudo.js"
/**
 * @nudo:contract a positive
 */
export function f({ a, b }) {
  return [a, b];
}
`;

/** 对照组：两个字段都有契约 */
const FULL = `/// @nudo:import { positive } from "./tpl.nudo.js"
/**
 * @nudo:contract a positive
 * @nudo:contract b positive
 */
export function f({ a, b }) {
  return [a, b];
}
`;

function checkOf(src: string): {
  paramTypes: string[];
  display: string;
  abs: unknown;
} {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  const r = checkSource("/t/f.js", src, pTrue, {
    loadModule: (spec: string) => (spec.includes("tpl.nudo.js") ? TPL : undefined),
    fromFile: "/t/f.js",
    autoBind: true,
  });
  const sig = r.signatures.find((s) => s.name === "f")!;
  return {
    paramTypes: sig.paramTypes ?? [],
    display: sig.display,
    abs: sig.abs,
  };
}

describe("Bug 401 未契约的兄弟绑定不进形参形状", () => {
  it("只契约 a：形参形状含 b（unknown），不是闭对象", () => {
    const r = checkOf(PARTIAL);
    expect(r.paramTypes[0]).toContain("b");
    expect(r.paramTypes[0]).toContain("unknown");
  });

  it("只契约 a：读兄弟绑定 b 折 unknown（不是 exact undefined）", () => {
    const r = checkOf(PARTIAL);
    // 返回面：{ a, b } ⇒ [number, unknown]（此前是 [number, undefined]）
    expect(r.display).toContain("unknown");
    expect(r.display).not.toContain("undefined");
  });

  it("形参 obj shape 的槽位数 ≥ 该 pattern 的绑定数（兜底自检）", () => {
    resetGeneralizeMemo();
    const g = generalizeFromAst("f", PARTIAL, {
      refine: {
        loadModule: (spec: string) => (spec.includes("tpl.nudo.js") ? TPL : undefined),
        fromFile: "/t/f.js",
        autoBind: true,
      },
    })!;
    const formal = g.formals!.find((f) => f.kind === "pattern")!;
    expect(formal.kind).toBe("pattern");
    if (formal.kind !== "pattern") return;
    const shape = g.typeParams[formal.index]!.value.shape as {
      k: string;
      slots?: Record<string, unknown>;
    };
    expect(shape.k).toBe("obj");
    expect(Object.keys(shape.slots ?? {}).length).toBeGreaterThanOrEqual(
      formal.bound.length,
    );
  });

  it("对照组：两个字段都有契约 ⇒ 形状不变（{ a: number, b: number }）", () => {
    const r = checkOf(FULL);
    expect(r.paramTypes[0]).toContain("a: number");
    expect(r.paramTypes[0]).toContain("b: number");
    expect(r.paramTypes[0]).not.toContain("unknown");
  });
});
