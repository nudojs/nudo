/**
 * BUG-275：`Object.create(proto)` 的 Abs 此前只记**原型身份**
 * （protoTable）、槽面是空 obj ⇒ L1 shape 契约逐字段对账（只查自有槽）报
 * `missing field`（门禁假红），而宿主（`"a" in o` = true）、TypeScript
 * （结构类型）、引擎自己的 guard / zod / standard 三个产物（HasProperty
 * 语义）**全部接受**同一个值 ⇒ 四个面三个接受、一个拒绝。
 *
 * 修复口径（`builtins/object/methods.ts` 的 `inheritedProtoSlots`）：proto
 * 的自有槽键**镜像**为新对象的 `Slot.inherited` 槽（值折 unknown——原型链
 * 取值仍是精度债，只承诺**存在性**）。继承槽可见于 `$get` / `$in`，
 * 但**不进**自有键视图（Object.keys/values/entries / for-in /
 * CopyDataProperties / JSON）——与原生一致。
 *
 * 宿主 node v26.10.0 对照：
 * `const o = Object.create({a:1})` → `"a" in o` true、`Object.hasOwn(o,"a")`
 * false、`Object.keys(o)` []。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { makeFiles } from "./nudo-constraints.ts";
import { call, val } from "./eval-helpers.ts";

const create = (expr: string) =>
  val(`export function f() { const o = Object.create({ a: 1 }); return ${expr}; }`);

describe("BUG-275：Object.create(proto) 继承 proto 的字段存在性", () => {
  it('"a" in Object.create({a:1}) 折 exact true（HasProperty 口径）', () => {
    expect(create('"a" in o')).toEqual({ ok: true, value: true });
  });

  it("自有键面不得见继承槽（Object.keys/values/entries/for-in）", () => {
    expect(create("JSON.stringify(Object.keys(o))")).toEqual({ ok: true, value: "[]" });
    expect(create("JSON.stringify(Object.values(o))")).toEqual({ ok: true, value: "[]" });
    expect(create("JSON.stringify(Object.entries(o))")).toEqual({ ok: true, value: "[]" });
    // Object.hasOwn 仍是 false（继承 vs 自有）
    expect(create('Object.hasOwn(o, "a")')).toEqual({ ok: true, value: false });
  });

  it("值面维持保守 unknown（只承诺存在性，不冒充确定值）", () => {
    expect(create("o.a")).toEqual({ ok: false, value: undefined });
  });

  it("对照：自有属性对象行为不变", () => {
    expect(
      val(`export function f() { const o = { a: 1 }; return "a" in o; }`),
    ).toEqual({ ok: true, value: true });
    expect(
      val(`export function f() { const o = { a: 1 }; return JSON.stringify(Object.keys(o)); }`),
    ).toEqual({ ok: true, value: '["a"]' });
  });

  it("门禁面：f(Object.create({a:1})) 不再报 missing field（与三个导出产物同结论）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, number, shape } from "@nudojs/core";
export const f = fn({ v: shape({ a: number() }) }, any());`,
    });
    const src = `
export function f(v) {
  return v;
}
export function own() {
  return f({ a: 1 });
}
export function inherited() {
  return f(Object.create({ a: 1 }));
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("门禁面负控制：真缺字段仍报 missing field（不得整面放水）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, number, shape } from "@nudojs/core";
export const f = fn({ v: shape({ a: number() }) }, any());`,
    });
    const src = `
export function f(v) {
  return v;
}
export function bad() {
  return f({});
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBe(1);
    expect(violated[0]!.expected).toContain("missing field v.a");
    expect(r.ok).toBe(false);
  });

  it("null 原型分支不受影响（Object.create(null) 无继承槽）", () => {
    const r = call(
      `export function f() { const o = Object.create(null); return "toString" in o; }`,
    );
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("prim");
    expect(val(`export function f() { const o = Object.create(null); return "a" in o; }`)).toEqual({
      ok: true,
      value: false,
    });
  });
});
