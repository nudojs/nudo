/**
 * ABS-02：unknown / any 来源可解释（旁路）。
 *
 * 断言面：
 * - 分类覆盖：budget / missing-env / unsupported / eval-failure /
 *   no-contract / explicit-any / inference-failure；
 * - 去重 + 稳定排序（快照可钉）；
 * - 纯函数：不读全局 collector、不改 Abs / absKey / leq（结构面零依赖）。
 */
import { describe, it, expect } from "vitest";
import {
  buildUnknownExplanations,
  formatUnknownExplanations,
} from "../diagnostics/explain.ts";
import { checkSource, pTrue } from "../index.ts";

describe("ABS-02 buildUnknownExplanations", () => {
  it("覆盖七类来源（eval fallback / budget / issues / signatures）", () => {
    const out = buildUnknownExplanations({
      signatures: [
        { name: "f", paramTypes: ["any", "number"], conf: "partial" },
        { name: "g", paramTypes: ["any"], conf: "exact" },
        { name: "h", paramTypes: [], conf: "opaque" },
      ],
      issues: [
        { code: "nudo:env-unresolved", fn: "f", message: "env missing" },
        { code: "nudo:no-method", fn: "g", message: "no method" },
        { code: "nudo:recursion-truncated", fn: "h", message: "truncated", reason: "cycle" },
      ],
      budget: { truncated: true, reasons: ["depth"], evalReasons: ["calls"] },
      evalFallbacks: [
        { reason: "internal", message: "module threw", origin: "engine", gateFatal: true },
      ],
      contractSourceOf: (fn) => (fn === "g" ? "handwritten" : undefined),
      explicitAnyOf: (fn) => fn === "g",
    });
    const reasons = new Set(out.map((e) => e.reason));
    for (const r of [
      "budget",
      "missing-env",
      "unsupported",
      "eval-failure",
      "no-contract",
      "explicit-any",
      "inference-failure",
    ] as const) {
      expect(reasons.has(r), r).toBe(true);
    }
    // 稳定排序：按 fn → reason → detail
    const keys = out.map((e) => `${e.fn ?? ""}\0${e.reason}\0${e.detail}`);
    expect(keys).toEqual([...keys].sort());
    // 去重：同一 (fn, reason, detail) 只出现一次
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("budget 建议：cycle 明说 @nudo:budget 无用", () => {
    const out = buildUnknownExplanations({
      signatures: [],
      budget: { callReasons: ["cycle"] },
    });
    const budget = out.find((e) => e.reason === "budget");
    expect(budget?.suggestion).toContain("@nudo:budget cannot help");
  });

  it("formatUnknownExplanations：空清单渲染为空串；非空含 reason 与建议", () => {
    expect(formatUnknownExplanations([])).toBe("");
    const text = formatUnknownExplanations([
      { fn: "f", reason: "no-contract", detail: "1 parameter(s) have no contract", suggestion: "add @nudo:contract" },
    ]);
    expect(text.startsWith("unknown / any origins")).toBe(true);
    expect(text).toContain("f  no-contract: 1 parameter(s) have no contract");
    expect(text).toContain("→ add @nudo:contract");
  });

  it("集成：check 报告的 partial 签名被归为 inference-failure（真实观察面）", () => {
    const r = checkSource(
      "/t/x.js",
      `
export function f(x) { return x; }`,
      pTrue,
      { entryThrows: "off" },
    );
    const out = buildUnknownExplanations({
      signatures: r.signatures,
      issues: r.issues,
      budget: r.budget,
    });
    // 无契约入口：形参显示 any ⇒ no-contract（不是推断失败）
    expect(out.some((e) => e.reason === "no-contract" && e.fn === "f")).toBe(true);
    // 签名面 conf 不是 partial / opaque 时不得虚构 inference-failure
    for (const e of out) {
      if (e.fn === "f" && e.reason === "inference-failure") {
        expect(["partial", "opaque"]).toContain(
          r.signatures.find((s) => s.name === "f")?.conf,
        );
      }
    }
  });
});
