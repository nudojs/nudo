/**
 * Bug 533 / Bug 1000 —— standard 方言用 `JSON.stringify` 序列化 schema 节点。
 *
 * 修前：`JSON.stringify(node)` 把 Abs 的 `lit` 节点整个 JSON 化 ⇒
 * - `Infinity` / `-Infinity` **静默变 `null`**（JSON 没有非有限数表示）⇒
 *   生成的校验器**拒绝函数必返的值**（假红）、**放行函数永不返回的 `null`**
 *   （假绿）——导出的 schema 与被导出的函数**完全反向**（Bug 1000）；
 *   报错文案还自相矛盾（「expected null, got null」）。
 * - bigint **直接抛** `TypeError: Do not know how to serialize a BigInt` ⇒
 *   `nudo export --format standard` **整条崩溃、零产物**，`--format all` 下
 *   **四个方言的产物一起丢**（Bug 533）。
 *
 * 修后（产物生成侧，本分片）：节点走**保真序列化**（逐节点写源码文本，绝不
 * 经过 JSON 往返）——`Infinity` / `-Infinity` / `NaN` / `10n` 各有对应源码。
 *
 * 负控制：普通字面量的产物文本与判定不变（`42` 仍写 `"value":42`；NaN 仍按
 * zod 面同口径降级成 `prim number`）。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  constraintToEntryAbs,
  lit,
  numLit,
  v,
  type NudoConstraint,
} from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, absToStandardSchemaModule } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

/** 非有限数字面量的 Abs（term = lit(Infinity)）。 */
const litAbs = (value: number): Abs =>
  abs({ k: "unknown" }, { op: "lit", value }, undefined, "exact");

/** bigint 字面量约束 → entry Abs（走契约投影通道，产出 lit 节点）。 */
const bigintEntryAbs = (): Abs => {
  const c: NudoConstraint = {
    __nudoConstraint: true,
    preds: [{ op: "eq", a: v("n"), b: lit(10n) }],
  };
  return constraintToEntryAbs(c, "n");
};

describe("Bug 533 / 1000: standard 节点的字面量序列化必须保真", () => {
  it("Infinity 不再被写成 null（产物文本层）", () => {
    const { node } = absToSchemaNode(litAbs(Infinity));
    expect(node).toEqual({ k: "lit", value: Infinity });
    const { source } = absToStandardSchema(litAbs(Infinity), { name: "infOutput" });
    expect(source).toContain('"value":Infinity');
    expect(source).not.toContain('"value":null');
  });

  it("Infinity：产物放行真值、拒绝 null（语义层，Bug 1000 的假红/假绿）", async () => {
    const { source } = absToStandardSchema(litAbs(Infinity), { name: "infOutput" });
    const mod = await loadGeneratedModule(source);
    const validate = mod.infOutput!["~standard"].validate;
    expect(validate(Infinity).issues).toBeUndefined();
    const nul = validate(null);
    expect(nul.issues).toBeDefined();
    // 报错文案不得自相矛盾（「expected null, got null」）
    expect(nul.issues?.[0]?.message).toContain("expected Infinity");
    expect(nul.issues?.[0]?.message).not.toContain("expected null");
  });

  it("-Infinity 同样保真", async () => {
    const { source } = absToStandardSchema(litAbs(-Infinity), { name: "negInfOutput" });
    expect(source).toContain('"value":-Infinity');
    const mod = await loadGeneratedModule(source);
    const validate = mod.negInfOutput!["~standard"].validate;
    expect(validate(-Infinity).issues).toBeUndefined();
    expect(validate(Infinity).issues).toBeDefined();
  });

  it("bigint 字面量：序列化不抛（修前整条 export 崩溃、零产物）", async () => {
    const entry = bigintEntryAbs();
    const { node } = absToSchemaNode(entry);
    expect(node).toEqual({ k: "lit", value: 10n });
    // 修前：`JSON.stringify(node)` 在这里抛 TypeError ⇒ 零产物
    let mod: ReturnType<typeof absToStandardSchemaModule>;
    expect(() => {
      mod = absToStandardSchemaModule({ bigOut: entry });
    }).not.toThrow();
    expect(mod!.source).toContain('"value":10n');
    const loaded = await loadGeneratedModule(mod!.source);
    const validate = loaded.bigOut!["~standard"].validate;
    expect(validate(10n).issues).toBeUndefined();
    const bad = validate(10);
    expect(bad.issues).toBeDefined();
    expect(bad.issues?.[0]?.message).toContain("expected 10n");
  });

  it("负控制：普通字面量的产物文本与判定不变", async () => {
    const { source } = absToStandardSchema(numLit(42), { name: "okOutput" });
    expect(source).toContain('"value":42');
    const mod = await loadGeneratedModule(source);
    const validate = mod.okOutput!["~standard"].validate;
    expect(validate(42).issues).toBeUndefined();
    expect(validate(43).issues).toBeDefined();
  });

  it("负控制：NaN 不落成 lit(null)，而是按 zod 面同口径降级并记账", () => {
    const { node, dropped } = absToSchemaNode(litAbs(NaN));
    // 降级（不是 lit(null)）——NaN 字面量在 Abs 里可表示，但 schema 面不投影它
    expect(node).not.toEqual({ k: "lit", value: null });
    expect(dropped.join(" ")).toContain("NaN");
    const { source } = absToStandardSchema(litAbs(NaN), { name: "nanOutput" });
    expect(source).not.toContain('"value":null');
  });
});
