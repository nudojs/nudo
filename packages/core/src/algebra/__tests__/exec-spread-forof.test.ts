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

describe("B-path spread", () => {
  it("object spread overwrites keys", () => {
    const src = `
export function go() {
  const a = { x: 1, y: 2 };
  const b = { y: 9, z: 3 };
  const o = { ...a, ...b };
  return o.x + o.y + o.z;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(13); // 1+9+3
  });

  it("array spread concatenates", () => {
    const src = `
export function go() {
  const a = [1, 2];
  const b = [3];
  const c = [...a, ...b];
  return c[0] + c[1] + c[2];
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(6);
  });

  it("transpiles spread", () => {
    const out = transpile(`export function f(a, b) { return { ...a, z: 1 }; }`);
    expect(out).toContain("$spread(");
  });
});

describe("B-path for-of", () => {
  it("iterates tuple elements", () => {
    const src = `
export function go() {
  const xs = [1, 2, 3];
  let sum = 0;
  for (const x of xs) {
    sum = sum + x;
  }
  return sum;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(6);
  });

  it("for-of with object destructure", () => {
    const src = `
export function go() {
  const xs = [{ v: 1 }, { v: 2 }];
  let sum = 0;
  for (const { v } of xs) {
    sum = sum + v;
  }
  return sum;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", []);
    expect(litValue(r.result)).toBe(3);
  });

  it("transpiles for-of", () => {
    const out = transpile(`export function f(xs) { let t = 0; for (const x of xs) { t = t + x; } return t; }`);
    expect(out).toContain("$forOf(");
  });
});
