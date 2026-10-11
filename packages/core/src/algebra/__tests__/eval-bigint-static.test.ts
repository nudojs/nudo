/**
 * Bug 41：BigInt.asIntN / asUintN 的 value 实参（args[1]）过 ToBigInt
 * （与 bits 档的 ToIndex 镜像，error.ts evalBigIntStatic）。此前 value 只在
 * bigint 字面量时折叠，其余字面量与抽象臂一律保守 bigint-prim——零校验零
 * 抛错：number/symbol 字面量该抛 TypeError、非法 string/对象字面量该抛
 * SyntaxError 全部漏掉，L2 gate 对 `asIntN(1, x)` 静默。
 *
 * node 实测 ground truth：
 *   asIntN(1,1)→TypeError；asIntN(1,Symbol())→TypeError；
 *   asIntN(1,'x')→SyntaxError；asIntN(1,{})→SyntaxError；
 *   asIntN(1,'1')→-1n；asIntN(1,true)→-1n；asUintN(1,true)→1n；
 *   asIntN(1,1n)→-1n（既有折叠保持）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, checkSource, pTrue } from "@nudojs/core";
import { abs } from "../abs.ts";
import { runWithMayThrowSession, setMayThrowCollector, type MayThrowEffect } from "../exec/may-throw.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsName(t: unknown): string | undefined {
  const a = t as { shape?: { k?: string; name?: string } };
  return a?.shape?.k === "brand" ? a.shape.name : undefined;
}

/** 抽象实参 / may 面：收集 may-throw 效果 kind（入口整抛经 throws 面表达） */
function evalMay(src: string, args: unknown[], fnName = "f") {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return {
    result: result.result,
    throws: result.throws,
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

function check(src: string) {
  return checkSource("/t/eval-bigint-static.js", withStdImport(src), pTrue, stdOpts);
}

function l2Of(r: ReturnType<typeof check>, fn?: string) {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn));
}

const primNum = () => abs({ k: "prim", type: "number" }, undefined, undefined, "path");
const primStr = () => abs({ k: "prim", type: "string" }, undefined, undefined, "path");

