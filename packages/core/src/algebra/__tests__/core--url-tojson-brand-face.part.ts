/**
 * BUG-163（**toJSON 半**）：`URL.prototype` 的自有方法面（`toString` /
 * `toJSON`）此前不在 `BUILTIN_BRAND_METHODS` / `BUILTIN_BRAND_ACCESSORS`
 * 里 ⇒ 成员读落闭 obj 槽 miss 折 **exact undefined**（wrong-exact：
 * `u.toJSON === undefined` 判 true）、`"toJSON" in u` 折 **exact false**
 * （原生 true）。
 *
 * 注：本条 bug 的 **host 半**（`urlBrandAbs.componentKeys` 漏 `host`）在本
 * 测试落盘前已修（`packages/core/src/algebra/builtins/error/web.ts` 的
 * `componentKeys` 已含 `"host"`）；本文件只钉 **toJSON 半**，host 仅作
 * 对照（不得回退）。
 *
 * 原生（node v26.10.0 实测）：
 * `Object.getOwnPropertyNames(URL.prototype)` =
 * constructor, toString, href, origin, protocol, username, password, host,
 * hostname, port, pathname, search, searchParams, hash, toJSON
 * ⇒ `u.toJSON` 恒是函数、`typeof u.toJSON === "function"`、
 * `"toJSON" in u` 恒 true、`u.toJSON === undefined` 恒 false。
 */
import { describe, it, expect } from "vitest";
import { call, val } from "./eval-helpers.ts";

const url = (expr: string) =>
  val(`export function f() { const u = new URL("http://example.com/a"); return ${expr}; }`);

describe("BUG-163（toJSON 半）：URL 原型方法面", () => {
  it("u.toJSON 折函数值（不是 exact undefined）", () => {
    const r = call(
      `export function f() { const u = new URL("http://example.com/a"); return u.toJSON; }`,
    );
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("fn");
    expect(url("typeof u.toJSON")).toEqual({ ok: true, value: "function" });
  });

  it("u.toJSON === undefined 折 false（此前假绿 true）", () => {
    expect(url("u.toJSON === undefined")).toEqual({ ok: true, value: false });
  });

  it('"toJSON" in u 折 exact true（此前假红 false）', () => {
    expect(url('"toJSON" in u')).toEqual({ ok: true, value: true });
  });

  it("u.toString 同为原型方法（同一行表项的四项之一）", () => {
    expect(url("typeof u.toString")).toEqual({ ok: true, value: "function" });
    expect(url('"toString" in u')).toEqual({ ok: true, value: true });
  });

  it("对照：host 半已修且不得回退（host 含端口、hostname 不含）", () => {
    expect(url("u.host")).toEqual({ ok: true, value: "example.com" });
    expect(url("u.host === undefined")).toEqual({ ok: true, value: false });
    expect(url('"host" in u')).toEqual({ ok: true, value: true });
    expect(
      val(
        `export function f() { const u = new URL("http://example.com:8080/a"); return u.host; }`,
      ),
    ).toEqual({ ok: true, value: "example.com:8080" });
    expect(
      val(
        `export function f() { const u = new URL("http://example.com:8080/a"); return u.hostname; }`,
      ),
    ).toEqual({ ok: true, value: "example.com" });
  });

  it("对照：组件槽（href/hostname/pathname/search）读面不回退", () => {
    expect(url("u.href")).toEqual({ ok: true, value: "http://example.com/a" });
    expect(url("u.pathname")).toEqual({ ok: true, value: "/a" });
    expect(url('"searchParams" in u')).toEqual({ ok: true, value: true });
  });
});
