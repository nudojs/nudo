/**
 * BUG-096 ——**键存在性**口径三面分裂：zod 面（`z.object` 原生用 `key in data`，
 * 含 `Object.prototype` 成员）放行 `Object.create({ toString: "s" })`，而
 * guard / standard 面判「不在场」（减污染键）⇒ 同一个值三面结论相反。
 *
 * 修法：三面收敛到**同一条规则**——「自有属性 或 原型链上的**用户**键算在场；
 * `Object.prototype` 自身的成员（`toString` / `valueOf` / `constructor` …）不算」：
 * - guard 面 = core `denote.ts` 的 `hasPropertyClause`（子句文本被既有测试钉住）；
 * - standard 面 = `standard-schema.ts` 的 `hasProperty` / 产物 `__nudoHasProperty`；
 * - zod 面 = `schema-generator.ts` 给**必填污染键槽**补的 `.superRefine`
 *   （`z.object` 原生判据没有「减污染键」这一层）。
 *
 * 本钉同时锁住：两面（guard / standard）逐值同裁决 + zod 产物**真的**带上
 * 那条子句（缺了就是修前的缺陷态），且非污染键不额外加 refinement（不误伤）。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { absToSchemaNode, absToSchemaSource } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

/** `{ <key>: <lit> }` 的单槽 obj Abs（必填槽） */
function slotShape(key: string, value: string | number): Abs {
  const primType = typeof value === "number" ? "number" : "string";
  return abs(
    {
      k: "obj",
      slots: {
        [key]: {
          value: abs({ k: "prim", type: primType }, { op: "lit", value }, undefined, "exact"),
        },
      },
    },
    undefined,
    undefined,
    "exact",
  );
}

/** guard 面：`denoteGuard` 生成的表达式真跑 */
function guardOf(a: Abs): (value: unknown) => boolean {
  const expr = denoteGuard(a, "value");
  return new Function("value", `return (${expr});`) as (v: unknown) => boolean;
}

/** standard 面（库函数） */
function stdOk(a: Abs, value: unknown): boolean {
  return validateSchemaNode(absToSchemaNode(a).node, value).issues === undefined;
}

describe("BUG-096: 键存在性三面同口径（HasProperty − Object.prototype 自身成员）", () => {
  it("guard / standard / standard 产物 逐值同裁决（含用户原型上的同名键）", async () => {
    const shape = slotShape("toString", "s");
    const guard = guardOf(shape);
    const { source } = absToStandardSchema(shape, { name: "proto_s" });
    const mod = await loadGeneratedModule(source);
    const product = (v: unknown): boolean =>
      mod.proto_s!["~standard"].validate(v).issues === undefined;

    const cases: Array<[string, unknown, boolean]> = [
      // 自有属性 ⇒ 在场 + 值合法 ⇒ 三面都接受
      ["own", { toString: "s" }, true],
      // 用户原型上的同名键 ⇒ **不算在场**（减污染键规则）⇒ 三面都拒绝
      ["user-proto pollution name", Object.create({ toString: "s" }), false],
      // 真缺键 ⇒ required
      ["missing", {}, false],
      // 在场但值不匹配 ⇒ 拒绝
      ["wrong value", { toString: "x" }, false],
    ];
    for (const [label, value, expected] of cases) {
      expect({ label, guard: guard(value) }, `guard/${label}`).toEqual({
        label,
        guard: expected,
      });
      expect({ label, std: stdOk(shape, value) }, `standard/${label}`).toEqual({
        label,
        std: expected,
      });
      expect({ label, product: product(value) }, `standard-product/${label}`).toEqual({
        label,
        product: expected,
      });
    }
  });

  it("用户原型上的**非**污染键三面都算在场（不误伤 HasProperty 语义）", () => {
    const shape = slotShape("c", 1);
    const guard = guardOf(shape);
    const inherited = Object.create({ c: 1 }) as object;
    expect(guard(inherited)).toBe(true);
    expect(stdOk(shape, inherited)).toBe(true);
    // 缺键仍 required
    expect(guard({})).toBe(false);
    expect(stdOk(shape, {})).toBe(false);
  });

  it("zod 产物：必填污染键槽带上同一条存在性子句（修前完全没有）", () => {
    const polluted = absToSchemaSource(slotShape("toString", "s"));
    expect(polluted).toContain(
      `Object.hasOwn(value, "toString") || ("toString" in value && !Object.hasOwn(Object.prototype, "toString"))`,
    );
    expect(polluted).toContain(`message: "required"`);
    // 负控制：非污染键无需 refinement（zod 原生 `in` 判据已与另两面等价）
    const plain = absToSchemaSource(slotShape("c", 1));
    expect(plain).not.toContain("superRefine");
  });
});
