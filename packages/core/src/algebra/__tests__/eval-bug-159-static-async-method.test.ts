/**
 * Bug 159 回归：class 的 **static async 方法**未进 $async 包装。
 *
 * ES 语义：`static async m(){}` 与实例 async 方法同语义——调用返回
 * **promise**；函数体 throw 不同步抛到调用点（确定拒绝 promise）。
 *
 * 修复前：静态方法分支不包 $async——返回原始值（typeof → "number"）、
 * 体内 throw 变同步抛（调用点直接 catch 到）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 159 — static async 方法进 $async 包装", () => {
  it("static async 方法返回 promise（typeof → object）", () => {
    expect(v(wrap(`class A { static async m(){ return 1; } } return typeof A.m();`))).toEqual({
      ok: true,
      value: "object",
    });
  });

  it("static async 方法的返回是 Promise 实例", () => {
    expect(
      v(wrap(`class A { static async m(){ return 1; } } return A.m() instanceof Promise;`)),
    ).toEqual({ ok: true, value: true });
  });

  it("体内 throw 不同步抛到调用点（此前同步抛）", () => {
    expect(
      v(
        wrap(
          `class A { static async m(){ throw new Error("x"); } } try { A.m().catch(() => {}); return "nothrow"; } catch (e) { return "sync-throw"; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "nothrow" });
  });

  it("负控制：实例 async 方法仍返回 promise", () => {
    expect(v(wrap(`class A { async m(){ return 1; } } return typeof new A().m();`))).toEqual({
      ok: true,
      value: "object",
    });
  });

  it("负控制：静态同步方法仍返回原始值", () => {
    expect(v(wrap(`class A { static m(){ return 1; } } return typeof A.m();`))).toEqual({
      ok: true,
      value: "number",
    });
  });

  it("负控制：静态同步方法的 throw 仍同步抛", () => {
    expect(
      throwName(wrap(`class A { static m(){ throw new Error("x"); } } A.m(); return 1;`)),
    ).toBe("Error");
  });
});
