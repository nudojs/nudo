/**
 * Bug 1027 — 约束 DSL 的**写侧**把 `__proto__` 字段静默吞掉：
 * 普通对象字面量 `{}` 装配字段表 ⇒ `mapped["__proto__"] = {…}` 触发
 * `Object.prototype.__proto__` 的 **setter** ⇒ 字段被写成**原型**而非
 * **自有键** ⇒ 下游 `Object.entries` 读不到 ⇒ 契约被悄悄削弱成空 shape
 * （域放宽到「任意对象」）⇒ 门禁对违约实参**判绿**（假绿）。
 *
 * 修法（切片① 的 DSL 写侧）：字段表一律用**无原型对象**（`Object.create(null)`）
 * 装配 ⇒ `__proto__` 是普通自有键；并加「自有键数」断言（键数不符 ⇒ 报错，
 * 不静默降级）。写侧共四处：`shape` / `partial` / `omit` / `pick`。
 *
 * 覆盖的面：DSL 字段表（构建器层）＋ 契约面（`formatConstraint`）＋ 门禁面
 * （`nudo check` 的 missing field 诊断）。
 * 未覆盖（**别的片的地盘**，见交付报告「越界发现」）：dts / zod 产物面——
 * 那条链上的吞键点是 Abs 投影层（core `constraintToEntryAbs` 的 slots 表、
 * core `projection.ts:330` 的 fields 表、service `dts-generator.ts` 的 slots 表），
 * 不是本条的 DSL 写侧。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { shape, number, partial, omit, pick, formatConstraint, checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

const protoField = (): Record<string, unknown> => ({ ["__proto__"]: number() });

describe("Bug 1027 · shape/partial/omit/pick 写侧不得吞掉 __proto__ 字段", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeRefineDiags();
    takeInterfaceDiags();
  });

  it("shape({ ['__proto__']: number() }) 的字段表含 __proto__ 自有键", () => {
    const s = shape(protoField() as never);
    expect(Object.keys(s.fields ?? {})).toEqual(["__proto__"]);
    expect(Object.hasOwn(s.fields ?? {}, "__proto__")).toBe(true);
  });

  it("partial / omit / pick 转一道后字段仍在（不二次吞键）", () => {
    const base = shape(protoField() as never);
    expect(Object.keys(partial(base).fields ?? {})).toEqual(["__proto__"]);
    expect(Object.keys(omit(base, ["id"]).fields ?? {})).toEqual(["__proto__"]);
    expect(Object.keys(pick(base, ["__proto__"]).fields ?? {})).toEqual(["__proto__"]);
  });

  it("对照组：普通字段名行为不变（不被误伤）", () => {
    const s = shape({ p: number() });
    expect(Object.keys(s.fields ?? {})).toEqual(["p"]);
    expect(Object.keys(partial(s).fields ?? {})).toEqual(["p"]);
    expect(Object.keys(omit(s, ["p"]).fields ?? {})).toEqual([]);
  });

  it("契约面：shape({ __proto__: number() }) 的字段不得消失", () => {
    const shown = formatConstraint(shape(protoField() as never));
    expect(shown).toContain("__proto__");
    expect(shown).not.toContain("shape({  })");
  });

  it("门禁面：f({}) 违反「含 __proto__: number」⇒ 报 missing field（改前判绿）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, number, any } from "@nudojs/core";
export const f = fn({ o: shape({ ["__proto__"]: number() }) }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
export function g() {
  return f({});
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.some((i) => (i.expected ?? "").includes("__proto__"))).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("门禁面：对照组（字段名 p）与 __proto__ 的判定强度一致（都不放行）", () => {
    const { loadModule } = makeFiles({
      "/t/f.nudo.js": `import { fn, shape, number, any } from "@nudojs/core";
export const f = fn({ o: shape({ p: number() }) }, any());`,
    });
    const src = `
export function f(o) {
  return o;
}
export function g() {
  return f({});
}
`;
    const r = checkSource("/t/f.js", src, pTrue, { loadModule, fromFile: "/t/f.js" });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.some((i) => (i.expected ?? "").includes("missing field o.p"))).toBe(true);
  });
});
