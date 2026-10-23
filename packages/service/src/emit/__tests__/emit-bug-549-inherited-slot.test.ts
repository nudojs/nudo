/**
 * Bug 549 —— standard 面「必填槽存在性」用**自有属性**判定（假红）。
 *
 * 修前：`Object.hasOwn(rec, key)` ⇒ 继承来的键被当成**缺键** ⇒ 运行时校验器
 * 比 zod 面与 dts 面（TS 结构类型）**都严** ⇒ 对类型系统接受的值报红。
 *
 * 修后：键存在性用 **HasProperty 语义**（原型链上的用户键算「在场」）**减去**
 * `Object.prototype` 的污染键（`toString` / `constructor` …）——与 zod 面 /
 * TS 结构类型同口径。
 *
 * 负控制：`Object.prototype` 的污染键仍算**缺键**（原型污染不是真实槽）；
 * 「缺键 ≠ 显式 undefined」（BUG-018 语义）不回归。
 */
import { describe, it, expect } from "vitest";
import { abs, num, obj, type Abs } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

/** `{ c: 1 }` 形状的对象 Abs（槽值 = 字面量 1：prim number shape + lit term）。 */
const shapeAbs = (): Abs =>
  abs(
    { k: "obj", slots: { c: { value: abs({ k: "prim", type: "number" }, { op: "lit", value: 1 }, undefined, "exact") } } },
    undefined,
    undefined,
    "exact",
  );

describe("Bug 549: 必填槽存在性用 HasProperty 语义", () => {
  it("库函数版：继承来的键算在场，真缺键报 required", () => {
    const { node } = absToSchemaNode(shapeAbs());
    expect(validateSchemaNode(node, { c: 1 }).issues).toBeUndefined();
    // 继承来的 c（无自有 c）⇒ 在场（zod 面与 TS 结构类型都接受）
    const inherited = validateSchemaNode(node, Object.create({ c: 1 }) as object);
    expect(inherited.issues).toBeUndefined();
    // 真缺键 ⇒ required
    const missing = validateSchemaNode(node, {});
    expect(missing.issues?.[0]?.message).toBe("required");
    expect(missing.issues?.[0]?.path).toEqual(["c"]);
  });

  it("生成产物版：与库函数版同口径", async () => {
    const { source } = absToStandardSchema(shapeAbs(), { name: "mk_x" });
    const mod = await loadGeneratedModule(source);
    expect(mod.mk_x!["~standard"].validate(Object.create({ c: 1 }) as object).issues).toBeUndefined();
    const missing = mod.mk_x!["~standard"].validate({});
    expect(missing.issues?.[0]?.message).toBe("required");
  });

  it("负控制：Object.prototype 污染键算缺键；显式 undefined 仍与缺键有别", () => {
    // 槽名取 "toString"：原型污染键不算在场 ⇒ 报 required（不是「在场且值合法」）
    const polluted = abs(
      {
        k: "obj",
        slots: {
          toString: { value: abs({ k: "prim", type: "string" }, { op: "lit", value: "x" }, undefined, "exact") },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    const { node } = absToSchemaNode(polluted);
    const r = validateSchemaNode(node, {});
    expect(r.issues?.[0]?.message).toBe("required");
    // 显式 undefined 在场 ⇒ 走节点裁决（lit "x" 不匹配 ⇒ 类型错，不是 required）
    const explicit = validateSchemaNode(node, { toString: undefined });
    expect(explicit.issues?.[0]?.message).not.toBe("required");
  });
});
