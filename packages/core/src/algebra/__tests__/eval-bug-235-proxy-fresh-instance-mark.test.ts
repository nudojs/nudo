/**
 * Bug 235 回归（Proxy「新鲜实例标」打在**构造点**）：原生 `new Proxy(t, h)`
 * 每次都是**新对象**——与靶 `t`、与其它代理必不同引用。⇒ 引擎在**构造点**
 * （makeProxyAbs）就打「新鲜实例」标 ⇒ 「**不经任何 Proxy 面读**」的
 * `p === t` / `p1 === p2` 也**可判**（折 false）。
 *
 * 修复前：标只在 **Proxy 读面**懒打（首次经 Proxy 面读时）⇒ 不经任何
 * Proxy 面读的 `p === t` 不可判（结果非精确字面量）。
 *
 * 注：读面懒打（member.ts，S2b）保留为兜底——$set 后的新 Abs 会丢标，
 * 读面补打；本分片只做构造点打标这一半。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 235 — Proxy 新鲜实例标打在构造点（不经 Proxy 面读也可判）", () => {
  it("p === t → false（代理与靶不同引用，无需读 Proxy 面）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return p === t;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("p === t（别名传播后，仍不经 Proxy 面读）→ false", () => {
    expect(
      v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); const q = p; return p === t;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("p1 === p2（两个代理）→ false（每次 new Proxy 都是新对象）", () => {
    expect(
      v(wrap(`const t = { a: 1 }; const p1 = new Proxy(t, {}); const p2 = new Proxy(t, {}); return p1 === p2;`)),
    ).toEqual({ ok: true, value: false });
  });

  it("p === p → true（同一代理自反）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return p === p;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("靶自反仍为 true（代理构造不污染靶的新鲜身份）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return t === t;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("无陷阱代理的读面仍走靶（S2b 读面口径不回归）", () => {
    expect(v(wrap(`const t = { a: 1 }; const p = new Proxy(t, {}); return p.a;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("无 get 陷阱时回退读靶、this 绑 receiver（proxy ≠ target）", () => {
    expect(
      v(wrap(`const t = { get a() { return this === t; } }; const p = new Proxy(t, {}); return p.a;`)),
    ).toEqual({ ok: true, value: false });
  });
});
