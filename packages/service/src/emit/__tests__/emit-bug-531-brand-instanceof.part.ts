/**
 * Bug 531 —— standard 面的 brand 节点是**恒真**校验器（假绿）。
 *
 * 修前：`case "brand": return;` ⇒ `mkDateOutput({})` / `([])` / `("x")` 全部
 * 放行，而**同一次导出**的 zod 面 `z.instanceof(Date)` 全部拒绝 ⇒ 跨方言相反
 * 裁决。
 *
 * 修后：brand 名落在**全局构造器名单**（与 zod 面 `RUNTIME_GLOBAL_CTOR_NAMES`
 * 同名单）时施加 `value instanceof Ctor` 判据；名单外的 brand（用户类等）没有
 * 运行时判据 ⇒ 仍放行（`schema-generator` 已把它们降级为 `unknown` 并记
 * `dropped`）。
 *
 * 负控制：不可判定的 brand 不得被误拒（无判据 ⇒ 放行）。
 */
import { describe, it, expect } from "vitest";
import { abs, num, type Abs } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

const brandOf = (name: string): Abs =>
  abs({ k: "brand", name, shape: num() }, undefined, undefined, "exact");

describe("Bug 531: standard 面 brand 必须有运行时判据", () => {
  it("库函数版：全局构造器 brand 只放行真实例", () => {
    const { node } = absToSchemaNode(brandOf("Date"));
    expect(validateSchemaNode(node, new Date()).issues).toBeUndefined();
    for (const bad of [{}, [], "x", 0, null]) {
      const r = validateSchemaNode(node, bad);
      expect(r.issues?.[0]?.message).toContain("expected Date");
    }
  });

  it("生成产物版：与 zod 面 z.instanceof(Date) 同判", async () => {
    const { source } = absToStandardSchema(brandOf("Date"), { name: "mkDateOutput" });
    const mod = await loadGeneratedModule(source);
    expect(mod.mkDateOutput!["~standard"].validate(new Date()).issues).toBeUndefined();
    for (const bad of [{}, [], "x", 0]) {
      const r = mod.mkDateOutput!["~standard"].validate(bad);
      expect(r.issues?.[0]?.message).toContain("expected Date");
    }
  });

  it("负控制：名单外的 brand（用户类）无运行时判据 ⇒ 放行", () => {
    const { node, dropped } = absToSchemaNode(brandOf("User"));
    // 投影层已把它降级为 unknown 并记 dropped（可见性由 dropped 台账承担）
    expect(node.k).toBe("unknown");
    expect(dropped.join(" ")).toContain("User");
    expect(validateSchemaNode(node, { anything: 1 }).issues).toBeUndefined();
  });
});
