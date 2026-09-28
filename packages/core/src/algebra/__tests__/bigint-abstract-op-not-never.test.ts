/**
 * bigint ⊗ 抽象操作数（any/unknown/obj/string prim）不得硬抛成 never。
 *
 * 回归背景：foldBigintBinOp / foldNumericBinOp 在一侧 bigint 字面量、另一侧
 * 非 bigint prim 时一律 NudoThrow(TypeError)。但：
 *   1n + s（s: string prim）  原生 `"1…"`（ToString 拼接），引擎 TypeError/never
 *   1n + x（x: any）          x 实为 2n 时得 3n、为 "s" 时得 "1s"，引擎恒 TypeError
 *   1n & x（x: any）          x 实为 2n 时得 0n，引擎恒 TypeError
 *   2n ** x（x: any）         可能 8n / RangeError / TypeError，引擎恒 TypeError
 * 确定混型（1n+1 / 1n+true / 1n+null）仍须硬抛——见 bigint-mixed-op-throws。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  formatAbs,
  abs,
  strLit,
  numLit,
} from "@nudojs/core";

function call(src: string, fnName = "f", args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never[]);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function faceOf(r: unknown): string {
  return formatAbs(r as never).split(/\s{2,}/)[0]!;
}

const anyAbs = () => abs({ k: "any" }, undefined, undefined, "exact");

describe("bigint ⊗ abstract operand is not never", () => {
  it("1n + string prim is string concat, not TypeError", () => {
    // 原生 1n + "x" === "1x"；字面量精确折叠，抽象 string 折 string 面
    const exact = call(
      `export function f(s) { return 1n + s; }`,
      "f",
      [strLit("x")],
    );
    expect(isNever(exact.result)).toBe(false);
    expect(faceOf(exact.result)).toBe('"1x"');

    const absStr = call(
      `export function f(s) { return 1n + s; }`,
      "f",
      [abs({ k: "prim", type: "string" }, undefined, undefined, "path")],
    );
    expect(isNever(absStr.result)).toBe(false);
    expect(faceOf(absStr.result)).toBe("string");
  });

  it("string prim + 1n is string concat", () => {
    const exact = call(
      `export function f(s) { return s + 1n; }`,
      "f",
      [strLit("x")],
    );
    expect(isNever(exact.result)).toBe(false);
    expect(faceOf(exact.result)).toBe('"x1"');

    const absStr = call(
      `export function f(s) { return s + 1n; }`,
      "f",
      [abs({ k: "prim", type: "string" }, undefined, undefined, "path")],
    );
    expect(isNever(absStr.result)).toBe(false);
    expect(faceOf(absStr.result)).toBe("string");
  });

  it("1n + any is not never (may be bigint or string)", () => {
    const r = call(`export function f(x) { return 1n + x; }`, "f", [anyAbs()]);
    expect(isNever(r.result)).toBe(false);
    const face = faceOf(r.result);
    expect(face).not.toBe("never");
    // 成功面是 bigint | string（对面实为 bigint / string）
    expect(face).toContain("bigint");
    expect(face).toContain("string");
  });

  it("1n - any is not never (may be bigint)", () => {
    const r = call(`export function f(x) { return 1n - x; }`, "f", [anyAbs()]);
    expect(isNever(r.result)).toBe(false);
  });

  it("1n & any is not never (x may be 2n → 0n)", () => {
    const r = call(`export function f(x) { return 1n & x; }`, "f", [anyAbs()]);
    expect(isNever(r.result)).toBe(false);
  });

  it("2n ** any is not never (may be 8n / RangeError / TypeError)", () => {
    const r = call(`export function f(x) { return 2n ** x; }`, "f", [anyAbs()]);
    expect(isNever(r.result)).toBe(false);
  });

  it("1n + obj is not never (ToPrimitive may yield bigint)", () => {
    const r = call(`export function f(o) { return 1n + o; }`, "f", [
      abs({ k: "obj", slots: {} }, undefined, undefined, "path"),
    ]);
    expect(isNever(r.result)).toBe(false);
  });
});

describe("definite mixed bigint still hard-throws", () => {
  it("1n + 2 still TypeError (number lit)", () => {
    const r = call(`export function f() { return 1n + 2; }`);
    expect(isNever(r.result)).toBe(true);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });

  it("1n + n (n: number prim) still TypeError", () => {
    const r = call(`export function f(n) { return 1n + n; }`, "f", [numLit(2)]);
    // 传入字面量 2 —— 走确定混型硬抛
    expect(isNever(r.result)).toBe(true);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });

  it("1n >>> x is always TypeError (>>> has no bigint form)", () => {
    const r = call(`export function f(x) { return 1n >>> x; }`, "f", [anyAbs()]);
    expect(isNever(r.result)).toBe(true);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });

  it("1n - s (s: string prim) still TypeError (ToNumber then mixed)", () => {
    const r = call(`export function f(s) { return 1n - s; }`, "f", [strLit("2")]);
    expect(isNever(r.result)).toBe(true);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });

  it("+bigPrim still TypeError (unary + never accepts bigint)", () => {
    const r = call(`export function f(x) { return +x; }`, "f", [
      abs({ k: "prim", type: "bigint" }, undefined, undefined, "path"),
    ]);
    expect(isNever(r.result)).toBe(true);
    expect((r.throws as { shape?: { name?: string } })?.shape?.name).toBe("TypeError");
  });
});
