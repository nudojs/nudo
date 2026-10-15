/**
 * issue #175 域共享残留修复回归（len-sharing.ts）：
 * `arr` 元素域只有一个 Abs，但 xs[0] 与 xs[1]、for-of 单代表、回调元素
 * 实参代表**不同具体值**——abstractLen 对域共享接收者不 memo（每次读
 * 铸独立 len#N），sub 自反折叠不再把 `xs[0].length - xs[1].length`
 * 假折成 exact 0。原绑定接收者（形参 a）不受影响：`a.length - a.length`
 * 仍折 0（同一绑定同一值，sound）。
 *
 * 配套（同型下标界，Array.prototype 回调族）：`.map((_, i) => …)` 的
 * 抽象接收者回调下标携带 ge(0)（fromIdxAbs，exec/class.ts）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { abs } from "../abs.ts";

const strArr = (termId: string) =>
  abs({ k: "arr", element: abs({ k: "prim", type: "string" }, undefined, undefined, "path") },
    { op: "var", id: termId }, undefined, "path");

describe("#175 域共享 len 修复：元素域双读不折 0", () => {
  it("xs[0].length - xs[1].length 不得折 exact 0（不同槽位不同长度）", () => {
    const run = runTranspiled(
      `export function diff(xs) { return xs[0].length - xs[1].length; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(run, "diff", [strArr("xs")]);
    expect(r.result.shape).toEqual({ k: "prim", type: "number" });
    // 具体可取 ["a","bb"] 得 -2 —— 假 0 是 unsound
    expect(r.result.term?.op).not.toBe("lit");
  });

  it("对照：形参绑定双读 a.length - a.length 仍折 0（sound）", () => {
    const run = runTranspiled(
      `export function same(a) { return a.length - a.length; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(run, "same", [
      abs({ k: "prim", type: "string" }, { op: "var", id: "a" }, undefined, "path"),
    ]);
    expect(r.result.term).toEqual({ op: "lit", value: 0 });
  });

  it("map 结果域双读不折 0：xs.map(s=>s.length) 的 a[0] - a[1]", () => {
    const run = runTranspiled(
      `export function pairDiff(xs) {
        const a = xs.map(function (s) { return s.length; });
        return a[0] - a[1];
      }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(run, "pairDiff", [strArr("xs")]);
    // 具体可取 ["a","bb"]：len 域 [1,2] → a[0]-a[1] = -1 —— 假 exact 0 是
    // unsound（同一 len#N term Abs 被分发到两个下标位）
    expect(r.result.term?.op).not.toBe("lit");
    expect(r.result.shape).toEqual({ k: "prim", type: "number" });
  });
});

describe("数组方法回调下标界（fromIdxAbs 同型扩展）", () => {
  const opts = {
    loadModule: (spec: string) =>
      spec.endsWith(".nudo.js")
        ? `import { fn, string, number, array } from "nudojs";
export const idxes = fn({ xs: array(string()) }, array(number().ge(0)));`
        : undefined,
    fromFile: "/t/mapidx.js",
  };

  it(".map((_, i) => i) 元素域证得 ge(0)", () => {
    const r = checkSource(
      "/t/mapidx.js",
      `export function idxes(xs) { return xs.map(function (_, i) { return i; }); }`,
      pTrue,
      opts,
    );
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  });

  it(".forEach 计数下标非负（副作用路径不炸）", () => {
    const r = checkSource(
      "/t/mapidx.js",
      `export function idxes(xs) { let last = 0; xs.forEach(function (_, i) { last = i; }); return last; }`,
      pTrue,
      opts,
    );
    // forEach 下标 ≥ 0 传播到 last（widen 后 ge(0) 保持）
    expect(r.issues.some((i) => i.code === "nudo:unproven-return")).toBe(false);
  });
});
