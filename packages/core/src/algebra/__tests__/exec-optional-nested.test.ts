import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $obj,
  $arr,
  litValue,
  absToString,
  transpile,
} from "@nudojs/core";

describe("B-path optional chaining", () => {
  it("a?.b short-circuits on nullish", () => {
    const src = `
export function go(o) {
  return o?.id;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const ok = callTranspiledExportFull(exports, "go", [$obj({ id: $lit(7) })]);
    expect(litValue(ok.result)).toBe(7);
    const nil = callTranspiledExportFull(exports, "go", [$lit(null)]);
    expect(litValue(nil.result)).toBeUndefined();
  });

  it("a?.b.c chains", () => {
    const src = `
export function go(o) {
  return o?.user?.name;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const ok = callTranspiledExportFull(exports, "go", [
      $obj({ user: $obj({ name: $lit("Ada") }) }),
    ]);
    expect(litValue(ok.result)).toBe("Ada");
    const nil = callTranspiledExportFull(exports, "go", [$lit(null)]);
    expect(litValue(nil.result)).toBeUndefined();
  });

  it("transpiles optional member", () => {
    const out = transpile(`export function f(o) { return o?.x; }`);
    expect(out).toContain("$optionalGet(");
  });
});

describe("B-path nested destructure", () => {
  it("nested object pattern", () => {
    const src = `
export function go() {
  const o = { a: { b: 3 } };
  const { a: { b } } = o;
  return b;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(3);
  });

  it("nested with default", () => {
    const src = `
export function go() {
  const o = { a: {} };
  const { a: { b = 9 } } = o;
  return b;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(9);
  });

  it("array of objects", () => {
    const src = `
export function go() {
  const xs = [{ v: 4 }];
  const [{ v }] = xs;
  return v;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(4);
  });
});
