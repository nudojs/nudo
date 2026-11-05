/**
 * Bug 535 —— standard 方言的 `fn` 节点是**恒真**校验器（假绿）。
 *
 * 修前：`case "fn"` 与 unknown / brand / promise 共用放行分支 ⇒ 函数型输出
 * `42` / `null` / `"str"` / `{}` 全部放行，而**同一次导出**的 zod 面
 * `z.function()` 全部拒绝 ⇒ 跨方言相反裁决。
 *
 * 修后：`fn` 节点要求 `typeof value === "function"`（不校验签名，只校验
 * 「是函数」）——与 zod 的 `z.function()` 同口径。
 *
 * 语法面同 Bug 535；`promise` 的接受集口径见 BUG-025（幂等 Promise 判定）。
 */
import { describe, it, expect } from "vitest";
import { abs, num, type Abs } from "@nudojs/core";
import { absToSchemaNode } from "../schema-generator.ts";
import { absToStandardSchema, validateSchemaNode } from "../standard-schema.ts";
import { loadGeneratedModule } from "./fixtures.ts";

/** 函数型 Abs：`{k:"fn"}` 形状（参数表空）。 */
const fnAbs = (): Abs =>
  abs({ k: "fn", params: [] }, undefined, undefined, "exact");

describe("Bug 535: standard 面 fn 节点必须是函数判据", () => {
  it("库函数版：非函数被拒，函数放行", () => {
    const { node } = absToSchemaNode(fnAbs());
    expect(validateSchemaNode(node, () => 1).issues).toBeUndefined();
    for (const bad of [42, null, "str", {}]) {
      const r = validateSchemaNode(node, bad);
      expect(r.issues?.[0]?.message).toContain("expected function");
    }
  });

  it("生成产物版：与 zod 面 z.function() 同判", async () => {
    const { source } = absToStandardSchema(fnAbs(), { name: "makeAdderOutput" });
    const mod = await loadGeneratedModule(source);
    expect(mod.makeAdderOutput!["~standard"].validate((x: number) => x).issues).toBeUndefined();
    for (const bad of [42, null, "str", {}]) {
      const r = mod.makeAdderOutput!["~standard"].validate(bad);
      expect(r.issues?.[0]?.message).toContain("expected function");
    }
  });

  it("promise 节点自 BUG-025 起拒绝裸 thenable（不再放行一切）", () => {
    const { node } = absToSchemaNode(abs({ k: "eff", eff: "promise", inner: num() }, undefined, undefined, "exact"));
    const thenable = { then() {} };
    const bad = validateSchemaNode(node, thenable);
    expect(bad.issues?.[0]?.message).toContain("expected promise");
    const ok = validateSchemaNode(node, Promise.resolve(1));
    expect(ok.issues).toBeUndefined();
  });
});
