/**
 * BUG-131 —— 三个运行时产物面把 **symbol 键槽**当**字符串自有字段**发布
 * （`"@@sym#1"` / `"@@iterator"`）⇒ 运行时不存在的属性 + zod / guard 产物恒假
 * （dts 面正确：它认 `slot.symbolKey`）。
 *
 * 运行时真值：`o[Symbol("tag")] = 2` ⇒ `Object.keys(o) === ["a"]`、
 * `hasOwn(o, "@@sym#1") === false`。
 *
 * 修法：`internal-slot.ts` 的判据把 `symbolKey === true` 一律判为不可见
 * （不只是 `internal` 的 symbol 槽，用户自定义 symbol 键同样如此）；
 * zod / standard 在节点层摘槽，guard 在 `denoteGuard` 前摘槽。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, strLit, type Abs } from "@nudojs/core";
import { absToSchemaNode, absToSchemaSource } from "../schema-generator.ts";
import { validateSchemaNode } from "../standard-schema.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";

/** `const o = { a: 1 }; o[Symbol("tag")] = 2;` 的引擎建模 */
const withSymbolProp = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        a: { value: numLit(1) },
        "@@sym#1": { value: numLit(2), symbolKey: true },
      },
    },
    undefined,
    undefined,
    "exact",
  );

/** `{ next(), [Symbol.iterator]() {…} }` 的引擎建模（symbol 槽 + internal 协议槽） */
const makeIterLike = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        next: {
          value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
          internal: true,
        },
        "@@iterator": {
          value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
          symbolKey: true,
        },
      },
    },
    undefined,
    undefined,
    "exact",
  );

describe("BUG-131 — symbol 键槽不得发布成字符串字段", () => {
  it("zod 面不出现 @@sym#1，也不要求该键", () => {
    const source = absToSchemaSource(withSymbolProp());
    expect(source).not.toContain("@@sym#1");
    expect(source).toBe("z.object({ a: z.literal(1) })");
  });

  it("standard 面接受运行时真值（own string keys 只有 a）", () => {
    const { node } = absToSchemaNode(withSymbolProp());
    expect(JSON.stringify(node)).not.toContain("@@sym#1");
    const real: Record<PropertyKey, unknown> = { a: 1 };
    real[Symbol("tag")] = 2;
    expect(validateSchemaNode(node, real).issues).toBeUndefined();
  });

  it("guard 面接受运行时真值（改前 hasOwn '@@sym#1' 恒假）", () => {
    const src = generateGuardFunctionFromAbs("iswithSymbolPropOutput", withSymbolProp());
    expect(src).not.toContain("@@sym#1");
    const js = src
      .replace("(value: unknown): boolean", "(value)")
      .replace("const data = value as Record<string, any>;", "const data = value;")
      .replace("export function ", "function ");
    const guard = new Function(`${js}; return iswithSymbolPropOutput;`)() as (v: unknown) => boolean;
    const real: Record<PropertyKey, unknown> = { a: 1 };
    real[Symbol("tag")] = 2;
    expect(guard(real)).toBe(true);
    // 负控制：缺 a 仍被拒（不是无条件放行）
    expect(guard({ b: 1 })).toBe(false);
  });

  it("迭代器协议槽（symbol + internal）同样不进产物", () => {
    const a = makeIterLike();
    const zodSource = absToSchemaSource(a);
    expect(zodSource).not.toContain("@@iterator");
    const src = generateGuardFunctionFromAbs("ismakeIterOutput", a);
    expect(src).not.toContain("@@iterator");
    const { node } = absToSchemaNode(a);
    expect(JSON.stringify(node)).not.toContain("@@iterator");
  });

  it("台账留痕：被摘掉的 symbol 槽进 dropped", () => {
    const { dropped } = absToSchemaNode(withSymbolProp());
    expect(dropped.join("\n")).toContain("@@sym#1");
  });

  it("负控制：普通字符串槽逐字不变", () => {
    const a = abs(
      { k: "obj", slots: { a: { value: numLit(1) }, b: { value: strLit("x") } } },
      undefined,
      undefined,
      "exact",
    );
    expect(absToSchemaSource(a)).toBe('z.object({ a: z.literal(1), b: z.literal("x") })');
  });
});
