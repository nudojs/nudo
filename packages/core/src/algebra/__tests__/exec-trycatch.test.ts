import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  absToString,
  transpile,
} from "@nudojs/core";

describe("evaluator try/catch", () => {
  it("catches $throw and binds Abs value", () => {
    const src = `
export function go(n) {
  try {
    if (n > 0) {
      return n;
    } else {
      throw "neg";
    }
  } catch (e) {
    return e;
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const ok = callTranspiledExportFull(exports, "go", [$lit(3)]);
    expect(litValue(ok.result)).toEqual({ ok: true, value: 3 });
    expect(ok.throws.shape.k).toBe("never");

    const bad = callTranspiledExportFull(exports, "go", [$lit(-1)]);
    expect(litValue(bad.result)).toEqual({ ok: true, value: "neg" });
  });

  it("finally runs after catch", () => {
    const src = `
export function go() {
  let t = 0;
  try {
    throw "x";
  } catch (e) {
    t = 1;
  } finally {
    t = t + 10;
  }
  return t;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 11 });
  });

  it("uncaught throw still reports throws", () => {
    const src = `
export function go() {
  throw "boom";
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(r.result.shape.k).toBe("never");
    expect(absToString(r.throws)).toContain("boom");
  });

  it("transpiles try/catch", () => {
    const out = transpile(`export function f() { try { return 1; } catch (e) { return 0; } }`);
    expect(out).toContain("try {");
    expect(out).toContain("$catchVal(");
  });
});

// catch 参数位模式（catch ([a, b]) / catch ({v})）：此前只绑载体名 "e"，
// 模式子名静默丢绑定 → catch 体自由读 spurious ReferenceError（差分
// FALSE-THROW 金丝雀，钉过 knownFalseThrows）。现载体复用 catchTmp，
// 守卫区内 emitDestructure 绑定全部子名（let 语义，可再赋）。
describe("catch param destructure patterns", () => {
  it("binds array pattern catch param", () => {
    const exports = runTranspiled(
      `export function f() { try { throw [1, 2]; } catch ([a, b]) { return a + b; } return 0; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("binds object pattern catch param", () => {
    const exports = runTranspiled(
      `export function f() { try { throw {v: 9}; } catch ({v}) { return v; } return 0; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });

  it("binds nested patterns and skips holes", () => {
    const src = `
export function f1() { try { throw [1, [2, 3]]; } catch ([a, [b, c]]) { return a + b + c; } return 0; }
export function f2() { try { throw {a: {b: 7}}; } catch ({a: {b}}) { return b; } return 0; }
export function f3() { try { throw [1, 2]; } catch ([, b]) { return b; } return 0; }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "f1", []).result)).toEqual({
      ok: true,
      value: 6,
    });
    expect(litValue(callTranspiledExportFull(exports, "f2", []).result)).toEqual({
      ok: true,
      value: 7,
    });
    expect(litValue(callTranspiledExportFull(exports, "f3", []).result)).toEqual({
      ok: true,
      value: 2,
    });
  });

  it("applies defaults inside catch pattern", () => {
    const src = `
export function f1() { try { throw {v: 9}; } catch ({v = 3}) { return v; } return 0; }
export function f2() { try { throw {}; } catch ({v = 3}) { return v; } return 0; }
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "f1", []).result)).toEqual({
      ok: true,
      value: 9,
    });
    expect(litValue(callTranspiledExportFull(exports, "f2", []).result)).toEqual({
      ok: true,
      value: 3,
    });
  });

  it("pattern bindings are reassignable and compose with finally", () => {
    const src = `
export function f() {
  let s = 0;
  try { throw [1, 2]; } catch ([a, b]) { a = 10; s = a + b; } finally { s += 1; }
  return s;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 13 });
  });

  it("non-iterable thrown into array pattern catch is a TypeError (never)", () => {
    const exports = runTranspiled(
      `export function f() { try { throw 5; } catch ([a]) { return a; } return 0; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(r.result.shape.k).toBe("never");
  });

  it("pattern catch with rethrow and post-drain both bind", () => {
    const src = `
export function f() {
  let s = 0;
  try {
    try { throw [1, 2]; } catch ([a, b]) { s = a + b; throw new Error('r'); }
  } catch (e) { s += 3; }
  return s;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 6 });
  });
});
