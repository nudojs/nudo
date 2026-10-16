/**
 * Bug 11（运行时内建建模）：RegExp#exec / String#match 结果的
 * .index/.input/.groups 折 undefined——exec 分支只返回 capture tuple
 * （{k:"tuple", elements}），丢失 RegExpExecArray 的附加属性。
 * 原生：m.index = 匹配下标、m.input = 原串、m.groups = 具名组对象
 * （无具名组 → undefined）。
 * 修复：exec/match 结果合并为带附加属性的对象 Abs（capture 下标槽
 * "0"/"1"… + length/index/input/groups）；$idx 字面量下标与 $get 字符串
 * 键均可读，m[0]/m[1] 下标读不回归。
 * d 旗标（ES2022 hasIndices）：真实 exec 结果的 indices 镜像为同构槽 obj
 * （[start,end] 元组 + groups 子对象）；无 d 旗标 → 槽缺省读 undefined
 * （修复前 m.indices 读折 never → 假 entry-may-throw）。
 */
import { describe, it, expect } from "vitest";
import { type Abs, litValue } from "@nudojs/core";
import { call, isNever, tupleEls } from "./eval-helpers.ts";

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

describe("RegExp d 旗标 indices（修复前：槽缺省 → m.indices 读折 never 假不可达）", () => {
  // 宿主地面真值（node 实测）：/a+(b)/d.exec("aab").indices === [[0,3],[2,3]]，
  // indices[1][0] === 2；/a+(?<x>b)/d 的 indices.groups.x === [2,3]；
  // 无 d 旗标时宿主不设 indices 属性（读得 undefined）。
  it("m.indices[1][0] → exact 2（原症状：never + 假 throw）", () => {
    const r = call(
      `export function f() { const m = /a+(b)/d.exec("aab"); return m.indices[1][0]; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    expect(isNever(r.result)).toBe(false);
    expect(isNever(r.throws)).toBe(true);
  });

  it("m.indices[0]/m.indices[1] → [start,end] 精确元组；m.indices.length", () => {
    const r0 = call(
      `export function f() { const m = /a+(b)/d.exec("aab"); return m.indices[0]; }`,
    );
    expect(tupleEls(r0.result)).toEqual([0, 3]);
    const r1 = call(
      `export function f() { const m = /a+(b)/d.exec("aab"); return m.indices[1]; }`,
    );
    expect(tupleEls(r1.result)).toEqual([2, 3]);
    const rl = call(
      `export function f() { const m = /a+(b)/d.exec("aab"); return m.indices.length; }`,
    );
    expect(litValue(rl.result)).toEqual({ ok: true, value: 2 });
  });

  it("具名组 m.indices.groups.x → [2,3]、m.indices.groups.x[0] → 2", () => {
    const rg = call(
      `export function f() { const m = /a+(?<x>b)/d.exec("aab"); return m.indices.groups.x; }`,
    );
    expect(tupleEls(rg.result)).toEqual([2, 3]);
    const r0 = call(
      `export function f() { const m = /a+(?<x>b)/d.exec("aab"); return m.indices.groups.x[0]; }`,
    );
    expect(litValue(r0.result)).toEqual({ ok: true, value: 2 });
  });

  it("无具名组 → m.indices.groups 折 undefined", () => {
    const r = call(
      `export function f() { const m = /a+(b)/d.exec("aab"); return m.indices.groups; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("未参与捕获组 → indices 下标槽 undefined（?? 默认值可用）", () => {
    const r = call(
      `export function f() { const m = /(?:(a)|(b))/d.exec("b"); return m.indices[1] ?? "none"; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "none" });
    const r2 = call(
      `export function f() { const m = /(?:(a)|(b))/d.exec("b"); return m.indices[2][0]; }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: 0 });
  });

  it("未参与具名组 → indices.groups.x 折 undefined", () => {
    const r = call(
      `export function f() { const m = /(?:(?<x>a)|b)/d.exec("b"); return m.indices.groups.x; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
  });

  it("无 d 旗标 → m.indices 折 undefined（不回归）", () => {
    const r = call(
      `export function f() { const m = /a+(b)/.exec("aab"); return m.indices === undefined; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: true });
    const r2 = call(
      `export function f() { const m = /a+(b)/.exec("aab"); return m.indices; }`,
    );
    expect(litValue(r2.result)).toEqual({ ok: true, value: undefined });
  });

  it("d 旗标整链不产生假 never / 假 throw（entry-may-throw 不误报）", () => {
    const r = call(
      `export function f() {
        const m = /a+(?<x>b)/d.exec("aab");
        return [m.indices[0], m.indices[1], m.indices.groups.x[0], m.index, m[0]];
      }`,
    );
    expect(isNever(r.result)).toBe(false);
    expect(isNever(r.throws)).toBe(true);
  });
});
