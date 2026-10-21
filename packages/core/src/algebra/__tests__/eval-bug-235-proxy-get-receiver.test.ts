/**
 * Bug 235 回归：Proxy **没有 get 陷阱**时回退读靶——getter 的 `this` 必须
 * 绑到 **receiver（= proxy）**，不是 target。
 *
 * ES 语义（Proxy [[Get]]）：无 get 陷阱时 `proxy.[[Get]](P, key, Receiver)`
 * 转发 `target.[[Get]](P, key, Receiver)`——Receiver 一路传下去 ⇒ 靶上
 * getter 的 this 是 **proxy**（原生 `p.self`（this === t）折 false）。
 *
 * 修复前：兜底直接 `$get(target, key)`——丢掉 receiver ⇒ getter 的 this
 * 绑到 target ⇒ `this === t` **自信折 true**（原生 false）。
 *
 * 不变量（负控制钉住）：
 * - 有 get 陷阱时陷阱优先（实参 target/key/receiver 不变）；
 * - 直接读靶（不经 proxy）的 getter this 仍是靶（true）；
 * - 无 getter 的普通属性读穿透不变（p.x === 1）；
 * - Proxy 的 set 陷阱路径不受影响。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 235 — Proxy 无 get 陷阱：靶上 getter 的 this 是 proxy", () => {
  it("p.self（this === t）→ false（receiver = proxy）", () => {
    expect(v(wrap(`const t = { get self(){ return this === t; } }; const p = new Proxy(t, {}); return p.self;`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("p.self === p → true（this 就是 proxy 自己）", () => {
    expect(
      v(wrap(`const t = { get self(){ return this; } }; const p = new Proxy(t, {}); return p.self === p;`)),
    ).toEqual({ ok: true, value: true });
  });
});

describe("Bug 235 — 负控制：直接读靶 / 有 get 陷阱 / 普通属性穿透不回归", () => {
  it("直接读靶：t.self（this === t）→ true（this 是靶）", () => {
    expect(v(wrap(`const t = { get self(){ return this === t; } }; return t.self;`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("有 get 陷阱：陷阱优先（实参 target/key/receiver 不变）", () => {
    const src = wrap(
      `const t = { get self(){ return 1; } }; let seen = "?"; const p = new Proxy(t, { get(tg, k, r){ seen = (k === "self") ? "key-ok" : "key-bad"; return 42; } }); return p.self + "/" + seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "42/key-ok" });
  });

  it("无 getter 的普通属性读穿透不变（p.x === 1）", () => {
    expect(v(wrap(`const t = {x:1}; const p = new Proxy(t, {}); return p.x;`))).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("无 getter 的普通属性写穿透不变（p.x = 2 → 靶变）", () => {
    const src = wrap(`const t = {x:1}; const p = new Proxy(t, {}); p.x = 2; return t.x;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
  });

  it("get 陷阱里的 receiver 仍是 proxy（this 语义不变）", () => {
    const src = wrap(
      `const t = {x:1}; let ok = "no"; const p = new Proxy(t, { get(tg, k, r){ ok = (r === p) ? "yes" : "no"; return 1; } }); p.x; return ok;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "yes" });
  });
});
