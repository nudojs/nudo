/**
 * Bug 555 —— standard 面把 `Infinity` / `-Infinity` 折成 `null`（假红 + 假绿）。
 *
 * 修前：节点里的 `Infinity` 被写成 `null` ⇒ 校验器**拒绝函数唯一可能返回的
 * 值**、**放行函数永不返回的 `null`**；报错文案还自相矛盾（「expected null,
 * got null」——`got` 是 `JSON.stringify(Infinity)` 的产物）。
 *
 * 修后（两半）：
 * - 序列化半（产物生成侧）：节点走**保真序列化**，`Infinity` / `-Infinity` /
 *   `NaN` 各有对应源码文本（不是 JSON 往返）。
 * - 语义半（校验器侧，本分片）：`lit` 比较认非有限数值；消息走**安全描述**
 *   ⇒ 「expected Infinity, got 0」而不是「expected null, got null」。
 *
 * 负控制：普通字面量的消息格式不变（`expected 1, got 0`）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

const litAbs = (value: number): Abs =>
  abs({ k: "unknown" }, { op: "lit", value }, undefined, "exact");

describe("Bug 555: 非有限数值不得被折成 null", () => {
  it("库函数版：Infinity 放行、null / 0 拒绝，消息保真", () => {
    const { node } = absToSchemaNode(litAbs(Infinity));
    expect(validateSchemaNode(node, Infinity).issues).toBeUndefined();
    const nul = validateSchemaNode(node, null);
    expect(nul.issues?.[0]?.message).toContain("expected Infinity");
    expect(nul.issues?.[0]?.message).not.toContain("expected null");
    const zero = validateSchemaNode(node, 0);
    expect(zero.issues?.[0]?.message).toContain("got 0");
  });

  it("生成产物版：Infinity 不再被折成 null", async () => {
    const { source } = absToStandardSchema(litAbs(Infinity), { name: "retInfOutput" });
    // 节点文本必须保住 Infinity（不是 JSON 的 null）
    expect(source).toContain('"value":Infinity');
    expect(source).not.toContain('"value":null');
    const mod = await loadGeneratedModule(source);
    expect(mod.retInfOutput!["~standard"].validate(Infinity).issues).toBeUndefined();
    const nul = mod.retInfOutput!["~standard"].validate(null);
    expect(nul.issues?.[0]?.message).toContain("expected Infinity");
    expect(nul.issues?.[0]?.message).not.toContain("expected null");
  });

  it("负控制：-Infinity 同样保真；普通字面量消息格式不变", async () => {
    const { node } = absToSchemaNode(litAbs(-Infinity));
    expect(validateSchemaNode(node, -Infinity).issues).toBeUndefined();
    const { source } = absToStandardSchema(litAbs(-Infinity), { name: "retNegInfOutput" });
    expect(source).toContain('"value":-Infinity');
    const mod = await loadGeneratedModule(source);
    expect(mod.retNegInfOutput!["~standard"].validate(-Infinity).issues).toBeUndefined();

    const one = absToSchemaNode(numLit(1)).node;
    const r = validateSchemaNode(one, 0);
    expect(r.issues?.[0]?.message).toBe("expected 1, got 0");
  });
});
