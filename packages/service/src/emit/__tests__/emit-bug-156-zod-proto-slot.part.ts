/**
 * BUG-156 —— zod 产物面把 `__proto__` 槽发布成**必填字段**，但 **zod v4 在 shape
 * 阶段整条跳过该键**（`if (key === "__proto__") continue;`）⇒ 声明的字段**从不被
 * 校验** ⇒ 违约值被静默放行（假绿）+ 与 dts / guard / standard 四面矛盾 +
 * 零 dropped 台账。
 *
 * 修法：把 `__proto__` 槽剔出 `z.object` 的 shape，改用 `.superRefine()` 显式校验
 * **自有数据属性**（`Object.getOwnPropertyDescriptor`）——原型链上的同名 accessor
 * 不算在场（`JSON.parse('{"__proto__": …}')` 建的是自有数据属性）。
 * 不可表达这一损失必须进 `dropped`（有损投影必须可观测）。
 */
import { describe, it, expect } from "vitest";
import { abs, boolLit, numLit, type Abs } from "@nudojs/core";
import { absToSchemaNode, absToSchemaSource, projectAbsToSchema } from "../schema-generator.ts";
import { validateSchemaNode } from "../standard-schema.ts";

/** `{ __proto__: { z: 9 }, own: 2 }`（JSON.parse 口径：自有数据属性） */
const protoObj = (optionalProto = false): Abs => {
  // 对象字面量里的 `__proto__:` 会设**原型**而不是自有槽（同一个 JS 陷阱）⇒
  // 用 defineProperty 建自有槽，与 core 的 `Object.create(null)` 槽表口径一致。
  const slots: Record<string, { value: Abs; optional?: boolean }> = {
    own: { value: numLit(2) },
  };
  Object.defineProperty(slots, "__proto__", {
    value: {
      value: abs({ k: "obj", slots: { z: { value: numLit(9) } } }, undefined, undefined, "exact"),
      ...(optionalProto ? { optional: true } : {}),
    },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return abs({ k: "obj", slots }, undefined, undefined, "exact");
};

/** JSON.parse 造出的「真值」：`__proto__` 是自有数据属性 */
const realValue = (): Record<string, unknown> => JSON.parse('{"__proto__": {"z": 9}, "own": 2}');
/** 违约形态 ①：缺 `__proto__` */
const missing = (): Record<string, unknown> => ({ own: 2 });
/** 违约形态 ②：`__proto__` 值错 */
const wrongValue = (): Record<string, unknown> => JSON.parse('{"__proto__": {"z": 1}, "own": 2}');

describe("BUG-156 — zod 必须真的校验 __proto__ 槽", () => {
  it("shape 里不再出现 __proto__ 键（zod v4 会跳过它 ⇒ 声明了也不校验）", () => {
    const source = absToSchemaSource(protoObj());
    expect(source).not.toContain('["__proto__"]:');
    expect(source).toContain("Object.getOwnPropertyDescriptor(value, \"__proto__\")");
  });

  it("用 .superRefine 校验自有数据属性（缺键 ⇒ required）", () => {
    const source = absToSchemaSource(protoObj());
    expect(source).toContain(".superRefine(");
    expect(source).toContain('code: "custom"');
    expect(source).toContain('path: ["__proto__"]');
    expect(source).toContain('message: "required"');
  });

  it("值校验走内层 schema 的 safeParse（不是整条放行）", () => {
    const source = absToSchemaSource(protoObj());
    expect(source).toContain(".safeParse(desc.value)");
    expect(source).toContain("if (!parsed.success) ctx.addIssue(");
  });

  it("optional 槽：缺席不报错，但值错了仍报错", () => {
    const source = absToSchemaSource(protoObj(true));
    expect(source).not.toContain('message: "required"');
    expect(source).toContain("if (!desc) return;");
    expect(source).toContain("if (!parsed.success) ctx.addIssue(");
  });

  it("台账留痕：__proto__ 的降级进 dropped（不得静默假绿）", () => {
    // 这条损失发生在**渲染层**（节点 → zod 源码）⇒ 台账从 `projectAbsToSchema` 取
    const { dropped } = projectAbsToSchema(protoObj());
    expect(dropped.join("\n")).toContain("__proto__");
    expect(dropped.join("\n")).toContain("superRefine");
  });

  it("standard 面（同一份 Abs）要求自有 __proto__：真值过、缺键/错值不过", () => {
    const { node } = absToSchemaNode(protoObj());
    expect(validateSchemaNode(node, realValue()).issues).toBeUndefined();
    expect(validateSchemaNode(node, missing()).issues?.length).toBeGreaterThan(0);
    expect(validateSchemaNode(node, wrongValue()).issues?.length).toBeGreaterThan(0);
  });

  it("负控制：普通对象不受影响（不生成 superRefine）", () => {
    const plain = abs({ k: "obj", slots: { a: { value: boolLit(true) } } }, undefined, undefined, "exact");
    const source = absToSchemaSource(plain);
    expect(source).toBe("z.object({ a: z.literal(true) })");
    expect(source).not.toContain("superRefine");
  });
});
