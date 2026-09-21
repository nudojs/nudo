/**
 * Number 实例方法 toString/toFixed/toExponential/toPrecision/valueOf：
 * 此前 B 路径与 ast-eval 均未建模——合法实参不折叠（(5).toFixed(2) 折
 * unknown，精度缺口）；非法实参该抛 RangeError 却折 unknown + throws=never
 * （check L2 漏报 entry-may-throw，catch 分支被判不可达）。
 * 修复：number prim 字面量上按原生折叠（radix/精度窗口校验），非法参数
 * 硬抛 NudoThrow(RangeError)——B 路径经 $catchVal 吸收、ast-eval 在
 * 调用点吸收为 EvalResult{threw}。抽象/符号实参保守 strPrim。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";
import { analyzeFn } from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

describe("B-path number instance method folding", () => {
  it("toString folds base 10 and radix", () => {
    expect(litValue(call(`export function f() { return (5).toString(); }`).result)).toBe("5");
    expect(litValue(call(`export function f() { return (5).toString(2); }`).result)).toBe("101");
    expect(litValue(call(`export function f() { return (255).toString(16); }`).result)).toBe("ff");
    expect(litValue(call(`export function f() { return (0.5).toString(); }`).result)).toBe("0.5");
    expect(litValue(call(`export function f() { return (-5).toString(); }`).result)).toBe("-5");
    expect(litValue(call(`export function f() { return (1e21).toString(); }`).result)).toBe("1e+21");
    expect(litValue(call(`export function f() { return NaN.toString(); }`).result)).toBe("NaN");
    expect(litValue(call(`export function f() { return Infinity.toString(); }`).result)).toBe("Infinity");
  });

  it("toFixed folds", () => {
    expect(litValue(call(`export function f() { return (5).toFixed(2); }`).result)).toBe("5.00");
    expect(litValue(call(`export function f() { return (5).toFixed(); }`).result)).toBe("5");
    expect(litValue(call(`export function f() { return (5.5).toFixed(0); }`).result)).toBe("6");
    expect(litValue(call(`export function f() { return (1.005).toFixed(2); }`).result)).toBe("1.00");
  });

  it("toPrecision folds", () => {
    expect(litValue(call(`export function f() { return (5).toPrecision(2); }`).result)).toBe("5.0");
    expect(litValue(call(`export function f() { return (123).toPrecision(2); }`).result)).toBe("1.2e+2");
    expect(litValue(call(`export function f() { return (123.456).toPrecision(4); }`).result)).toBe("123.5");
    expect(litValue(call(`export function f() { return (5).toPrecision(); }`).result)).toBe("5");
  });

  it("toExponential folds", () => {
    expect(litValue(call(`export function f() { return (5).toExponential(); }`).result)).toBe("5e+0");
    expect(litValue(call(`export function f() { return (5).toExponential(2); }`).result)).toBe("5.00e+0");
    expect(litValue(call(`export function f() { return (123456).toExponential(2); }`).result)).toBe("1.23e+5");
  });

  it("valueOf returns the number", () => {
    expect(litValue(call(`export function f() { return (5).valueOf(); }`).result)).toBe(5);
  });

  it("abstract args stay abstract", () => {
    const r = call(`export function f(x) { return x.toFixed(2); }`);
    expect(litValue(r.result)).toBeUndefined();
  });
});

describe("B-path number instance method invalid args throw RangeError", () => {
  it("toString radix outside 2..36", () => {
    for (const radix of ["1", "37", "-1", "0"]) {
      const r = call(`export function f() { return (5).toString(${radix}); }`);
      expect(isNever(r.result), `radix ${radix}`).toBe(true);
      expect(throwsError(r.throws, "RangeError"), `radix ${radix}`).toBe(true);
    }
  });

  it("toString fractional radix truncates via ToIntegerOrInfinity", () => {
    expect(litValue(call(`export function f() { return (5).toString(2.5); }`).result)).toBe("101");
  });

  it("toFixed digits out of 0..100", () => {
    for (const d of ["-1", "101"]) {
      const r = call(`export function f() { return (5).toFixed(${d}); }`);
      expect(isNever(r.result), `digits ${d}`).toBe(true);
      expect(throwsError(r.throws, "RangeError"), `digits ${d}`).toBe(true);
    }
  });

  it("toPrecision precision out of 1..100", () => {
    for (const p of ["0", "101", "-1"]) {
      const r = call(`export function f() { return (5).toPrecision(${p}); }`);
      expect(isNever(r.result), `precision ${p}`).toBe(true);
      expect(throwsError(r.throws, "RangeError"), `precision ${p}`).toBe(true);
    }
  });

  it("toExponential fractionDigits out of 0..100", () => {
    for (const p of ["-1", "101"]) {
      const r = call(`export function f() { return (5).toExponential(${p}); }`);
      expect(isNever(r.result), `digits ${p}`).toBe(true);
      expect(throwsError(r.throws, "RangeError"), `digits ${p}`).toBe(true);
    }
  });

  it("caught by try/catch", () => {
    for (const src of [
      `export function f() { try { (5).toFixed(-1); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { (5).toString(37); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { (5).toPrecision(0); } catch(e) { return 'caught'; } return 'missed'; }`,
      `export function f() { try { (5).toExponential(101); } catch(e) { return 'caught'; } return 'missed'; }`,
    ]) {
      expect(litValue(call(src).result), src).toBe("caught");
    }
  });

  it("symbol arg stays abstract (native THROW TypeError)", () => {
    const r = call(`export function f() { return (5).toString(Symbol()); }`);
    expect(litValue(r.result)).toBeUndefined();
  });
});

describe("ast-eval number instance methods", () => {
  it("folds toFixed on literal receiver", () => {
    expect(litValue(analyzeFn(`function f() { return (5).toFixed(2); }`, "f", []))).toBe("5.00");
    expect(litValue(analyzeFn(`function f() { return (255).toString(16); }`, "f", []))).toBe("ff");
    expect(litValue(analyzeFn(`function f() { return (5).toExponential(2); }`, "f", []))).toBe("5.00e+0");
  });

  it("invalid digits interrupt with never (RangeError)", () => {
    expect(isNever(analyzeFn(`function f() { return (5).toFixed(-1); }`, "f", []))).toBe(true);
    expect(isNever(analyzeFn(`function f() { return (5).toPrecision(101); }`, "f", []))).toBe(true);
  });

  it("invalid digits are caught by try/catch", () => {
    expect(
      litValue(
        analyzeFn(
          `function f() { try { (5).toFixed(-1); } catch(e) { return 'caught'; } return 'missed'; }`,
          "f",
          [],
        ),
      ),
    ).toBe("caught");
  });
});
