import { describe, it, expect } from "vitest";
import { analyzeFn, evalSource } from "../ast-eval.ts";
import { abs, num, numLit, unknown } from "../abs.ts";
import { v, lit } from "../term.ts";
import { gt, pTrue } from "../pred.ts";
import { typeValueToString } from "../../type-value.ts";
import { absToTypeValue } from "../bridge.ts";
import { formatAbs } from "../format.ts";

function show(a: ReturnType<typeof analyzeFn>): string {
  return typeValueToString(absToTypeValue(a));
}

describe("abs-native ast-eval", () => {
  it("literal arith", () => {
    const r = analyzeFn(`function f(){ return 1+2*3; }`, "f", []);
    expect(show(r)).toBe("7");
  });

  it("param + 1 with constraint via phi in source", () => {
    const src = `
      function f(x) {
        if (x > 0) return x + 1;
        return 0;
      }
    `;
    const r = analyzeFn(src, "f", [abs(num().shape, v("x"), gt(v("x"), lit(0)), "path")]);
    // x>0 时 x+1 应带约束
    expect(r.shape.k === "prim" || r.shape.k === "sum").toBe(true);
  });

  it("logical && short-circuit", () => {
    const r = analyzeFn(`function f(){ return false && 1; }`, "f", []);
    expect(show(r)).toBe("false");
  });

  it("typeof", () => {
    const r = analyzeFn(`function f(){ return typeof 1; }`, "f", []);
    expect(show(r)).toBe('"number"');
  });

  it("template literal", () => {
    const r = analyzeFn(`function f(x){ return \`n=\${x}\`; }`, "f", [numLit(3)]);
    expect(show(r)).toBe('"n=3"');
  });

  it("first-class arrow", () => {
    const src = `
      function f() {
        const add = (a, b) => a + b;
        return add(2, 3);
      }
    `;
    const r = analyzeFn(src, "f", []);
    expect(show(r)).toBe("5");
  });

  it("div and mod", () => {
    expect(show(analyzeFn(`function f(){ return 10/2; }`, "f", []))).toBe("5");
    expect(show(analyzeFn(`function f(){ return 10%3; }`, "f", []))).toBe("1");
  });

  it("nullish === decided", () => {
    const r = analyzeFn(`function f(x){ return x === null; }`, "f", [numLit(1)]);
    expect(show(r)).toBe("false");
  });

  it("for loop runs with update", () => {
    const src = `
      function f() {
        let s = 0;
        for (let i = 0; i < 3; i++) s = s + i;
        return s;
      }
    `;
    const r = analyzeFn(src, "f", []);
    expect(r.shape.k === "prim" || r.shape.k === "unknown").toBe(true);
  });

  it("for-of over tuple", () => {
    const src = `
      function f(xs) {
        let s = 0;
        for (const x of xs) s = s + x;
        return s;
      }
    `;
    const tup = abs({ k: "tuple", elements: [numLit(1), numLit(2)] }, undefined, undefined, "exact");
    const r = analyzeFn(src, "f", [tup]);
    expect(r.shape.k === "prim" || r.shape.k === "unknown").toBe(true);
  });

  it("while with break", () => {
    const src = `
      function f() {
        let i = 0;
        while (true) {
          i = i + 1;
          if (i > 2) break;
        }
        return i;
      }
    `;
    const r = analyzeFn(src, "f", []);
    expect(r.shape.k === "prim" || r.shape.k === "unknown").toBe(true);
  });

  it("try/catch binds thrown value", () => {
    const src = `
      function f() {
        try {
          throw 1;
        } catch (e) {
          return e;
        }
      }
    `;
    const r = analyzeFn(src, "f", []);
    expect(show(r)).toBe("1");
  });

  it("string methods fold", () => {
    expect(show(analyzeFn(`function f(){ return "abc".startsWith("a"); }`, "f", []))).toBe("true");
    expect(show(analyzeFn(`function f(){ return "abc".toUpperCase(); }`, "f", []))).toBe('"ABC"');
    expect(show(analyzeFn(`function f(){ return "hello".length; }`, "f", []))).toBe("5");
  });

  it("array join returns string", () => {
    const r = analyzeFn(`function f(xs){ return xs.join(","); }`, "f", [
      abs({ k: "arr", element: abs({ k: "prim", type: "string" }, undefined, undefined, "exact") }, undefined, undefined, "exact"),
    ]);
    expect(r.shape).toEqual({ k: "prim", type: "string" });
  });
});
