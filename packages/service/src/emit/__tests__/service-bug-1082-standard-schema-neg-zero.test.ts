/**
 * Bug 1082 —— standard-schema 生成产物**内联副本**的 `__nudoDescribe` 未处理
 * `-0` ⇒ 与**库函数副本**（`describeValue`）口径分叉。
 *
 * 修前：库函数版给 `expected 1, got -0`；生成产物内联版给 `expected 1, got 0`
 * （`String(-0) === "0"`）⇒ 同一 schema 在「库校验」与「产物自校验」两个面
 * 上给出**不一致的消息**。
 *
 * 同文件三份副本的现状（本用例的判据）：
 * - `describeValue`（库函数版，:107）——已处理 `-0` ✅
 * - `__nudoDescribe`（生成产物内联版，:365）——修前**未**处理 ❌ ⇒ 本次补
 * - `literalValueSource`（字面量序列化，:538）——已处理 `-0` ✅（无需同步）
 *
 * 断言形态：**逐字相同**（两份实现的结果必须完全一致）。
 */
import { describe, it, expect } from "vitest";
import { numLit } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

describe("Bug 1082: 生成产物内联副本必须与库函数版同口径处理 -0", () => {
  it("库函数版与生成产物版对 -0 给出逐字相同的消息", async () => {
    const { node } = absToSchemaNode(numLit(1));
    const { source } = absToStandardSchema(numLit(1), { name: "one" });
    const mod = await loadGeneratedModule(source);

    const lib = validateSchemaNode(node, -0);
    const prod = mod.one!["~standard"].validate(-0);
    // 两份实现逐字一致（修前：库函数 "-0" / 产物 "0" ⇒ 这里挂）
    expect(JSON.stringify(prod)).toBe(JSON.stringify(lib));
    // 且消息必须保真到 -0（字面量保真：-0 与 0 在除法 / Math.sign / Object.is 上可观察）
    expect(prod.issues?.[0]?.message).toContain("got -0");
    expect(lib.issues?.[0]?.message).toContain("got -0");
  });

  it("负控制：期望值本身是 -0 时两份实现都放行（不得把 -0 当成不匹配）", async () => {
    const { node } = absToSchemaNode(numLit(-0));
    const { source } = absToStandardSchema(numLit(-0), { name: "zero" });
    const mod = await loadGeneratedModule(source);

    const lib = validateSchemaNode(node, -0);
    const prod = mod.zero!["~standard"].validate(-0);
    expect(JSON.stringify(prod)).toBe(JSON.stringify(lib));
    expect(prod.issues).toBeUndefined();
  });
});
