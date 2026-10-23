/**
 * Bug 1065 —— zod 产物面把 `lit(-0)` 写成 `z.literal(0)` ⇒ **比门禁宽** ⇒ 假绿。
 *
 * 改前：`schemaNodeToZod` 的 `case "lit"` 数字分支用模板串 `z.literal(${v})`
 * ⇒ `String(-0) === "0"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`：
 *
 *   export const fInput = z.object({ o: z.object({ v: z.literal(0) }) });
 *   export const fOutput = z.literal(0);
 *
 * 门禁（`nudo check`）按侧车的 `lit(-0)` 判红、zod 产物却放行 `0`
 * ⇒ 消费方拿到一个**比 CI 门禁宽松**的校验器 ⇒ 假绿。
 *
 * 改后：**保真**写 `z.literal(-0)`（不许静默放宽成 `0`）。
 * ⚠ zod 的 literal 走 `===` 口径 ⇒ `-0` 与 `0` 在运行时**不可区分**
 * ⇒ 该处**已知有损** ⇒ 产物就地标注（消费方看得见），不许无声无息。
 * （zod 的运行时行为本次**未独立复现**——环境无 zod 依赖 ⇒ 本钉只断言
 * **产物文本**，不断言 zod 的运行时接受集。）
 *
 * ⚠ 范围：只改 `schema-generator.ts` 的 `case "lit"` 数字分支。
 */
import { describe, it, expect } from "vitest";
import { abs, type Abs } from "@nudojs/core";
import { absToSchemaSource, absToZodSchemaModule } from "../schema-generator.ts";

const litNeg0: Abs = abs({ k: "prim", type: "number" }, { op: "lit", value: -0 }, undefined, "exact");
const lit42: Abs = abs({ k: "prim", type: "number" }, { op: "lit", value: 42 }, undefined, "exact");

describe("Bug 1065：zod 产物面必须保真写 -0（不许静默放宽成 0）", () => {
  it("lit(-0) 渲染成 z.literal(-0)，不是 z.literal(0)", () => {
    const source = absToSchemaSource(litNeg0);
    expect(source).toContain("z.literal(-0)");
    expect(source).not.toContain("z.literal(0)");
  });

  it("该处标注「已知有损」（zod 的 === 口径区分不了 -0 与 0）", () => {
    expect(absToSchemaSource(litNeg0)).toContain("known lossy");
  });

  it("产物是可执行的 JS，且字面量值确实是 -0（Object.is）", () => {
    const source = absToSchemaSource(litNeg0);
    const z = { literal: (v: unknown) => ({ lit: v }) };
    const out = new Function("z", `return ${source};`)(z) as { lit: unknown };
    expect(Object.is(out.lit, -0)).toBe(true);
  });

  it("模块产物（export --format schema）同样保真", () => {
    const { source } = absToZodSchemaModule({ f: litNeg0 });
    expect(source).toContain("z.literal(-0)");
    expect(source).not.toContain("z.literal(0)");
  });

  it("负控制：普通数字字面量不受牵连（逐字 z.literal(42)，无多余注释）", () => {
    expect(absToSchemaSource(lit42)).toBe("z.literal(42)");
  });
});
