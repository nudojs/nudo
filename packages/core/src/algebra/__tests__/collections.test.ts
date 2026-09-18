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

describe("Map iteration yields [k, v] entry tuples", () => {
  it("Array.from(map) produces entry tuples, not bare values", () => {
    const src = `
export function entries() {
  const m = new Map();
  m.set("a", 1);
  m.set("b", 2);
  return Array.from(m);
}
`;
    const r = call(src, "entries");
    const s = formatAbs(r.result);
    // entry 元组：key 与 value 同时可见
    expect(s).toContain("a");
    expect(s).toContain("1");
    expect(s).toContain("b");
    expect(s).toContain("2");
  });

  it("for-of over Map destructures [k, v]", () => {
    const src = `
export function firstKey() {
  const m = new Map();
  m.set("alice", 10);
  for (const [k, v] of m) return k;
  return null;
}
`;
    const r = call(src, "firstKey");
    const s = formatAbs(r.result);
    expect(s).toContain("alice");
  });

  it("Set for-of stays element itself (not tuple)", () => {
    const src = `
export function firstOfSet() {
  const s = new Set([7, 8]);
  for (const v of s) return v;
  return null;
}
`;
    const r = call(src, "firstOfSet");
    const s = formatAbs(r.result);
    expect(s).toContain("7");
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
    // 元素为字面量枚举 1|2|3（比塌缩成 number 更精确）
    expect(s).toContain("1");
    expect(s).toContain("2");
    expect(s).toContain("3");
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

describe("C1.2 / P1 Map iteration yields [k,v] entries", () => {
  it("Array.from(map) is entry tuples, not bare values", () => {
    const src = `
export function entries() {
  const m = new Map();
  m.set("alice", 1);
  m.set("bob", 2);
  return Array.from(m);
}
`;
    const r = call(src, "entries");
    const s = formatAbs(r.result);
    // element must be tuple-shaped [key, value]
    expect(s).toMatch(/\[|tuple/);
    expect(s).toContain("alice");
    expect(s).toContain("1");
  });

  it("for-of over Map destructures to key and value", () => {
    const src = `
export function collectKeys() {
  const m = new Map();
  m.set("alice", 10);
  m.set("bob", 20);
  const keys = [];
  for (const [k, v] of m) keys.push(k);
  return keys;
}
`;
    const r = call(src, "collectKeys");
    const s = formatAbs(r.result);
    expect(s).toContain("alice");
    expect(s).toContain("bob");
  });

  it("Array.from(set) stays element itself (not entry)", () => {
    const src = `
export function elems() {
  return Array.from(new Set([1, 2, 3]));
}
`;
    const r = call(src, "elems");
    const s = formatAbs(r.result);
    expect(s).not.toMatch(/^\[|tuple/);
    // 字面量枚举元素，而非 entry 元组
    expect(s).toContain("1");
    expect(s).toContain("3");
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
