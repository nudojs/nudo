/**
 * Bug 11（运行时内建建模）：RegExp#exec / String#match 结果的
 * .index/.input/.groups 折 undefined——exec 分支只返回 capture tuple
 * （{k:"tuple", elements}），丢失 RegExpExecArray 的附加属性。
 * 原生：m.index = 匹配下标、m.input = 原串、m.groups = 具名组对象
 * （无具名组 → undefined）。
 * 修复：exec/match 结果合并为带附加属性的对象 Abs（capture 下标槽
 * "0"/"1"… + length/index/input/groups）；$idx 字面量下标与 $get 字符串
 * 键均可读，m[0]/m[1] 下标读不回归。
 */
import { describe, it, expect } from "vitest";
import { type Abs, runTranspiled, callTranspiledExportFull, litValue } from "@nudojs/core";

function call(src: string, name: string, args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, name, args);
}

describe("Bug 11: exec/match result carries index/input/groups", () => {
  it("exec().index → 匹配下标", () => {
    const r = call(
      `export function f1() { const m = /a(b)/.exec("xab"); return m.index; }`,
      "f1",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("exec().input → 原串", () => {
    const r = call(
      `export function f2() { const m = /a(b)/.exec("xab"); return m.input; }`,
      "f2",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "xab" });
  });

  it("exec().groups.g → 具名捕获组值", () => {
    const r = call(
      `export function f3() { const m = /a(?<g>b)/.exec("xab"); return m.groups.g; }`,
      "f3",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "b" });
  });

  it('"xab".match(/a(b)/).index → 1（match 非 global ≡ exec）', () => {
    const r = call(
      `export function f4() { const m = "xab".match(/a(b)/); return m.index; }`,
      "f4",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("m[0]/m[1] 下标读不回归", () => {
    const r = call(
      `export function f5() { const m = /a(b)/.exec("xab"); return m[0] + m[1]; }`,
      "f5",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "abb" });
  });

  it("m.length → capture 数 + 1", () => {
    const r = call(
      `export function f6() { const m = /a(b)/.exec("xab"); return m.length; }`,
      "f6",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("未参与捕获组 → undefined 字面量（?? 默认值可用）", () => {
    const r = call(
      `export function f7() { const m = /(z)?(b)/.exec("ab"); return m[1] ?? "none"; }`,
      "f7",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "none" });
  });

  it("无具名组 → m.groups 折 undefined", () => {
    const r = call(
      `export function f8() { const m = /a(b)/.exec("xab"); return m.groups; }`,
      "f8",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("exec 无命中 → null（?? 守卫路径不回归）", () => {
    const r = call(
      `export function f9() { const m = /z/.exec("xab"); return m === null ? "null" : "match"; }`,
      "f9",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "null" });
  });
});
