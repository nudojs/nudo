/**
 * absToTSType 不得产出非法 TS：NaN/Infinity 不是类型名。
 * 回归背景：`String(NaN)==="NaN"`、`String(Infinity)==="Infinity"`，
 * entryOnly 返回位与 HOF 返回位不经 widenTopLevelAbs，直接吐进
 * `export declare function f(...): NaN;` —— tsc 报错。
 * 同类：模板固定段含 ` / \ / ${ 时未转义，类型字面量语法被截断。
 */
import { describe, it, expect } from "vitest";
import { abs, lit, numLit, strLit, pTrue } from "@nudojs/core";
import { absToTSType } from "@nudojs/service/emit/dts-generator";

function nanLit() {
  return abs({ k: "prim", type: "number" }, lit(NaN), undefined, "exact");
}
function infLit() {
  return abs({ k: "prim", type: "number" }, lit(Infinity), undefined, "exact");
}
function ninfLit() {
  return abs({ k: "prim", type: "number" }, lit(-Infinity), undefined, "exact");
}

describe("absToTSType emits valid TS", () => {
  it("NaN projects to number, not the type name NaN", () => {
    expect(absToTSType(nanLit())).toBe("number");
    expect(absToTSType(nanLit())).not.toBe("NaN");
  });

  it("Infinity / -Infinity project to number", () => {
    expect(absToTSType(infLit())).toBe("number");
    expect(absToTSType(ninfLit())).toBe("number");
    expect(absToTSType(infLit())).not.toBe("Infinity");
  });

  it("finite numeric literals still project as literals", () => {
    expect(absToTSType(numLit(42))).toBe("42");
    expect(absToTSType(numLit(-3))).toBe("-3");
    expect(absToTSType(numLit(1.5))).toBe("1.5");
    expect(absToTSType(numLit(0))).toBe("0");
  });

  it("string / boolean / null / undefined lits stay faithful", () => {
    expect(absToTSType(strLit("hi"))).toBe('"hi"');
    expect(absToTSType(abs({ k: "prim", type: "boolean" }, lit(true), undefined, "exact"))).toBe("true");
    expect(absToTSType(abs({ k: "unknown" }, lit(null), undefined, "exact"))).toBe("null");
    expect(absToTSType(abs({ k: "unknown" }, lit(undefined), undefined, "exact"))).toBe("undefined");
  });

  it("prim number without lit is number (regression)", () => {
    expect(absToTSType(abs({ k: "prim", type: "number" }, undefined, undefined, "path"))).toBe("number");
  });
});
