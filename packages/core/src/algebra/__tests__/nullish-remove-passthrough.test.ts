/**
 * $removeNullish 透传回归（PR #93 review）：
 * - 非 Abs 裸宿主值：恒等透传——调用边界（$fork 臂）经 asAbsVal 收拢，
 *   提前折 unknown 是无谓退化
 * - Abs 分支语义保持：nullish 并集剥 nullish、纯 nullish 原样、非 nullish 原样
 * - `??` / `??=` 转译 golden：`M[k] ?? 'z'` 的非 nullish 臂只取左值非 nullish 部分
 */
import { describe, it, expect } from "vitest";
import { $removeNullish } from "../exec/runtime/async.ts";
import { abs, numLit, strLit, type Abs } from "../abs.ts";
import { lit } from "../term.ts";
import { pTrue } from "../pred.ts";
import { runTranspiled, callTranspiledExportFull, formatShape } from "@nudojs/core";

const nullLit = abs({ k: "unknown" }, lit(null), pTrue, "exact");
const undefLit = abs({ k: "unknown" }, lit(undefined), pTrue, "exact");
const sumOf = (members: Abs[]): Abs => ({ shape: { k: "sum", members }, conf: "exact" });

describe("$removeNullish non-Abs passthrough", () => {
  it("returns raw host values unchanged (identity, no unknown degradation)", () => {
    expect($removeNullish(5 as never as Abs)).toBe(5);
    expect($removeNullish("s" as never as Abs)).toBe("s");
    expect($removeNullish(undefined as never as Abs)).toBeUndefined();
    expect($removeNullish(null as never as Abs)).toBeNull();
    const fn = () => 1;
    expect($removeNullish(fn as never as Abs)).toBe(fn);
    const plain = { x: 1 };
    expect($removeNullish(plain as never as Abs)).toBe(plain);
  });
});

describe("$removeNullish Abs branch semantics (unchanged)", () => {
  it("strips nullish members from a union (single kept → that member itself)", () => {
    const five = numLit(5);
    expect($removeNullish(sumOf([five, nullLit, undefLit]))).toBe(five);
  });

  it("keeps multiple non-nullish members in order (rebuilt sum)", () => {
    const five = numLit(5);
    const x = strLit("x");
    const r = $removeNullish(sumOf([five, x, nullLit]));
    expect(r.shape.k).toBe("sum");
    expect((r.shape as { members: Abs[] }).members).toEqual([five, x]);
  });

  it("all-nullish sum returned as-is", () => {
    const s = sumOf([nullLit, undefLit]);
    expect($removeNullish(s)).toBe(s);
  });

  it("non-nullish value / fully non-nullish sum returned as-is", () => {
    const five = numLit(5);
    expect($removeNullish(five)).toBe(five);
    const s = sumOf([numLit(1), numLit(2)]);
    expect($removeNullish(s)).toBe(s);
  });
});

const absStr = { shape: { k: "prim", type: "string" }, conf: "path" } as never;

function callAbs(src: string, fnName: string, args: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never[]);
}

describe("?? / ??= transpile golden (left arm keeps non-nullish domain only)", () => {
  it("M[k] ?? 'z' with abstract key → \"z\" | \"x\" (undefined arm stripped)", () => {
    const src = `const M = { a: "x" };\nexport const lookup = (k) => M[k] ?? "z";`;
    const r = callAbs(src, "lookup", [absStr]);
    expect(formatShape(r.result)).toBe(`"z" | "x"`);
  });

  it("x ??= 'd' where x carries an undefined arm → \"d\" | \"x\"", () => {
    const src = `const M = { a: "x" };\nexport function ensure(k) { let x = M[k]; x ??= "d"; return x; }`;
    const r = callAbs(src, "ensure", [absStr]);
    expect(formatShape(r.result)).toBe(`"d" | "x"`);
  });
});
