/**
 * Bug 65 回归：`URL.searchParams` 是与父 URL 同源的 **live view**——
 * 对它的 set / append / delete 会改写 u.search 与 u.href。此前 URL 组件
 * 是构造期快照，searchParams 的条目表变更后父 URL 不回写 ⇒ 自信错值。
 */
import { describe, it, expect } from "vitest";
import { val } from "./eval-helpers.ts";

describe("Bug 65 — URL.searchParams 回写父 URL", () => {
  it("set 后 u.search 是 '?b=2'（改前 '?b=1'）", () => {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a?b=1"); u.searchParams.set("b", "2"); return u.search; }`),
    ).toEqual({ ok: true, value: "?b=2" });
  });

  it("delete 后 u.href 去掉查询串", () => {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a?b=1"); u.searchParams.delete("b"); return u.href; }`),
    ).toEqual({ ok: true, value: "https://x.com/a" });
  });

  it("append 后 u.href 增出新查询串", () => {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a"); u.searchParams.append("q", "1"); return u.href; }`),
    ).toEqual({ ok: true, value: "https://x.com/a?q=1" });
  });

  it("负控制：searchParams 自身与独立 URLSearchParams 精度不变", () => {
    expect(
      val(`export function f() { const u = new URL("https://x.com/a?b=1"); u.searchParams.set("b","2"); return u.searchParams.toString(); }`),
    ).toEqual({ ok: true, value: "b=2" });
    expect(
      val(`export function f() { const p = new URLSearchParams("b=1"); p.set("b","2"); return p.toString(); }`),
    ).toEqual({ ok: true, value: "b=2" });
  });
});
