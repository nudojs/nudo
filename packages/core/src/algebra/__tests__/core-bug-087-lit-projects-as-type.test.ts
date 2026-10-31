/**
 * BUG-087 —— 字面量约束在**类型展示面**被渲染成侧车契约文法的 `lit(v)`（不是
 * 任何语言的类型），而同一工具的 `.d.ts` 产物面渲染成类型 `v` ⇒ 同一个参数
 * 在两个产品面上是两套「类型」，且 `check --json` 的 `paramTypes`（机器面）被
 * 污染。
 *
 * 根因：`format.ts` 的 `showLits` 分支直接输出 `lit(${formatLitValue(v)})`
 * ——契约 DSL 文本泄漏进类型展示面。
 *
 * 本钉：展示面必须输出**类型**（`3` / `"a"`），与 dts 面同源。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts } from "./nudo-constraints.ts";

function optsWithSidecar(sidecar: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec === "./file.nudo.js" ? sidecar : stdOpts.loadModule(spec),
    fromFile: "/test/file.js",
  };
}

const SRC = `export function g(a, b, c, d, e) {
  return a;
}
`;

const SIDE = `
import { fn, number, string, shape, lit } from "@nudojs/core";
export const g = fn({ a: lit(3), b: number(), c: number().gt(0), d: string(), e: shape({ p: number() }) }, number());
`;

const SLOT_SRC = `export function h(a) {
  return a;
}
`;

const SLOT_SIDE = `
import { fn, number, shape, lit } from "@nudojs/core";
export const h = fn({ a: shape({ kind: lit("a"), n: number() }) }, number());
`;

describe("BUG-087 — 字面量约束在类型展示面渲染成类型（不是契约 DSL）", () => {
  it("顶层形参：`lit(3)` ⇒ `3`（不是 `lit(3)`）", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(SIDE));
    const sig = r.signatures.find((s) => s.name === "g");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("3");
    expect(sig!.paramTypes?.join(", ")).not.toContain("lit(");
  });

  it("对象判别槽：`kind: lit(\"a\")` ⇒ `{ kind: \"a\", n: number }`", () => {
    const r = checkSource("/test/file.js", SLOT_SRC, pTrue, optsWithSidecar(SLOT_SIDE));
    const sig = r.signatures.find((s) => s.name === "h");
    expect(sig!.paramTypes?.[0]).toBe('{ kind: "a", n: number }');
  });

  it("负控制：无数值界契约的渲染不变（`number` 仍是 `number`）", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(SIDE));
    const sig = r.signatures.find((s) => s.name === "g");
    expect(sig!.paramTypes?.[1]).toBe("number");
    expect(sig!.paramTypes?.[3]).toBe("string");
  });
});
