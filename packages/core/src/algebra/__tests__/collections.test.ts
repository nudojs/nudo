import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $arr,
  litValue,
  formatAbs,
} from "@nudojs/core";

function call(src: string, fnName: string, ...litArgs: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(
    exports,
    fnName,
    litArgs.map((a) => $lit(a as never)),
  );
}

describe("C1.1 Map literal key tracking", () => {
  it("get after set with matching literal key is precise", () => {
    const src = `
export function lookup(key) {
  const m = new Map();
  m.set("alice", { id: "alice", name: "Alice" });
  m.set("bob", { id: "bob", name: "Bob" });
  return m.get(key);
}
`;
    const r = call(src, "lookup", "alice");
    expect(formatAbs(r.result)).toContain("alice");
    expect(formatAbs(r.result)).toContain("Alice");
  });

  it("get with non-literal key joins known values + undefined (failable presence)", () => {
    const src = `
export function lookup(key) {
  const m = new Map();
  m.set("a", 1);
  m.set("b", 2);
  return m.get(key);
}
`;
    const r = call(src, "lookup", undefined);
    const s = formatAbs(r.result);
    // 必须并入 undefined；仅「不是 unknown」无法证伪过强投影
    expect(s).toContain("undefined");
    expect(s).not.toBe("unknown");
  });

  it("get with missing literal key is undefined, not a known value", () => {
    const src = `
export function lookup() {
  const m = new Map();
  m.set("a", 1);
  return m.get("zzz");
}
`;
    const r = call(src, "lookup");
    expect(formatAbs(r.result)).toContain("undefined");
    expect(formatAbs(r.result)).not.toContain("1");
  });

  it("has on literal key folds", () => {
    const src = `
export function hasAlice() {
  const m = new Map();
  m.set("alice", 1);
  return m.has("alice");
}
`;
    const r = call(src, "hasAlice");
    expect(litValue(r.result)).toBe(true);
  });

  it("has on missing literal key folds false and get is undefined", () => {
    const src = `
export function probe() {
  const m = new Map();
  m.set("alice", 1);
  return [m.has("zzz"), m.get("zzz")];
}
`;
    const r = call(src, "probe");
    const s = formatAbs(r.result);
    expect(s).toContain("false");
    expect(s).toContain("undefined");
  });
});

describe("C1.2 Set element union", () => {
  it("Array.from(new Set(arr)) keeps element type", () => {
    const src = `
export function unique(arr) {
  return Array.from(new Set(arr));
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const arr = $arr([$lit(1), $lit(2), $lit(2), $lit(3)]);
    const r = callTranspiledExportFull(exports, "unique", [arr]);
    const s = formatAbs(r.result);
    expect(s).toContain("number");
    expect(s).not.toMatch(/^unknown/);
  });

  it("for-of over Set yields constructor elements", () => {
    const src = `
export function dedup(arr) {
  const out = [];
  for (const v of new Set(arr)) out.push(v);
  return out;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const arr = $arr([$lit(1), $lit(2), $lit(2), $lit(3)]);
    const r = callTranspiledExportFull(exports, "dedup", [arr]);
    expect(formatAbs(r.result)).not.toBe("[]");
    expect(formatAbs(r.result)).not.toMatch(/^unknown/);
  });
});

describe("C1.3 dynamic key index projection", () => {
  it("obj[missing literal key] on closed shape includes undefined", () => {
    const src = `
export function pickDynamic(key) {
  return { a: 1, b: "x" }[key];
}
`;
    const r = call(src, "pickDynamic", "c");
    const s = formatAbs(r.result);
    // 闭 shape miss：投影必须含 undefined，不能只有 slot 值
    expect(s).toContain("undefined");
    expect(s).not.toBe("unknown");
  });
});

describe("C1.4 hand-written loop dispatch", () => {
  it("for-of push collects transformed elements", () => {
    const src = `
export function doubleAll(arr) {
  const out = [];
  for (const x of arr) out.push(x * 2);
  return out;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const arr = $arr([$lit(1), $lit(2), $lit(3)]);
    const r = callTranspiledExportFull(exports, "doubleAll", [arr]);
    expect(formatAbs(r.result)).toContain("2");
    expect(formatAbs(r.result)).not.toBe("[]");
  });

  it("for-i sum accumulates", () => {
    const src = `
export function sumFor(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s = s + arr[i];
  return s;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const arr = $arr([$lit(1), $lit(2), $lit(3), $lit(4)]);
    const r = callTranspiledExportFull(exports, "sumFor", [arr]);
    expect(litValue(r.result)).toBe(10);
  });
});
