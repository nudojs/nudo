/**
 * Bug 274 —— `@nudo:mock Math|Date|JSON|Promise|…` 被**静默忽略**。
 *
 * 改前：mock 与 env **合进同一张注入表**，而过滤用的是 **env 专用**的
 * 「不遮蔽宿主内建」env-skip 名单（getEnvShadowSkipGlobals）⇒ 名单内的 mock 名
 * 在注入前就被丢弃（no-op）——用户以为 mock 生效，实际跑的是宿主内建。
 *
 * 改后：跳过名单**只作用于 env 全局**；mock 键集不过滤（mock 的值本身
 * 就是一个 Abs，没有宿主对象身份需要保全——遮蔽宿主全局正是 mock 的意图）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { absFunction } from "../abs-fn.ts";
import { abs, litValue } from "../abs.ts";
import { pTrue } from "../pred.ts";

const num = (v: number) =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: v }, pTrue, "exact");
const str = (v: string) =>
  abs({ k: "prim", type: "string" }, { op: "lit", value: v }, pTrue, "exact");

const mockFn = (v: number | string) =>
  absFunction(["x"], {
    apply: () => (typeof v === "number" ? num(v) : str(v)),
  });

describe("Bug 274：mock 宿主内建名不再被 env skip 表吞掉", () => {
  it("@nudo:mock Math 生效（宿主 Math.floor 不再应答）", () => {
    const src = `export function run() { return Math.floor(1.5); }`;
    const withMock = runTranspiled(src, { mode: "exec", mocks: { Math: mockFn(42) } });
    const without = runTranspiled(src, { mode: "exec" });
    const mocked = callTranspiledExportFull(withMock, "run", []);
    const host = callTranspiledExportFull(without, "run", []);
    // 对照组：宿主 Math.floor(1.5) = 1
    expect(litValue(host.result)).toEqual({ ok: true, value: 1 });
    // mock 生效 ⇒ 结果不再是宿主值
    expect(litValue(mocked.result)).not.toEqual(litValue(host.result));
  });

  it("@nudo:mock JSON 生效（宿主 JSON.stringify 不再应答）", () => {
    const src = `export function run() { return JSON.stringify({ a: 1 }); }`;
    const withMock = runTranspiled(src, { mode: "exec", mocks: { JSON: mockFn("MOCKED") } });
    const without = runTranspiled(src, { mode: "exec" });
    const mocked = callTranspiledExportFull(withMock, "run", []);
    const host = callTranspiledExportFull(without, "run", []);
    expect(litValue(host.result)).toEqual({ ok: true, value: '{"a":1}' });
    expect(litValue(mocked.result)).not.toEqual(litValue(host.result));
  });

  it("env 全局仍受 skip 表约束（宿主内建名不被 env 遮蔽）", () => {
    const src = `export function run() { return Math.floor(1.5); }`;
    const exports = runTranspiled(src, { mode: "exec", envGlobals: { Math: num(42) } });
    const full = callTranspiledExportFull(exports, "run", []);
    // env 的 Math 被跳过 ⇒ 仍是宿主 Math.floor(1.5) = 1
    expect(litValue(full.result)).toEqual({ ok: true, value: 1 });
  });

  it("非 skip 名单上的 mock 名行为不变（fetch 对照组）", () => {
    const src = `export function run() { return fetch("x"); }`;
    const exports = runTranspiled(src, { mode: "exec", mocks: { fetch: mockFn("MOCKED") } });
    const full = callTranspiledExportFull(exports, "run", []);
    expect(litValue(full.result)).toEqual({ ok: true, value: "MOCKED" });
  });
});
