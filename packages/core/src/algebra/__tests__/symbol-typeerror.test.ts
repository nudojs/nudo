/**
 * BUG-012：symbol 参与数值/位运算一律 TypeError（与 add / Number(sym) 同口径）。
 * 此前仅 add() 检查 isSym；sub/mul/div/mod、一元 -/+/~、位运算回落 unknown，
 * 漏报 L2 entry-may-throw。本文件钉死全部算子实例的硬抛行为。
 */
import { describe, it, expect } from "vitest";
import { numLit } from "../abs.ts";
import { add, sub, mul, div, mod, cmp } from "../arithmetic.ts";
import {
  negAbs,
  toNumberAbs,
  bitnotAbs,
  bitandAbs,
  bitorAbs,
  bitxorAbs,
  shlAbs,
  shrAbs,
  ushrAbs,
  powAbs,
} from "../surface.ts";
import { makeSymbolAbs } from "../builtins/symbol.ts";
import { NudoThrow, isNudoThrow } from "../exec/nudo-throw.ts";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function expectTypeError(fn: () => unknown): void {
  let threw: unknown;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  expect(isNudoThrow(threw)).toBe(true);
  const payload = (threw as NudoThrow).absValue;
  expect(payload.shape.k).toBe("brand");
  expect((payload.shape as { name?: string }).name).toBe("TypeError");
}

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("BUG-012: symbol × numeric/bitwise ops throw TypeError", () => {
  const s = makeSymbolAbs();
  const one = numLit(1);

  it("binary arithmetic: sub/mul/div/mod (both operand positions)", () => {
    expectTypeError(() => sub(s, one));
    expectTypeError(() => sub(one, s));
    expectTypeError(() => mul(s, one));
    expectTypeError(() => mul(one, s));
    expectTypeError(() => div(s, one));
    expectTypeError(() => div(one, s));
    expectTypeError(() => mod(s, one));
    expectTypeError(() => mod(one, s));
  });

  it("add (existing baseline) still throws", () => {
    expectTypeError(() => add(s, one));
    expectTypeError(() => add(one, s));
  });

  it("unary: -s / +s / ~s", () => {
    expectTypeError(() => negAbs(s));
    expectTypeError(() => toNumberAbs(s));
    expectTypeError(() => bitnotAbs(s));
  });

  it("bitwise/shift/pow: & | ^ << >> >>> **", () => {
    expectTypeError(() => bitandAbs(s, one));
    expectTypeError(() => bitandAbs(one, s));
    expectTypeError(() => bitorAbs(s, one));
    expectTypeError(() => bitorAbs(one, s));
    expectTypeError(() => bitxorAbs(s, one));
    expectTypeError(() => bitxorAbs(one, s));
    expectTypeError(() => shlAbs(s, one));
    expectTypeError(() => shlAbs(one, s));
    expectTypeError(() => shrAbs(s, one));
    expectTypeError(() => shrAbs(one, s));
    expectTypeError(() => ushrAbs(s, one));
    expectTypeError(() => ushrAbs(one, s));
    expectTypeError(() => powAbs(s, one));
    expectTypeError(() => powAbs(one, s));
  });

  it("relational: s<1 / 1<s / s>s / s<=1 / s>=1 throw TypeError", () => {
    expectTypeError(() => cmp("lt", s, one));
    expectTypeError(() => cmp("lt", one, s));
    expectTypeError(() => cmp("gt", s, one));
    expectTypeError(() => cmp("gt", one, s));
    expectTypeError(() => cmp("le", s, one));
    expectTypeError(() => cmp("le", one, s));
    expectTypeError(() => cmp("ge", s, one));
    expectTypeError(() => cmp("ge", one, s));
  });

  it("relational: s<s / s<=s / s>s / s>=s throw TypeError", () => {
    expectTypeError(() => cmp("lt", s, s));
    expectTypeError(() => cmp("le", s, s));
    expectTypeError(() => cmp("gt", s, s));
    expectTypeError(() => cmp("ge", s, s));
  });

  it("eq/ne do NOT throw (Symbol === Symbol is legal)", () => {
    // 仅验证不抛；结果由 strictEqAbs 决定，此处不钉具体值
    expect(() => cmp("eq", s, one)).not.toThrow();
    expect(() => cmp("ne", s, one)).not.toThrow();
  });
});

describe("BUG-012: evaluator routes Symbol() ops to THROW", () => {
  const cases: string[] = [
    `Symbol() - 1`,
    `1 - Symbol()`,
    `Symbol() * 1`,
    `1 * Symbol()`,
    `Symbol() / 1`,
    `1 / Symbol()`,
    `Symbol() % 1`,
    `1 % Symbol()`,
    `-Symbol()`,
    `+Symbol()`,
    `~Symbol()`,
    `Symbol() & 1`,
    `1 & Symbol()`,
    `Symbol() | 1`,
    `Symbol() ^ 1`,
    `Symbol() << 1`,
    `Symbol() >> 1`,
    `Symbol() >>> 1`,
    `Symbol() ** 1`,
    `Symbol() < 1`,
    `1 < Symbol()`,
    `Symbol() > 1`,
    `1 > Symbol()`,
    `Symbol() <= 1`,
    `1 <= Symbol()`,
    `Symbol() >= 1`,
    `1 >= Symbol()`,
    `Symbol() < Symbol()`,
    `Symbol() <= Symbol()`,
    `Symbol() > Symbol()`,
    `Symbol() >= Symbol()`,
  ];

  for (const expr of cases) {
    it(`${expr} throws TypeError`, () => {
      const r = call(`export function f() { try { return ${expr}; } catch(e) { return 'THROW'; } }`);
      expect(litValue(r.result)).toBe("THROW");
    });
  }

  it("Symbol() + 1 still throws (baseline add)", () => {
    const r = call(`export function f() { try { return Symbol() + 1; } catch(e) { return 'THROW'; } }`);
    expect(litValue(r.result)).toBe("THROW");
  });

  it("Symbol() === Symbol() is false, not throw (eq/ne excluded)", () => {
    const r = call(`export function f() { return Symbol() === Symbol(); }`);
    expect(litValue(r.result)).toBe(false);
  });

  it("Symbol() == 1 does not throw (loose eq excluded)", () => {
    // JS Abstract Equality：Symbol vs Number 直接 false，不走 ToNumber，不抛
    const r = call(`export function f() { return Symbol() == 1; }`);
    expect(r.result.shape.k).toBe("prim");
    expect((r.result.shape as { type?: string }).type).toBe("boolean");
  });
});
