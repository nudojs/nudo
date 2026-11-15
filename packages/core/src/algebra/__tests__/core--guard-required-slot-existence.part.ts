/**
 * Bug 409 —— `nudo export --format guard`：**必填槽的存在性检查被丢掉**、
 * `typeof === "object"` **不排除数组** → 守卫放行引擎与 standard-schema 都拒
 * 的值（假绿）。
 *
 * 根因：`packages/core/src/algebra/denote.ts` → `denoteShape` 的 `case "obj"`：
 * ① 槽内层守卫为 `"true"`（`any()` / `unknown`）时**整条键检查（含存在性）
 * 不生成**；② 对象判定只有 `typeof v === "object" && v !== null` ⇒ 数组也匹配。
 *
 * 修法（族 09 裁决）：存在性写成**独立子句**（`Object.hasOwn(v, "a")` /
 * `"a" in v`）；对象判定加 `!Array.isArray(v)`。
 *
 * 本钉覆盖：① 必填槽（内层 `"true"`）的存在性子句；② 数组被排除；
 * ③ 运行时接受/拒绝判定；④ 负控制：可选槽**不产**存在性子句。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, unknown, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

/** obj 形态 Abs */
const objOfSlots = (
  slots: Record<string, { value: Abs; optional?: boolean }>,
): Abs => makeAbs({ k: "obj", slots }, undefined, undefined, "exact");

/** 把守卫表达式当运行时函数跑 */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("Bug 409 — 必填槽存在性是独立子句 + 对象判定排除数组", () => {
  it("内层守卫为 \"true\"（any/unknown）的必填槽仍产存在性子句", () => {
    const g = denoteGuard(objOfSlots({ id: { value: unknown } }), "data");
    expect(g).toContain('Object.hasOwn(data, "id")');
    expect(g).toContain('"id" in data');
  });

  it("对象判定排除数组", () => {
    const g = denoteGuard(objOfSlots({ id: { value: unknown } }), "data");
    expect(g).toContain("!Array.isArray(data)");
  });

  it("运行时：缺键 / 数组被拒，键在场被放行", () => {
    const check = runner(denoteGuard(objOfSlots({ id: { value: unknown } }), "data"));
    expect(check({ id: 1 })).toBe(true);
    expect(check({ id: undefined })).toBe(true);
    expect(check({})).toBe(false);
    expect(check([])).toBe(false);
    expect(check([1])).toBe(false);
    expect(check(new Date(0))).toBe(false);
    expect(check(null)).toBe(false);
    expect(check("x")).toBe(false);
  });

  it("负控制：可选槽不产存在性子句（可选槽本就允许缺键）", () => {
    const g = denoteGuard(
      objOfSlots({ id: { value: unknown, optional: true } }),
      "data",
    );
    expect(g).not.toContain('Object.hasOwn(data, "id")');
    const check = runner(g);
    expect(check({})).toBe(true);
  });
});
