/**
 * BigInt 混合 / 非法运算必须抛 TypeError·RangeError，不得折 unknown。
 *
 * 回归背景：foldBigintBinOp / foldNumericBinOp / toNumberAbs 注释已写明
 * 「原生抛 TypeError → unknown」，但 unknown 不携带 throws——L2 把
 * `1n + 1` 判成 entry-may-throw=never，catch 分支不可达（假精确）：
 *   1n + 1     原生 TypeError，引擎 unknown + throws=never
 *   1n | 1     同上
 *   1n >>> 1n  原生 TypeError（bigint 无 >>>），引擎 unknown
 *   2n ** -1n  原生 RangeError，引擎 unknown
 *   +1n        原生 TypeError，引擎 unknown
 *
 * 同类排查：arithmetic.add/sub/mul/div/mod 的 foldBigintBinOp、
 * surface.foldNumericBinOp（位运算/移位/幂）、surface.toNumberAbs（一元 +）。
 * 关系比较（< <= > >=）允许混合 bigint⊗number，不在本文件范围。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function throwsName(t: unknown): string | undefined {
  const a = t as { shape?: { k?: string; name?: string } };
  return a?.shape?.k === "brand" ? a.shape.name : undefined;
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

describe("mixed bigint ⊗ number arithmetic throws TypeError", () => {
  const mixed = [
    `export function f() { return 1n + 1; }`,
    `export function f() { return 1 + 1n; }`,
    `export function f() { return 1n - 1; }`,
    `export function f() { return 1n * 2; }`,
    `export function f() { return 1n / 1; }`,
    `export function f() { return 1n % 1; }`,
    `export function f() { return 1n | 1; }`,
    `export function f() { return 1n & 1; }`,
    `export function f() { return 1n ^ 1; }`,
    `export function f() { return 1n << 1; }`,
    `export function f() { return 1n >> 1; }`,
    `export function f() { return 1n >>> 1; }`,
    `export function f() { return 1n + true; }`,
    `export function f() { return 1n + null; }`,
    `export function f() { return 1n + undefined; }`,
    `export function f() { return 2n ** 2; }`,
    `export function f() { return 2 ** 1n; }`,
    `export function f() { return 2n ** -1; }`,
  ];
  for (const src of mixed) {
    it(src, () => {
      const r = call(src);
      expect(isNever(r.result), src).toBe(true);
      expect(throwsName(r.throws), src).toBe("TypeError");
    });
  }
});

describe("invalid bigint ops throw (no silent unknown)", () => {
  it("1n >>> 1n has no unsigned-shift overload → TypeError", () => {
    const r = call(`export function f() { return 1n >>> 1n; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsName(r.throws)).toBe("TypeError");
  });

  it("2n ** -1n negative exponent → RangeError", () => {
    const r = call(`export function f() { return 2n ** -1n; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsName(r.throws)).toBe("RangeError");
  });

  it("+1n unary plus → TypeError", () => {
    const r = call(`export function f() { return +1n; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsName(r.throws)).toBe("TypeError");
  });

  it("mixed ops are catchable and leave the catch result concrete", () => {
    expect(
      litValue(
        call(
          `export function f() { try { 1n + 1; } catch(e) { return 'caught'; } return 'missed'; }`,
        ).result,
      ),
    ).toEqual({ ok: true, value: "caught" });
  });

  it("same-type bigint ops and string concat still fold (regression guard)", () => {
    expect(litValue(call(`export function f() { return 1n + 1n; }`).result)).toEqual({ ok: true, value: 2n });
    expect(litValue(call(`export function f() { return 2n * 3n; }`).result)).toEqual({ ok: true, value: 6n });
    expect(litValue(call(`export function f() { return 1n | 2n; }`).result)).toEqual({ ok: true, value: 3n });
    expect(litValue(call(`export function f() { return 1n < 2; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return 1n == 1; }`).result)).toEqual({ ok: true, value: true });
    expect(litValue(call(`export function f() { return -1n; }`).result)).toEqual({ ok: true, value: -1n });
    expect(litValue(call(`export function f() { return ~1n; }`).result)).toEqual({ ok: true, value: -2n });
    // + 的 string 臂可 ToString(bigint)：不是混型 TypeError
    expect(litValue(call(`export function f() { return 'a' + 1n; }`).result)).toEqual({ ok: true, value: "a1" });
    expect(litValue(call(`export function f() { return 10n + ''; }`).result)).toEqual({ ok: true, value: "10" });
    expect(litValue(call(`export function f() { return '' + 10n; }`).result)).toEqual({ ok: true, value: "10" });
  });
});
