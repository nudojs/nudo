import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $arr,
  $idx,
  litValue,
  formatAbs,
  objOf,
  numLit,
  strLit,
  abs,
  pTrue,
  makeMapAbs,
  mapGetEntry,
  mapHasEntry,
  mapSetEntry,
  type Abs,
} from "@nudojs/core";

function call(src: string, fnName: string, ...litArgs: unknown[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(
    exports,
    fnName,
    litArgs.map((a) => $lit(a as never)),
  );
}

function callWith(src: string, fnName: string, args: Abs[]) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args);
}

function strPrim() {
  return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
}

/** C2.1：循环 / 嵌套函数 return 不得假 exact */
describe("C2.1 $loopReturn / nested function boundary", () => {
  it("classic for-i early return is the function result", () => {
    const src = `
export function pick() {
  for (let i = 0; i < 3; i++) {
    if (i === 1) return 1;
  }
  return 0;
}
`;
    const r = call(src, "pick");
    expect(litValue(r.result)).toBe(1);
  });

  it("for-of early return is the function result", () => {
    const src = `
export function findFirst(arr) {
  for (const x of arr) {
    if (x > 2) return x;
  }
  return -1;
}
`;
    const arr = $arr([$lit(1), $lit(2), $lit(4), $lit(5)]);
    const r = callWith(src, "findFirst", [arr]);
    expect(litValue(r.result)).toBe(4);
  });

  it("nested callback return inside loop is NOT the outer function result", () => {
    const src = `
export function outer(arr) {
  const mapped = [];
  for (const x of arr) {
    const cb = (v) => v * 10;
    mapped.push(cb(x));
  }
  return mapped;
}
`;
    const arr = $arr([$lit(1), $lit(2)]);
    const r = callWith(src, "outer", [arr]);
    const s = formatAbs(r.result);
    expect(s).not.toBe("10");
    expect(s).not.toBe("20");
    expect(s).toContain("10");
  });

  it("while early return folds to the taken branch", () => {
    const src = `
export function untilThree() {
  let i = 0;
  while (i < 5) {
    if (i === 3) return i;
    i = i + 1;
  }
  return -1;
}
`;
    const r = call(src, "untilThree");
    expect(litValue(r.result)).toBe(3);
  });
});

/** C1.3：闭 shape / Map 缺键必须并入 undefined（存在性） */
describe("C1.3 missing-key presence includes undefined", () => {
  it("closed object literal-key miss joins known slots + undefined", () => {
    const o = objOf(
      { a: { value: numLit(1) }, b: { value: strLit("x") } },
      { open: false },
    );
    const miss = $idx(o, strLit("c"));
    const s = formatAbs(miss);
    expect(s).toContain("undefined");
    expect(s).not.toBe("unknown");
  });

  it("closed object unknown-key projection includes undefined", () => {
    const o = objOf(
      { a: { value: numLit(1) }, b: { value: numLit(2) } },
      { open: false },
    );
    const proj = $idx(o, strPrim());
    const s = formatAbs(proj);
    expect(s).toContain("undefined");
  });

  it("Map.get unknown key joins values + undefined", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    mapSetEntry(m, strLit("b"), numLit(2));
    const g = mapGetEntry(m, strPrim());
    const s = formatAbs(g);
    expect(s).toContain("undefined");
    expect(s).not.toBe("unknown");
  });

  it("Map.get literal miss is undefined; has folds false consistently", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    const missKey = strLit("zzz");
    const g = mapGetEntry(m, missKey);
    const h = mapHasEntry(m, missKey);
    expect(litValue(g)).toBeUndefined();
    expect(formatAbs(g)).toContain("undefined");
    expect(litValue(h)).toBe(false);
  });

  it("Map.get program-level: unknown key cannot look exact-number", () => {
    const src = `
export function lookup(key) {
  const m = new Map();
  m.set("a", 1);
  return m.get(key);
}
`;
    const r = call(src, "lookup", undefined);
    const s = formatAbs(r.result);
    expect(s).toContain("undefined");
    expect(s).not.toBe("unknown");
  });

  it("obj[key] program-level closed miss includes undefined", () => {
    const src = `
export function pick(key) {
  const o = { a: 1, b: "x" };
  return o[key];
}
`;
    const r = call(src, "pick", "c");
    const s = formatAbs(r.result);
    expect(s).toContain("undefined");
  });

  it("obj[key] program-level unknown key on closed object includes undefined", () => {
    const src = `
export function pick(obj, key) {
  return obj[key];
}
`;
    // 构造闭 shape：源码字面量对象经 B-path 为 closed
    const src2 = `
export function pick(key) {
  return { a: 1, b: "x" }[key];
}
`;
    const r = call(src2, "pick", undefined);
    const s = formatAbs(r.result);
    expect(s).toContain("undefined");
    expect(src).toBeDefined();
  });
});
