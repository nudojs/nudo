/**
 * BUG-189：生成器 `.throw(e)` 注入 try/catch 内的 yield——是否记
 * may-throw 由**转译期 catch 体事实位**（YIELD_CATCH_THROWS）决定。
 *
 * 只有 catch 体可能把注入异常抛出去（含 throw 语句）才记 may-throw；
 * `catch (e) { return "caught"; }` 原生必吸收 ⇒ 不记（此前无条件记，
 * 合法代码 L2 门禁假红）。同步 / 异步生成器同形状必须同结论。
 */
import { describe, it, expect } from "vitest";
import { call, effects, isNever, throwsError, val } from "./eval-helpers.ts";

describe("同步生成器 .throw 进 try/catch 的 may-throw 记录", () => {
  it("BUG-189 catch 体只 return（不含 throw）：被吸收，不记 may-throw", () => {
    const r = call(`export function f() {
      function* g() { try { yield 1; } catch (e) { return "caught"; } }
      const it = g(); it.next();
      return it.throw(new Error("x"));
    }`);
    expect(isNever(r.throws)).toBe(true);
  });

  it("BUG-189 catch 体重抛注入异常：记 may-throw（原生会抛）", () => {
    const eff = effects(`export function f() {
      function* g() { try { yield 1; } catch (e) { throw e; } }
      const it = g(); it.next(); it.throw(new Error("x"));
      return 0;
    }`);
    expect(eff).toContain("Error");
  });

  it("BUG-189 无 catch 的挂起点：保持原生定值抛", () => {
    const r = call(`export function f() {
      function* g() { yield 1; }
      const it = g(); it.next(); return it.throw(new Error("x"));
    }`);
    expect(throwsError(r.throws, "Error")).toBe(true);
  });

  it("BUG-189 吸收后交付 done:true（catch return 必完成生成器）", () => {
    expect(val(`export function f() {
      function* g() { try { yield 1; } catch (e) { return "caught"; } }
      const it = g(); it.next();
      return it.throw(new Error("x")).done;
    }`)).toEqual({ ok: true, value: true });
  });

  it("BUG-189 同形状 async 生成器同样不记 may-throw（同步/异步结论一致）", () => {
    const eff = effects(`export async function f() {
      async function* g() { try { yield 1; } catch (e) { return "caught"; } }
      const it = g(); await it.next(); await it.throw(new Error("x"));
      return 0;
    }`);
    expect(eff).not.toContain("Error");
  });
});
