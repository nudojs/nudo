/**
 * 数组 hole 槽 ≠ 显式 undefined 槽（`1 in a` 可观察）。
 * 回归背景：formatShape / absShapeKey / leqAbs 都把 holes 信息丢掉，
 * `[1,,3]` 与 `[1, undefined, 3]` 渲染成同一字符串、shape key 相同、
 * 互相 leq 通过——结构同一性与可赋值性双双假精确。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  lit,
  numLit,
  formatShape,
  formatAbs,
  absShapeKey,
  leqAbs,
  runTranspiled,
  callTranspiledExportFull,
} from "../index.ts";

function undefLit() {
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}

function sparseArr() {
  return abs(
    { k: "tuple", elements: [numLit(1), undefLit(), numLit(3)], holes: [1] },
    undefined,
    undefined,
    "exact",
  );
}

function denseArr() {
  return abs(
    { k: "tuple", elements: [numLit(1), undefLit(), numLit(3)] },
    undefined,
    undefined,
    "exact",
  );
}

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("array holes vs explicit undefined", () => {
  it("formatShape distinguishes hole from undefined slot", () => {
    expect(formatShape(sparseArr())).toBe("[1, , 3]");
    expect(formatShape(denseArr())).toBe("[1, undefined, 3]");
    expect(formatAbs(sparseArr())).toContain("[1, , 3]");
  });

  it("absShapeKey distinguishes hole from undefined slot", () => {
    expect(absShapeKey(sparseArr())).not.toBe(absShapeKey(denseArr()));
  });

  it("leqAbs does not equate sparse and dense tuples", () => {
    expect(leqAbs(sparseArr(), denseArr()).ok).toBe(false);
    expect(leqAbs(denseArr(), sparseArr()).ok).toBe(false);
    expect(leqAbs(sparseArr(), sparseArr()).ok).toBe(true);
    expect(leqAbs(denseArr(), denseArr()).ok).toBe(true);
  });

  it("evaluated [1,,3] keeps hole; [1, undefined, 3] does not", () => {
    const sparse = call(`export function f() { return [1,,3]; }`).result;
    const dense = call(`export function f() { return [1, undefined, 3]; }`).result;
    expect(formatShape(sparse)).toBe("[1, , 3]");
    expect(formatShape(dense)).toBe("[1, undefined, 3]");
    expect(absShapeKey(sparse)).not.toBe(absShapeKey(dense));
    expect(leqAbs(sparse, dense).ok).toBe(false);
    expect(leqAbs(dense, sparse).ok).toBe(false);
  });

  it("empty middle slot rendering: leading/trailing holes", () => {
    const lead = abs(
      { k: "tuple", elements: [undefLit(), numLit(1)], holes: [0] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(lead)).toBe("[, 1]");
    const trail = abs(
      { k: "tuple", elements: [numLit(1), undefLit()], holes: [1] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(trail)).toBe("[1, ]");
  });
});
