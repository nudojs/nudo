/**
 * BUG-163 回归（`host` 面）：`URL` brand 的 `host` 槽此前漏建模 ⇒ 成员读折
 * **exact undefined**（假绿：`u.host === undefined` 恒 true）、`in` 面折
 * **exact false**（假红：宿主 true）。
 *
 * 根因：`packages/core/src/algebra/builtins/error/web.ts` 的 `urlBrandAbs`
 * 的 `componentKeys` = href / origin / protocol / hostname / pathname / search /
 * hash / port / username / password ⇒ **没有 `host`**（宿主 `host` 含端口、
 * `hostname` 不含；node 实测 `Object.getOwnPropertyNames(URL.prototype)` 同时
 * 有 host 与 hostname）。
 *
 * 修法：`componentKeys` 补 `"host"`。
 *
 * 未修的一半（`toJSON` 原型方法面两表无条目）见交付报告的 blocker：
 * 它需要 `exec/runtime/members.ts` 的 `BUILTIN_BRAND_METHODS.URL`（不在本次
 * 授权的文件清单内）。
 */
import { describe, it, expect } from "vitest";
import { call, val, tupleEls } from "./eval-helpers.ts";

const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};
const wrap = (body: string): string => `export function f() { const u = new URL("http://example.com/a"); ${body} }`;

describe("BUG-163：URL brand 的 host 槽", () => {
  it("u.host ⇒ \"example.com\"（不是 undefined）", () => {
    expect(lit(wrap("return u.host;"))).toBe("example.com");
  });

  it("u.host === undefined ⇒ false（不假绿）", () => {
    expect(lit(wrap("return u.host === undefined;"))).toBe(false);
  });

  it("\"host\" in u ⇒ true（in 面与读面同结论）", () => {
    expect(lit(wrap('return "host" in u;'))).toBe(true);
  });

  it("对照组：hostname 仍正确（回归控制）", () => {
    expect(lit(wrap("return u.hostname;"))).toBe("example.com");
  });

  it("带端口的 host 含端口、hostname 不含（原生语义）", () => {
    const r = call(
      `export function f() { const u = new URL("http://example.com:8080/a"); return [u.host, u.hostname]; }`,
    );
    expect(tupleEls(r.result)).toEqual(["example.com:8080", "example.com"]);
  });
});
