import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  $arr,
  litValue,
} from "@nudojs/core";
import { isBPathCapable } from "@nudojs/service";

describe("B-path rest parameters", () => {
  it("collects rest into $arr", () => {
    const src = `
export function sum(a, ...rest) {
  let t = a;
  let i = 0;
  while (i < rest.length) {
    t = t + rest[i];
    i = i + 1;
  }
  return t;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const sum = exports.sum as (...a: unknown[]) => unknown;
    // named args then rest as separate args — callTranspiledExport only spreads args
    // Our convention: call with named + rest items as extra args via Function arguments
    const r = sum($lit(1), $lit(2), $lit(3));
    expect(litValue(r as never)).toBe(6);
  });

  it("rest empty when only named args", () => {
    const src = `
export function first(a, ...rest) {
  return a;
}
export function restLen(a, ...rest) {
  return rest.length;
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const first = exports.first as (...a: unknown[]) => unknown;
    const restLen = exports.restLen as (...a: unknown[]) => unknown;
    expect(litValue(first($lit(9)) as never)).toBe(9);
    expect(litValue(restLen($lit(9)) as never)).toBe(0);
    expect(litValue(restLen($lit(9), $lit(1), $lit(2)) as never)).toBe(2);
  });
});

describe("B-primary capable files", () => {
  it("isBPathCapable still true for simple functions", () => {
    expect(isBPathCapable("function f(x) { return x + 1; }")).toBe(true);
    expect(isBPathCapable("const x = require('y');")).toBe(false);
  });
});
