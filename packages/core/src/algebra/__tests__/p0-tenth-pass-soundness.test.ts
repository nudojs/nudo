/**
 * 第十轮 P0 回归：fork 嵌套同名隔离 / for-of 空与抽象 / check 复合赋值 /
 * do-while 双路径 / leq 字面量判别
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  formatAbs,
  formatShape,
  leqAbs,
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

describe("P0 fork isolation vs nested shadow names (B-path)", () => {
  it("outer let write + nested function param same name still joins", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; function g(x) { return x; } } return x; }`;
    expect(litValue(call(src, "f", true).result)).toBe(1);
    expect(litValue(call(src, "f", false).result)).toBe(0);
    const r = callAbs(src, "f", [absBool]);
    const shown = formatAbs(r.result);
    expect(shown).toContain("1");
    expect(shown).toContain("0");
    expect(formatShape(r.result)).not.toBe("1");
    expect(formatShape(r.result)).not.toBe("0");
  });

  it("arrow param same name as outer write does not drop isolation", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; const h = (x) => x; } return x; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("1");
    expect(formatShape(r.result)).not.toBe("0");
  });

  it("forEach callback param same name keeps outer join", () => {
    const src = `export function f(flag) { let x = 0; if (flag) { x = 1; [1,2].forEach((x) => {}); } return x; }`;
    const r = callAbs(src, "f", [absBool]);
    expect(formatShape(r.result)).not.toBe("1");
  });
});

describe("P0 for-of empty / abstract accumulators", () => {
  it("empty tuple for-of does not expand to maxIters", () => {
    const src = `export function f() { let s = 0; for (const x of []) { s = s + 1; } return s; }`;
    expect(litValue(call(src, "f").result)).toBe(0);
  });

  it("abstract iterable joins 0..n exits", () => {
    const src = `export function f(a) { let s = 0; for (const x of a) { s = s + 1; } return s; }`;
    const r = callAbs(src, "f", [absNum]);
    const shown = formatAbs(r.result);
    expect(shown).toContain("0");
    expect(formatShape(r.result)).not.toBe("8");
    expect(formatShape(r.result)).not.toBe("1");
  });

  it("concrete tuple for-of still counts exactly", () => {
    const src = `export function f() { let s = 0; for (const x of [1,2]) { s = s + 1; } return s; }`;
    expect(litValue(call(src, "f").result)).toBe(2);
  });
});

describe("P0 check-path compound / logical assignment", () => {
  it("export call += concrete", () => {
    const r = callAbs(`export function f(a) { let x = 1; x += a; return x; }`, "f", [$lit(5)]).result;
    expect(formatAbs(r)).toBe("6  #exact");
  });

  it("export call += abstract number", () => {
    const r = callAbs(
      `export function f(a) { let x = 1; x += a; return x; }`,
      "f",
      [absNum],
    ).result;
    expect(formatAbs(r)).not.toBe("1  #exact");
  });

  it("export call ??= writes RHS when left null", () => {
    const r = callAbs(`export function f(a) { let x = null; x ??= a; return x; }`, "f", [$lit(7)]).result;
    expect(litValue(r)).toBe(7);
  });

  it("export call ?? keeps non-nullish domain", () => {
    const r = callAbs(`export function f(a) { return a ?? "fb"; }`, "f", [absNum]).result;
    expect(formatAbs(r)).not.toBe('"fb"');
    expect(formatShape(r)).toContain("number");
  });
});

describe("P0 do-while dual path", () => {
  it("B-path runs do-while body at least once", () => {
    const src = `export function f() { let s = 0; do { s = s + 1; } while (false); return s; }`;
    expect(litValue(call(src, "f").result)).toBe(1);
  });

  it("export-call do-while agrees", () => {
    const r = callAbs(
      `export function f() { let s = 0; do { s = s + 1; } while (false); return s; }`,
      "f",
      [],
    ).result;
    expect(formatAbs(r)).toBe("1  #exact");
  });
});

describe("P1 leq literal discrimination", () => {
  it("2 ⊄ 1", () => {
    expect(leqAbs($lit(2), $lit(1)).ok).toBe(false);
  });

  it("number ⊄ lit 1", () => {
    expect(leqAbs(absNum, $lit(1)).ok).toBe(false);
  });

  it("string ⊄ number still fails", () => {
    expect(
      leqAbs({ shape: { k: "prim", type: "string" }, conf: "path" } as never, absNum).ok,
    ).toBe(false);
  });

  it("lit 1 ≤ number prim succeeds", () => {
    expect(leqAbs($lit(1), absNum).ok).toBe(true);
  });
});
