/**
 * 解构绑定的**可变性**（161）+ 解构导出的**导出名**（156）回归。
 *
 * Bug 161：解构模式一律按 `const` 发射——但 JS 的绑定种类决定解构出来的名字
 * 是不是 const：**形参**可变（等同 let）、`let` / `var` 循环头可变、`const`
 * 头不可变。此前形参与 let/var 循环头的解构绑定按 const 发射 ⇒ 体内再赋
 * 抛 TypeError（原生不抛）⇒ L2 门禁假红 + 返回值退化成 unknown。
 *
 * Bug 156：`export const { a } = …` / `export const [a] = …`（解构导出）把
 * `export` 贴在转译后的**第一条语句**上——而那是内部临时名 `const _d0 = …`
 * ⇒ 导出表里出现 `_d0`，真实导出名 `a` 丢失 ⇒ 跨模块 import 全灭。
 *
 * 锚定值均为 node 原生实测（各断言注释）。
 */
import { describe, it, expect } from "vitest";
import { litValue, type Abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";
import { runTranspiled } from "../exec/run.ts";

describe("解构绑定的可变性（161）", () => {
  it("形参解构后可再赋 → 5（修前 throws TypeError）", () => {
    // 实参传宿主裸值（运行时由 callTranspiledExportFull 收成 Abs）⇒ 这里
    // 只做类型层 cast，不改实参形态。
    const r = call(`export function f({ a }) { a = 5; return a; }`, "f", [{ a: 1 }] as unknown as Abs[]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("数组形参解构后可再赋 → 5（修前 throws TypeError）", () => {
    const r = call(`export function f([a]) { a = 5; return a; }`, "f", [[1]] as unknown as Abs[]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("rest 形参解构后可再赋 → 5（修前 throws TypeError）", () => {
    const r = call(`export function f([...a]) { a = 5; return a; }`, "f", [[1, 2]] as unknown as Abs[]);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("默认参解构后可再赋 → 5（修前 throws TypeError）", () => {
    const r = call(`export function f({ a } = { a: 1 }) { a = 5; return a; }`, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("默认数组参解构后可再赋 → 5（修前 throws TypeError）", () => {
    const r = call(`export function f([a] = [1]) { a = 5; return a; }`, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("for (let [a] of …) 体内可再赋 → \"ok\"（修前 throws TypeError）", () => {
    const r = call(`export function f() { for (let [a] of [[1]]) { a = 5; } return "ok"; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  });

  it("for (let {a} of …) 体内可再赋 → \"ok\"（修前 throws TypeError）", () => {
    const r = call(`export function f() { for (let { a } of [{ a: 1 }]) { a = 5; } return "ok"; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  });

  it("for (var [a] of …) 体内可再赋 → \"ok\"（修前 throws TypeError）", () => {
    const r = call(`export function f() { for (var [a] of [[1]]) { a = 5; } return "ok"; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "ok" });
  });

  it("for (const [a] of …) 体内再赋仍抛 TypeError（原生语义不变）", () => {
    const r = call(`export function f() { for (const [a] of [[1]]) { a = 5; } return "ok"; }`, "f");
    expect(r.throws?.shape?.k ?? "never").toBe("brand");
  });

  it("const 声明的解构绑定再赋仍抛 TypeError（原生语义不变）", () => {
    const r = call(`export function f() { const { a } = { a: 1 }; a = 5; return a; }`, "f");
    expect(r.throws?.shape?.k ?? "never").toBe("brand");
  });

  it("let 声明的解构绑定可再赋 → 5", () => {
    const r = call(`export function f() { let { a } = { a: 1 }; a = 5; return a; }`, "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });
});

describe("解构导出的导出名（156）", () => {
  it("export const { a } = … → 导出名 a（修前是内部临时名 _d0）", () => {
    const ex = runTranspiled(`export const { a } = { a: 1 };`, { mode: "analyze" }) as Record<string, unknown>;
    expect(Object.keys(ex)).toEqual(["a"]);
    expect(litValue(ex["a"] as never)).toEqual({ ok: true, value: 1 });
  });

  it("export const [b] = … → 导出名 b", () => {
    const ex = runTranspiled(`export const [b] = [2];`, { mode: "analyze" }) as Record<string, unknown>;
    expect(Object.keys(ex)).toEqual(["b"]);
    expect(litValue(ex["b"] as never)).toEqual({ ok: true, value: 2 });
  });

  it("嵌套解构导出 → 导出名是真实绑定", () => {
    const ex = runTranspiled(`export const { d: { e } } = { d: { e: 4 } };`, {
      mode: "analyze",
    }) as Record<string, unknown>;
    expect(Object.keys(ex)).toEqual(["e"]);
    expect(litValue(ex["e"] as never)).toEqual({ ok: true, value: 4 });
  });

  it("普通导出不受影响 → 导出名 f", () => {
    const ex = runTranspiled(`export const f = 5;`, { mode: "analyze" }) as Record<string, unknown>;
    expect(Object.keys(ex)).toEqual(["f"]);
    expect(litValue(ex["f"] as never)).toEqual({ ok: true, value: 5 });
  });
});
