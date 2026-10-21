/**
 * Bug 1008 —— rest 形参 + 无调用点证据 ⇒ entry@ 兜底只造**一个**占位实参 ⇒
 * `xs.length` 被观测成**字面量 1** ⇒ zod / standard / guard 三个方言把返回值
 * 投影成 `literal(1)` ⇒ 导出的校验器**拒绝被导出函数自己的返回值**（而 dts
 * 面写 `number` ⇒ 四方言互相矛盾）。
 *
 * 根因分两层：
 * - **观测层（越界）**：core 的 `formalParamDisplayNames` 只给 rest 形参一个
 *   名字，不给「变长」信息；service 的 entry@ 兜底据此造**一个**实参 ⇒
 *   观测域被**假窄化**成 1。本片（schema-generator / guard-generator）是
 *   **只读**边界 ⇒ 根因侧已越界上报给主 agent。
 * - **投影层（本片）**：**不确信**的观测（widened / mock / partial /
 *   opaque —— 「没有证据」的占位）里的字面量**不是**出口域 ⇒ 三个方言必须
 *   **放宽**到基类型，而不是逐字投影。
 *
 * 本文件钉住投影层：① 不确信置信度 ⇒ 三方言都放宽；② **确信**置信度
 * （exact）⇒ 字面量精度保留；③ 契约面（pred 通道，term 是 var）⇒ 字面量
 * 精度保留（手写契约的 `lit(42)` 不许被牵连）。
 */
import { describe, it, expect } from "vitest";
import { abs, v, eq, lit, type Abs } from "@nudojs/core";
import { absToSchemaNode, absToSchemaSource } from "../schema-generator.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";

/** 观测到的字面量 1（形状 = number prim） */
const observedLit = (conf: Abs["conf"]): Abs =>
  abs({ k: "prim", type: "number" }, { op: "lit", value: 1 }, undefined, conf);

describe("Bug 1008 — 不确信观测里的字面量不得被钉成出口域", () => {
  it("不确信置信度 ⇒ zod 放宽（不再 z.literal(1)）", () => {
    for (const conf of ["widened", "mock", "partial", "opaque"] as const) {
      const source = absToSchemaSource(observedLit(conf));
      expect(source, conf).not.toBe("z.literal(1)");
      expect(source, conf).toContain("z.number()");
    }
  });

  it("不确信置信度 ⇒ standard 节点放宽（prim 而非 lit）", () => {
    const { node } = absToSchemaNode(observedLit("partial"));
    expect(node).toEqual({ k: "prim", type: "number", refinements: [] });
  });

  it("不确信置信度 ⇒ guard 放宽（不再 data === 1）", () => {
    const g = generateGuardFunctionFromAbs("isWithRestOutput", observedLit("opaque"));
    expect(g).not.toContain("data === 1");
    expect(g).toContain('typeof data === "number"');
  });

  it("放宽记进 dropped 台账（损失可观测）", () => {
    const { dropped } = absToSchemaNode(observedLit("partial"));
    expect(dropped.some((d) => d.includes("widened"))).toBe(true);
  });

  it("负控制：确信置信度（exact）⇒ 字面量精度保留", () => {
    expect(absToSchemaSource(observedLit("exact"))).toBe("z.literal(1)");
    expect(generateGuardFunctionFromAbs("isX", observedLit("exact"))).toContain("data === 1");
  });

  it("负控制：契约面（pred 通道）⇒ 字面量精度保留", () => {
    const contract = abs({ k: "prim", type: "number" }, { op: "var", id: "r" }, eq(v("r"), lit(42)), "exact");
    expect(absToSchemaSource(contract)).toBe("z.literal(42)");
    expect(generateGuardFunctionFromAbs("isY", contract)).toContain("data === 42");
  });
});
