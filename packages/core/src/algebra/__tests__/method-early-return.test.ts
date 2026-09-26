/**
 * 方法体早退 if 必须与 FunctionDeclaration 同轨（transpileFnBodyStmts 提升）。
 * 回归：逐语句 map 会把 `if (c) return X; return Y` 的早退值丢进 $fork thunk，
 * 恒折 fall-through（假精确）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, $lit, transpile } from "@nudojs/core";

function call(src: string, name: string, args: unknown[] = []) {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, name, args as never[]);
}

const n0 = () => $lit(0);
const n5 = () => $lit(5);
const nNeg = () => $lit(-1);

describe("method early-return if (object / class / fn-val property)", () => {
  it("object method: if (n<=0) return 0; return 1", () => {
    const src = `export function f(n) {
  const o = { d(n) { if (n <= 0) { return 0; } return 1; } };
  return o.d(n);
}`;
    expect(litValue(call(src, "f", [n0()]).result)).toBe(0);
    expect(litValue(call(src, "f", [nNeg()]).result)).toBe(0);
    expect(litValue(call(src, "f", [n5()]).result)).toBe(1);
  });

  it("class instance method: early return", () => {
    const src = `export class C {
  d(n) { if (n <= 0) { return 0; } return 1; }
}
export function f(n) { return new C().d(n); }`;
    expect(litValue(call(src, "f", [n0()]).result)).toBe(0);
    expect(litValue(call(src, "f", [n5()]).result)).toBe(1);
  });

  it("class static method: early return", () => {
    const src = `export class C {
  static d(n) { if (n <= 0) { return 0; } return 1; }
}
export function f(n) { return C.d(n); }`;
    expect(litValue(call(src, "f", [n0()]).result)).toBe(0);
    expect(litValue(call(src, "f", [n5()]).result)).toBe(1);
  });

  it("property FunctionExpression: early return", () => {
    const src = `export function f(n) {
  const o = { d: function (n) { if (n <= 0) { return 0; } return 1; } };
  return o.d(n);
}`;
    expect(litValue(call(src, "f", [n0()]).result)).toBe(0);
    expect(litValue(call(src, "f", [n5()]).result)).toBe(1);
  });

  it("chained guards (compareVersions pattern)", () => {
    const src = `export function f(a, b) {
  const o = {
    cmp(a, b) {
      if (a > b) { return 1; }
      if (a < b) { return -1; }
      return 0;
    }
  };
  return o.cmp(a, b);
}`;
    expect(litValue(call(src, "f", [$lit(2), $lit(1)]).result)).toBe(1);
    expect(litValue(call(src, "f", [$lit(1), $lit(2)]).result)).toBe(-1);
    expect(litValue(call(src, "f", [$lit(1), $lit(1)]).result)).toBe(0);
  });

  it("recursive object method with base case", () => {
    const src = `export function f(n) {
  const o = { d(n) { if (n <= 0) { return 0; } return this.d(n - 1); } };
  return o.d(n);
}`;
    expect(litValue(call(src, "f", [n0()]).result)).toBe(0);
    expect(litValue(call(src, "f", [$lit(3)]).result)).toBe(0);
  });

  it("object method transpile folds early-return into return $fork", () => {
    const src = `export function f() {
  const o = { d(n) { if (n <= 0) { return 0; } return 1; } };
  return o.d(0);
}`;
    const js = transpile(src, { source: src });
    expect(js).toMatch(/return \$fork\(/);
  });

  it("native parity on the original repro", () => {
    const src = `export function f(n) {
  const o = { d(n) { if (n <= 0) { return 0; } return 1; } };
  return o.d(n);
}`;
    const native = new Function(
      "n",
      `const o = { d(n) { if (n <= 0) { return 0; } return 1; } }; return o.d(n);`,
    ) as (n: number) => number;
    for (const v of [0, -1, 5]) {
      expect(litValue(call(src, "f", [$lit(v)]).result)).toBe(native(v));
    }
  });
});
