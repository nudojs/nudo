/**
 * 未知下标读 a[i] 必须并入 undefined（键可能越界/非下标）。
 * 回归背景：tuple/arr 的抽象下标路径只 join 元素、丢了 miss 的 undefined，
 * `[10,20,30][i]` 折成 number（可赋给 number），但 i=99 / i="x" 原生是 undefined。
 * 对象读键的同路径已经 join undef()（containers.ts），tuple/arr 漏网。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  formatShape,
  leqAbs,
  num,
  litValue,
} from "../index.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

describe("unknown index read joins undefined", () => {
  it("tuple[i] with abstract i is not assignable to number", () => {
    const r = call(`export function f(i) { return [10, 20, 30][i]; }`);
    // 可能 undefined → 不得钉成 number
    expect(leqAbs(r.result, num()).ok).toBe(false);
  });

  it("tuple[i] with abstract i is not a precise element join", () => {
    const r = call(`export function f(i) { return [10, 20, 30][i]; }`);
    // 旧实现：10|20|30（number），新实现必须承认 miss
    const s = formatShape(r.result);
    expect(s === "number" || s === "10 | 20 | 30").toBe(false);
  });

  it("arr[i] with abstract i is not assignable to number", () => {
    const r = call(`export function f(i) { const a = [1, 2]; return a[i]; }`);
    expect(leqAbs(r.result, num()).ok).toBe(false);
  });

  it("known in-range index stays exact", () => {
    const r = call(`export function f() { return [10, 20, 30][1]; }`);
    expect(litValue(r.result)).toBe(20);
  });

  it("known out-of-range index is undefined", () => {
    const r = call(`export function f() { return [10, 20, 30][9]; }`);
    expect(formatShape(r.result)).toBe("undefined");
  });

  it("known non-index key is undefined", () => {
    const r = call(`export function f() { return [10, 20, 30]["x"]; }`);
    expect(formatShape(r.result)).toBe("undefined");
  });
});
