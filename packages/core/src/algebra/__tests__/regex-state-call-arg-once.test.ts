/**
 * RegExp 状态调用（test/exec/compile）的**实参只求值一次**回归（Bug 171）。
 *
 * 根因：`expr/call.ts` 的正则状态写回分支把同一份 `[${args}]` 源码文本内联进
 * $invoke（真调用）与 $reStateCall（取 lastIndex 再走一次）两处 ⇒ 实参表达式
 * 被执行两遍（副作用翻倍）。同型面在 `expr/optional-chain.ts` 的 invoke hop。
 *
 * 修法：先把实参物化成数组 __a，两个运行时通道共用同一份值。
 *
 * 锚定值均为 node 原生实测（各断言注释）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

describe("RegExp 状态调用的实参只求值一次", () => {
  it("re.test(副作用实参) → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "a"; } const re = /a/; re.test(mk()); return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("re.exec(副作用实参) → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "a"; } const re = /a/; re.exec(mk()); return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("两个实参 → 计数 2（修前 4）", () => {
    const r = call(
      `export function f() { let n = 0; const t = () => ++n; const r = /a/; r.test(t() ? "a" : "b", t() ? "c" : "d"); return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("展开实参 ...t() → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; const t = () => { n = n + 1; return ["a"]; }; const r = /a/; r.test(...t()); return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("表达式值与副作用计数同时正确 → \"true,1\"", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "a"; } const re = /a/; const v = re.test(mk()); return [v, n].join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true,1" });
  });

  it("exec 的 null 判定与计数同时正确 → \"true,1\"", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "b"; } const re = /a/; const v = re.exec(mk()); return [v === null, n].join(","); }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "true,1" });
  });

  it("compile 的实参只求值一次 → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "a"; } const re = /a/; re.compile(mk()); return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("用户自定义的 .test(副作用实参) 也只求值一次 → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "a"; } const o = { test(x){ return true; } }; o.test(mk()); return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("可选链 re?.test(副作用实参) → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "a"; } const re = /a/; re?.test(mk()); return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("可选链 re.exec(s)?.[0] → 计数 1（修前 2）", () => {
    const r = call(
      `export function f() { let n = 0; function mk(){ n = n + 1; return "a"; } const re = /a/; re.exec(mk())?.[0]; return n; }`,
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("全局正则的 lastIndex 仍推进 → 1", () => {
    const r = call(`export function f() { const re = /a/g; re.test("aa"); return re.lastIndex; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });

  it("exec 的全局 lastIndex 仍推进 → 1", () => {
    const r = call(`export function f() { const re = /a/g; re.exec("aa"); return re.lastIndex; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});
