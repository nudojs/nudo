/**
 * Bug 37 回归：`BUILTIN_BRAND_ACCESSORS.URL` 是 `$in` presence 表，不是
 * 只读声明——WHATWG URL 的 href/protocol/…/hash 都带 setter，仅 origin /
 * searchParams 是 getter-only。此前写门把整张表当 getter-only ⇒ 合法写被
 * 判确定 TypeError、签名塌 never。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

describe("Bug 37 — URL 组件写入可写性", () => {
  it("u.href = … 合法且读回新值（改前 never throws TypeError）", () => {
    const r = call(
      `export function f() { const u = new URL("https://a.example/p?q=1#h"); u.href = "https://b.example/y"; return u.href; }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "https://b.example/y" });
    expect(isNever(r.result)).toBe(false);
  });

  it("其它可写组件（protocol/pathname/search/hash/port）同样不抛", () => {
    for (const key of ["protocol", "pathname", "search", "hash", "port"]) {
      const r = call(
        `export function f() { const u = new URL("https://a.example/p?q=1#h"); u.${key} = u.${key}; return 1; }`,
      );
      expect(litValue(r.result), key).toEqual({ ok: true, value: 1 });
    }
  });

  it("origin 是 getter-only ⇒ strict 下仍确定抛 TypeError", () => {
    const r = call(`export function f() { const u = new URL("https://a.example/p"); u.origin = "x"; return 1; }`);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("同名用户自定义 class URL 的 this.href 写入不再被表误伤", () => {
    const r = call(`class URL { constructor() { this.href = "x"; } }
export function f() { return new URL().href; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "x" });
  });
});
