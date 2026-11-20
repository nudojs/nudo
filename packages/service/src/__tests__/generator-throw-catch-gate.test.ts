/**
 * BUG-189 门禁面：生成器 `.throw(e)` 注入 try/catch 后的 may-throw 记录
 * 按转译期 catch 体事实位（YIELD_CATCH_THROWS）判定。
 *
 * - catch 体只 return（不含 throw）⇒ 原生吸收 ⇒ 0 条 entry-may-throw；
 * - catch 体重抛 / 无 catch ⇒ 各 1 条；
 * - 同形状 async 生成器 ⇒ 0 条（同步 / 异步两面结论一致）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { l2Count } from "./check-helpers.ts";

const SRC = `
export function caught() { function* g() { try { yield 1; } catch (e) { return "caught"; } } const it = g(); it.next(); return it.throw(new Error("x")); }
export function rethrowing() { function* g() { try { yield 1; } catch (e) { throw e; } } const it = g(); it.next(); return it.throw(new Error("x")); }
export function noCatch() { function* g() { yield 1; } const it = g(); it.next(); return it.throw(new Error("x")); }
export async function caughtAsync() { async function* g() { try { yield 1; } catch (e) { return "caught"; } } const it = g(); await it.next(); return await it.throw(new Error("x")); }
`;

function check() {
  return checkSource("/t/b189-gate.js", SRC, pTrue, {});
}

describe("check 门禁：生成器 .throw 进 try/catch 的 may-throw", () => {
  it("BUG-189 catch 体不含 throw：caught 零条 entry-may-throw", () => {
    expect(l2Count(check(), "caught")).toBe(0);
  });

  it("BUG-189 catch 体重抛 / 无 catch：各 1 条 entry-may-throw", () => {
    const r = check();
    expect(l2Count(r, "rethrowing")).toBe(1);
    expect(l2Count(r, "noCatch")).toBe(1);
  });

  it("BUG-189 async 生成器同形状：caughtAsync 零条（与同步面一致）", () => {
    const r = check();
    expect(l2Count(r, "caughtAsync")).toBe(0);
    const sig = r.signatures.find((s) => s.name === "caught")?.display ?? "(missing)";
    expect(sig).not.toContain("throws");
  });
});
