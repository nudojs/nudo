/**
 * Bug 508 — `nudo contract --emit` 把**同一条** `nudo:interface-name-clash`
 * 错误**打印两遍**（一次在摘要里、一次在 issues 列表里）。
 *
 * 根因（消费侧）：`formatEmitSummary`（emitter 侧）已经把 `result.issues`
 * 渲染进摘要，CLI 侧又有一段独立的 issue 循环把 error 再渲染一遍 —— 两处
 * **消费同一份 result.issues**，没有去重。
 *
 * 本分片（service/interface-emitter.ts）能落的那一半：
 * - 摘要 = 诊断的**唯一渲染点**：渲染后即**消费** result.issues ⇒ 第二个
 *   渲染点（CLI 的尾部 error-only 循环）自动变空 ⇒ 每条诊断只出一遍；
 * - 同一 (code, message) 只出一行（去重）。
 *
 * 负控制：两条**不同**的诊断都要出（去重不得吞掉真诊断）。
 */
import { describe, it, expect } from "vitest";
import { formatEmitSummary, type EmitInterfaceResult } from "../interface-emitter.ts";

const issue = (code: string, message: string, severity: "error" | "warning" = "error") => ({
  code,
  severity,
  message,
});

const result = (issues: EmitInterfaceResult["issues"]): EmitInterfaceResult => ({
  written: [],
  skipped: [],
  changed: false,
  issues,
  sidecarPath: "/tmp/lib.nudo.js",
});

describe("Bug 508 — emit 诊断只渲染一次", () => {
  it("renders a duplicated issue exactly once", () => {
    const r = result([
      issue("nudo:interface-name-clash", "sidecar already has a handwritten contract 'area'"),
      issue("nudo:interface-name-clash", "sidecar already has a handwritten contract 'area'"),
    ]);
    const lines = formatEmitSummary("lib.js", "lib.nudo.js", r);
    expect(lines.filter((l) => l.includes("nudo:interface-name-clash"))).toHaveLength(1);
  });

  it("keeps distinct issues (dedupe must not swallow real diagnostics)", () => {
    const r = result([
      issue("nudo:interface-name-clash", "clash on 'area'"),
      issue("nudo:interface-multi-declarator", "multi-declarator section kept verbatim", "warning"),
    ]);
    const lines = formatEmitSummary("lib.js", "lib.nudo.js", r);
    expect(lines.filter((l) => l.includes("nudo:interface-name-clash"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("nudo:interface-multi-declarator"))).toHaveLength(1);
  });

  it("consumes the issues after rendering (a second renderer cannot duplicate them)", () => {
    const r = result([issue("nudo:interface-name-clash", "clash on 'area'")]);
    formatEmitSummary("lib.js", "lib.nudo.js", r);
    // 摘要是唯一渲染点：渲染后 issues 已被消费 ⇒ 调用方再遍历也不会重复打印
    expect(r.issues).toEqual([]);
  });
});
