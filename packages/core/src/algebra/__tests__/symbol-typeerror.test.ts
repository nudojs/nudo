/**
 * BUG-012：symbol 参与数值/位运算一律 TypeError（与 add / Number(sym) 同口径）。
 * 此前仅 add() 检查 isSym；sub/mul/div/mod、一元 -/+/~、位运算回落 unknown，
 * 漏报 L2 entry-may-throw。本文件钉死全部算子实例的硬抛行为。
 */
import { describe, it, expect } from "vitest";
import { numLit } from "../abs.ts";
import { add, sub, mul, div, mod } from "../arithmetic.ts";
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
});