describe("Bug 41: value 字面量档过 ToBigInt（node ground truth）", () => {
  it("number / symbol 字面量 → definite TypeError（asIntN 与 asUintN 同面）", () => {
    for (const src of [
      `export function f() { return BigInt.asIntN(1, 1); }`,
      `export function f() { return BigInt.asUintN(1, 1); }`,
      `export function f() { return BigInt.asIntN(1, Symbol()); }`,
      `export function f() { return BigInt.asUintN(1, Symbol()); }`,
      `export function f() { return BigInt.asIntN(1, null); }`,
      `export function f() { return BigInt.asIntN(1, undefined); }`,
      `export function f() { return BigInt.asIntN(1); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsName(r.throws), src).toBe("TypeError");
    }
  });

  it("非法 string / 对象字面量 → definite SyntaxError", () => {
    for (const src of [
      `export function f() { return BigInt.asIntN(1, 'x'); }`,
      `export function f() { return BigInt.asUintN(1, 'x'); }`,
      `export function f() { return BigInt.asIntN(1, '1e3'); }`,
      `export function f() { return BigInt.asIntN(1, {}); }`,
      `export function f() { return BigInt.asUintN(1, {}); }`,
      `export function f() { return BigInt.asIntN(1, { a: 1 }); }`,
    ]) {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsName(r.throws), src).toBe("SyntaxError");
    }
  });

  it("合法 string / boolean 字面量 → StringToBigInt / ToBigInt 折叠（与原生一致）", () => {
    expect(litValue(call(`export function f() { return BigInt.asIntN(1, '1'); }`).result)).toEqual({ ok: true, value: -1n });
    expect(litValue(call(`export function f() { return BigInt.asUintN(1, '1'); }`).result)).toEqual({ ok: true, value: 1n });
    // StringToBigInt 语法面：空白裁剪 + 0x 前缀（宿主 BigInt 同口径）
    expect(litValue(call(`export function f() { return BigInt.asIntN(16, ' 0x10 '); }`).result)).toEqual({ ok: true, value: 16n });
    // boolean → 1n/0n 后 wrap：asIntN(1,true)→-1n、asUintN(1,true)→1n
    expect(litValue(call(`export function f() { return BigInt.asIntN(1, true); }`).result)).toEqual({ ok: true, value: -1n });
    expect(litValue(call(`export function f() { return BigInt.asUintN(1, true); }`).result)).toEqual({ ok: true, value: 1n });
    expect(litValue(call(`export function f() { return BigInt.asIntN(1, false); }`).result)).toEqual({ ok: true, value: 0n });
    expect(litValue(call(`export function f() { return BigInt.asIntN(8, true); }`).result)).toEqual({ ok: true, value: 1n });
  });

  it("bigint 字面量折叠保持（回归控制组）", () => {
    expect(litValue(call(`export function f() { return BigInt.asIntN(1, 1n); }`).result)).toEqual({ ok: true, value: -1n });
    expect(litValue(call(`export function f() { return BigInt.asUintN(8, 255n); }`).result)).toEqual({ ok: true, value: 255n });
    expect(litValue(call(`export function f() { return BigInt.asIntN("8", 255n); }`).result)).toEqual({ ok: true, value: -1n });
  });

  it("确定抛可被 catch 捕获（不再假精确 no-throw）", () => {
    expect(
      litValue(call(`export function f() { try { return BigInt.asIntN(1, 1); } catch (e) { return 'caught'; } return 'missed'; }`).result),
    ).toEqual({ ok: true, value: "caught" });
    expect(
      litValue(call(`export function f() { try { return BigInt.asIntN(1, 'x'); } catch (e) { return 'caught'; } return 'missed'; }`).result),
    ).toEqual({ ok: true, value: "caught" });
  });
});

describe("Bug 41: value 抽象档按 shape 分档", () => {
  const SRC = `export function f(v) { return BigInt.asIntN(8, v); }`;

  it("抽象 symbol prim → definite TypeError", () => {
    const r = evalMay(SRC, [abs({ k: "prim", type: "symbol" }, undefined, undefined, "path")]);
    expect(isNever(r.result)).toBe(true);
    expect(throwsName(r.throws)).toBe("TypeError");
  });

  it("抽象 number prim → may TypeError（不记 SyntaxError），值域保守 bigint", () => {
    const r = evalMay(SRC, [primNum()]);
    expect(isNever(r.result)).toBe(false);
    expect(r.effects).toEqual(["TypeError"]);
    expect((r.result as { shape?: { k?: string; type?: string } }).shape).toMatchObject({ k: "prim", type: "bigint" });
  });

  it("抽象 string prim → may SyntaxError（不记 TypeError）", () => {
    const r = evalMay(SRC, [primStr()]);
    expect(isNever(r.result)).toBe(false);
    expect(r.effects).toEqual(["SyntaxError"]);
  });

  it("any / 带 valueOf 的对象 → may TypeError + may SyntaxError", () => {
    const anyR = evalMay(SRC, [abs({ k: "any" }, undefined, undefined, "path")]);
    expect(anyR.effects.slice().sort()).toEqual(["SyntaxError", "TypeError"]);
    // {valueOf(){return 7n}} 可能折成合法 bigint，也可能抛——保守双记
    const objR = evalMay(`export function f() { return BigInt.asIntN(1, { valueOf() { return 7n; } }); }`, []);
    expect(objR.effects.slice().sort()).toEqual(["SyntaxError", "TypeError"]);
    expect(isNever(objR.result)).toBe(false);
  });

  it("bigint / boolean prim 全定：零效果（不过度记录）", () => {
    for (const arg of [
      abs({ k: "prim", type: "bigint" }, undefined, undefined, "path"),
      abs({ k: "prim", type: "boolean" }, undefined, undefined, "path"),
    ]) {
      const r = evalMay(SRC, [arg]);
      expect(r.effects, `${(arg.shape as { type?: string }).type}`).toEqual([]);
      expect(isNever(r.result)).toBe(false);
    }
  });

  it("bits 档不受影响：抽象 bits + bigint 字面量 value → may TypeError+RangeError，零 SyntaxError", () => {
    const r = evalMay(`export function f(x) { return BigInt.asIntN(x, 1n); }`, [
      abs({ k: "any" }, undefined, undefined, "path"),
    ]);
    expect(r.effects.slice().sort()).toEqual(["RangeError", "TypeError"]);
  });
});

describe("Bug 41: L2 gate 记 value 面可能抛（checkSource）", () => {
  it("无约束 x：asIntN(1, x) 报 entry-may-throw（此前静默）", () => {
    const r = check(`export function f(x) { return BigInt.asIntN(1, x); }`);
    const l2 = l2Of(r, "f");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2[0]!.message).toContain("TypeError");
    expect(l2[0]!.message).toContain("SyntaxError");
  });

  it("契约 number 形参：只记 TypeError（不记 SyntaxError）", () => {
    const r = check(`/**
 * @nudo:contract x num
 */
export function f(x) { return BigInt.asIntN(1, x); }`);
    const l2 = l2Of(r, "f");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2[0]!.message).toContain("TypeError");
    expect(l2[0]!.message).not.toContain("SyntaxError");
  });

  it("契约 string 形参：只记 SyntaxError（不记 TypeError）", () => {
    const r = check(`/**
 * @nudo:contract x nonEmpty
 */
export function f(x) { return BigInt.asIntN(1, x); }`);
    const l2 = l2Of(r, "f");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2[0]!.message).toContain("SyntaxError");
    expect(l2[0]!.message).not.toContain("TypeError");
  });

  it("控制组：字面量合法调用零 L2；字面量违例调用经 entry 抛面报 TypeError", () => {
    const ok = check(`export function g() { return BigInt.asIntN(8, 1n); }`);
    expect(l2Of(ok, "g")).toEqual([]);
    const bad = check(`export function h() { return BigInt.asIntN(1, 1); }`);
    const l2 = l2Of(bad, "h");
    expect(l2.length).toBeGreaterThan(0);
    expect(l2[0]!.message).toContain("TypeError");
  });
});
