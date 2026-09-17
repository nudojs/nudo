import { describe, it, expect } from "vitest";
import { analyzeFn, evalSource } from "../ast-eval.ts";
import { abs, num, numLit, unknown } from "../abs.ts";
import { v, lit } from "../term.ts";
import { gt, pTrue } from "../pred.ts";
import { formatShape } from "../format.ts";

function show(a: ReturnType<typeof analyzeFn>): string {
  return formatShape(a);
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

  it("Math and global builtins on Abs", () => {
    expect(show(analyzeFn(`function f(){ return Math.floor(3.7); }`, "f", []))).toBe("3");
    expect(show(analyzeFn(`function f(){ return Math.max(1, 5); }`, "f", []))).toBe("5");
    expect(show(analyzeFn(`function f(){ return Array.isArray([]); }`, "f", []))).toBe("true");
    expect(show(analyzeFn(`function f(){ return parseInt("42"); }`, "f", []))).toBe("42");
    expect(show(analyzeFn(`function f(){ return Number.isInteger(3); }`, "f", []))).toBe("true");
  });

  it("parseInt honors hex/octal/binary prefixes (no forced radix 10)", () => {
    expect(show(analyzeFn(`function f(){ return parseInt("0x10"); }`, "f", []))).toBe("16");
    expect(show(analyzeFn(`function f(){ return Number.parseInt("0xff"); }`, "f", []))).toBe("255");
  });

  it("Array.isArray on any/union is unknown boolean, not a definitive false", () => {
    // any：可能是数组，不能下 false 结论（否则 if (Array.isArray(x)) 剪掉真分支）
    const anyArg = abs({ k: "any" }, v("x"), undefined, "path");
    const r1 = analyzeFn(`function f(x){ return Array.isArray(x); }`, "f", [anyArg]);
    expect(r1.shape).toEqual({ k: "prim", type: "boolean" });
    expect(r1.term).toBeUndefined();

    // union：number[] | string —— 可能命中数组成员
    const sumArg = abs(
      {
        k: "sum",
        members: [
          abs({ k: "arr", element: num() }, undefined, undefined, "path"),
          abs({ k: "prim", type: "string" }, undefined, undefined, "path"),
        ],
      },
      undefined,
      undefined,
      "path",
    );
    const r2 = analyzeFn(`function f(x){ return Array.isArray(x); }`, "f", [sumArg]);
    expect(r2.shape).toEqual({ k: "prim", type: "boolean" });
    expect(r2.term).toBeUndefined();
  });

  it("Object.keys of object shape", () => {
    const src = `function f(){ return Object.keys({ a: 1, b: "x" }); }`;
    const r = analyzeFn(src, "f", []);
    expect(r.shape.k === "tuple" || r.shape.k === "arr").toBe(true);
  });

  it("Promise.resolve and then", () => {
    const src = `
      function f() {
        return Promise.resolve(1).then((x) => x + 1);
      }
    `;
    const r = analyzeFn(src, "f", []);
    expect(r.shape.k).toBe("eff");
  });

  it("Date.now and RegExp.test", () => {
    const n = analyzeFn(`function f(){ return Date.now(); }`, "f", []);
    expect(n.shape.k === "prim" && (n.shape as { type: string }).type === "number").toBe(true);
    const t = analyzeFn(`function f(){ return /a/.test("a"); }`, "f", []);
    // 字面正则：.test 可能走 member 路径；至少 boolean 或 unknown
    expect(t.shape.k === "prim" || t.shape.k === "unknown").toBe(true);
  });

  it("evalProgramAbs executes top-level", async () => {
    const { evalProgramAbs } = await import("../ast-eval.ts");
    const { env, last } = evalProgramAbs(`
      const x = 1 + 2;
      function inc(n) { return n + 1; }
    `);
    expect(env.vars.get("x")).toBeDefined();
    expect(env.fns.has("inc")).toBe(true);
  });
});
