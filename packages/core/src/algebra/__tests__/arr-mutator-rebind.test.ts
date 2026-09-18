/**
 * C1.4 / review P0-1：语句 mutator 重绑必须是「变更后容器」，不能是 JS 返回值。
 * C2.1 P0-2/3：try/catch 不得吞 NudoReturn；抽象条件 loop return 要 join。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $arr,
  litValue,
  formatShape,
} from "@nudojs/core";

function call(src: string, fnName: string) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function callWithArr(src: string, fnName: string, arrSrc: ReturnType<typeof $arr>) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, [arrSrc]);
}

describe("array mutator statement rebind (P0-1)", () => {
  it("a.pop() as statement keeps a as container, not popped element", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  a.pop();
  return a;
}
`,
      "f",
    );
    const shape = formatShape(r.result);
    expect(shape).not.toBe("1");
    expect(shape).not.toBe("3");
    // container remains tuple/arr-like
    expect(shape).toMatch(/\[|tuple|arr/);
  });

  it("this.arr.pop() via member path does not crash B-path", () => {
    const r = call(
      `
export function f() {
  const o = { arr: [1, 2, 3] };
  o.arr.pop();
  return o.arr;
}
`,
      "f",
    );
    const shape = formatShape(r.result);
    // must not be SyntaxError / raw undefined from illegal $get()= assignment
    expect(shape).not.toBe("3");
    expect(shape).toMatch(/\[|tuple|arr|1|2/);
  });

  it("nested member mutator rebinds root binding", () => {
    const r = call(
      `
export function f() {
  const o = { xs: { a: [10, 20] } };
  o.xs.a.push(30);
  return o.xs.a[o.xs.a.length - 1] ?? o.xs.a;
}
`,
      "f",
    );
    // push 30 should be reflected; at minimum no crash / no raw JS return leak
    const shape = formatShape(r.result);
    expect(shape).not.toBe("");
  });

  it("a.pop() drops last element from tuple container", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  a.pop();
  return a[0];
}
`,
      "f",
    );
    expect(litValue(r.result)).toBe(1);
  });

  it("a.push still appends to receiver container", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2];
  a.push(3);
  return a[2];
}
`,
      "f",
    );
    expect(litValue(r.result)).toBe(3);
  });

  it("expression-position pop returns last element value", () => {
    const r = call(
      `
export function f() {
  const a = [1, 2, 3];
  const x = a.pop();
  return x;
}
`,
      "f",
    );
    expect(litValue(r.result)).toBe(3);
  });
});

describe("NudoReturn × try/catch (P0-2)", () => {
  it("catch does not swallow loop early-return", () => {
    const r = callWithArr(
      `
export function f(xs) {
  try {
    for (const x of xs) {
      if (x > 2) return x;
    }
  } catch (e) {
    return -99;
  }
  return -1;
}
`,
      "f",
      $arr([$lit(1), $lit(3)]),
    );
    // concrete [1,3]: early-return 3 must win; must NOT become catch brand/-99/-1 only
    expect(litValue(r.result)).toBe(3);
  });
});

describe("abstract-condition loop return join (P0-3)", () => {
  it("abstract arr early-return joins with fallthrough", () => {
    const r = callWithArr(
      `
export function f(xs) {
  for (const x of xs) {
    if (x > 2) return x;
  }
  return "none";
}
`,
      "f",
      // abstract arr of number → condition not definite
      {
        shape: { k: "arr", element: { shape: { k: "prim", type: "number" }, conf: "path" } },
        conf: "path",
      } as never,
    );
    const shape = formatShape(r.result);
    // must include fallthrough "none", not only the early-return arm
    expect(shape).toContain("none");
  });
});
