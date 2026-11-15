/**
 * Bug 209 回归：Proxy `has` 陷阱的返回值必须按规范 **ToBoolean**。
 *
 * ES 语义（`[[HasProperty]]` → `ToBoolean(trapResult)`）：
 * `has:()=>0` → false、`has:()=>1` → true、`has:()=>""` → false、
 * `has:()=>null` → false、`has:()=>[]` → true（对象恒真）。
 *
 * 修复前：`$in` 把陷阱的**原始返回值**直接当判定结果（number 0 折「有」、
 * 空串折「有」：wrong-exact——`"a" in p` 与原生相反）。
 *
 * `set` 陷阱的同款 ToBoolean 缺口在 member.ts 的 set 臂（本分片越界 → S3
 * 分片已接线：`rv.ok && !rv.value` → falsy 一律 strict TypeError；
 * containers/arr-index.ts 的下标写 Proxy 臂同款）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 结果字面量值（litValue）——别名（避开 describe 内的 v 遮蔽） */
function v2(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 209 — Proxy has 陷阱返回值 ToBoolean", () => {
  it("has:()=>0 → false（此前折「有」）", () => {
    expect(v(wrap(`const p=new Proxy({},{has:()=>0}); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("has:()=>1 → true", () => {
    expect(v(wrap(`const p=new Proxy({},{has:()=>1}); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("has:()=>\"\" → false（此前折「有」）", () => {
    expect(v(wrap(`const p=new Proxy({},{has:()=>""}); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("has:()=>null → false", () => {
    expect(v(wrap(`const p=new Proxy({},{has:()=>null}); return ("a" in p);`))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("has:()=>[] → true（对象恒真）", () => {
    expect(v(wrap(`const p=new Proxy({},{has:()=>[]}); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：has:()=>true → true", () => {
    expect(v(wrap(`const p=new Proxy({},{has:()=>true}); return ("a" in p);`))).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：无 has 陷阱 → 回退靶语义（普通对象缺席 → false）", () => {
    expect(v(wrap(`const p=new Proxy({},{ }); return ("a" in p);`))).toEqual({ ok: true, value: false });
  });

  it("Proxy set 陷阱返回 falsy 非 false（0/\"\"/null/undefined）→ strict TypeError", () => {
    for (const v of ["0", '""', "null", "undefined"]) {
      const r = call(wrap(`const p=new Proxy({},{set:()=>${v}}); p.x=1; return "nothrow";`), "f");
      expect(r.result.shape.k).toBe("never");
    }
  });

  it("负控制：set 陷阱返回 truthy（true/1）→ 不抛", () => {
    for (const v of ["true", "1"]) {
      expect(v2(wrap(`const p=new Proxy({},{set:()=>${v}}); p.x=1; return "nothrow";`))).toEqual({
        ok: true,
        value: "nothrow",
      });
    }
  });
});
