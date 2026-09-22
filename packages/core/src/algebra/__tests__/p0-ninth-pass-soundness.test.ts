/**
 * 第九轮 P0 回归：普通绑定隔离 / nullish / try mark / switch 贯穿 / 循环累加 / ast-eval env join
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  formatAbs,
  formatShape,
} from "@nudojs/core";

function call(src: string, fnName: string, ...litArgs: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(
    exports,
    fnName,
    litArgs.map((a) => $lit(a as never)),
  );
}

function callAbs(src: string, fnName: string, args: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never[]);
}

const absBool = { shape: { k: "prim", type: "boolean" }, conf: "path" } as never;
const absNum = { shape: { k: "prim", type: "number" }, conf: "path" } as never;

describe("P0 ordinary binding fork isolation (B-path)", () => {
  it("if/else assign then read enumerates both arms", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; } else { x = 2; } return x; }`;
    expect(litValue(call(src, "f", true).result)).toBe(1);
    expect(litValue(call(src, "f", false).result)).toBe(2);
    const r = callAbs(src, "f", [absBool]);
    expect(r.result.shape.k).toBe("sum");
    const s = formatAbs(r.result);
    expect(s).toContain("1");
    expect(s).toContain("2");
    expect(formatShape(r.result)).not.toBe("2");
    expect(formatShape(r.result)).not.toBe("1");
  });

  it("if/else side effects on x do not accumulate across arms", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = x + 1; } else { x = x + 2; } return x; }`;
    expect(litValue(call(src, "f", true).result)).toBe(1);
    expect(litValue(call(src, "f", false).result)).toBe(2);
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("3");
    expect(r.result.shape.k).toBe("sum");
  });

  it("if without else keeps fall-through binding", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; } return x; }`;
    expect(litValue(call(src, "f", false).result)).toBe(0);
    expect(litValue(call(src, "f", true).result)).toBe(1);
    const r = callAbs(src, "f", [absBool]);
    expect(r.result.shape.k).toBe("sum");
    expect(formatShape(r.result)).not.toBe("1");
  });

  it("object slot write joins both arms", () => {
    const src = `export function f(flag) { const o = { x: 0 }; if (flag) { o.x = 1; } else { o.x = 2; } return o.x; }`;
    expect(litValue(call(src, "f", true).result)).toBe(1);
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("2");
  });
});

describe("P0 nullish ?? and ??=", () => {
  it("abstract number ?? fallback stays number, not fallback exact", () => {
    const src = `export function f(a) { return a ?? "fallback"; }`;
    const r = callAbs(src, "f", [absNum]);
    expect(formatAbs(r.result)).not.toBe('"fallback"');
    expect(formatShape(r.result)).not.toBe('"fallback"');
  });

  it("abstract number ??= keeps number domain", () => {
    const src = `export function f(a) { let x = a; x ??= 42; return x; }`;
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("42");
  });

  it("concrete nullish and non-nullish still correct", () => {
    const src = `export function f(a, b) { return a ?? b; }`;
    expect(litValue(call(src, "f", null, 7).result)).toBe(7);
    expect(litValue(call(src, "f", 3, 7).result)).toBe(3);
  });
});

describe("P0 try mark nested isolation", () => {
  it("pre-try abstract throw still surfaces after nested try-return", () => {
    const src = `
export function inner(y) {
  try { return y; } finally { var z = 1; }
}
export function outer(x) {
  if (x) { throw "pre"; }
  try { inner(0); return "done"; }
  catch (e) { return "c"; }
}`;
    const r = callAbs(src, "outer", [absBool]);
    expect(formatAbs(r.throws)).toContain("pre");
  });

  it("concrete outer paths still work", () => {
    const src = `
export function inner(y) {
  try { return y; } finally { var z = 1; }
}
export function outer(x) {
  if (x) { throw "pre"; }
  try { inner(0); return "done"; }
  catch (e) { return "c"; }
}`;
    const rt = call(src, "outer", true);
    expect(formatAbs(rt.throws)).toContain("pre");
    const rf = call(src, "outer", false);
    expect(litValue(rf.result)).toBe("done");
  });
});

describe("P0 no-default switch mutator join includes fall-through", () => {
  it("abstract length is not exact mutated-only", () => {
    const src = `export function f(n) { const a=[1,2,3]; switch(n){ case 1: a.pop(); break; } return a.length; }`;
    expect(litValue(call(src, "f", 1).result)).toBe(2);
    expect(litValue(call(src, "f", 2).result)).toBe(3);
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("2");
    expect(r.result.conf).not.toBe("exact");
  });
});

describe("P0 switch non-break fall-through", () => {
  it("concrete case1 falls into case3 side effects", () => {
    const src = `export function f(n) { let x=0; switch(n){ case 1: case 2: x=1; case 3: x=x+1; break; default: x=99; } return x; }`;
    expect(litValue(call(src, "f", 1).result)).toBe(2);
    expect(litValue(call(src, "f", 2).result)).toBe(2);
    expect(litValue(call(src, "f", 3).result)).toBe(1);
    expect(litValue(call(src, "f", 4).result)).toBe(99);
  });

  it("abstract is not exact last/default only", () => {
    const src = `export function f(n) { let x=0; switch(n){ case 1: case 2: x=1; case 3: x=x+1; break; default: x=99; } return x; }`;
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("99");
  });
});

describe("P0 loop accumulator abstract not exact maxIters", () => {
  it("for-loop sum under abstract n is not exact 8", () => {
    const src = `export function f(n) { let s=0; for(let i=0;i<n;i=i+1){s=s+1;} return s; }`;
    expect(litValue(call(src, "f", 3).result)).toBe(3);
    const r = callAbs(src, "f", [absNum]);
    expect(formatShape(r.result)).not.toBe("8");
    expect(r.result.shape.k).toBe("sum");
  });
});

describe("P0 env join via export call (check path)", () => {
  it("export call if/else assign then read enumerates arms", () => {
    const r = callAbs(
      `export function f(flag) { let x = 0; if (flag) { x = 1; } else { x = 2; } return x; }`,
      "f",
      [absBool],
    ).result;
    expect(r.shape.k).toBe("sum");
    expect(formatShape(r)).not.toBe("0");
  });

  it("export call if without else keeps fall-through", () => {
    const r = callAbs(
      `export function f(flag) { let x = 0; if (flag) { x = 1; } return x; }`,
      "f",
      [absBool],
    ).result;
    expect(r.shape.k).toBe("sum");
    expect(formatShape(r)).not.toBe("1");
  });
});

describe("joinAbs dual literals is enumeration", () => {
  it("joinAbs(1,2) is sum of members", async () => {
    const { joinAbs, numLit } = await import("@nudojs/core");
    const { formatShape } = await import("@nudojs/core");
    const r = joinAbs(numLit(1), numLit(2));
    expect(r.shape.k).toBe("sum");
    expect(formatShape(r)).toContain("1");
    expect(formatShape(r)).toContain("2");
  });
});
