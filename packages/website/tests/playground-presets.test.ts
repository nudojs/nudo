// Playground 预设冒烟门禁：每个预设跑一次真引擎，断言「不抛异常 + 产出非空结果」，
// 旗舰预设再钉关键结果。站点浏览器里跑的是同一套 @nudojs/* 源码，所以这个测试
// 就是「文档站示例不会烂」的守卫（presets.ts 是手写示例，注释里承诺过行为）。
// presets.ts 是纯数据（i18n 文案在 preset-labels.ts），因此无需浏览器/框架环境。
import { describe, it, expect } from "vitest";

import { formatShape } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { presets } from "../src/playground/presets.ts";
import type { Preset } from "../src/playground/types.ts";
import { runPlaygroundCheck, setPlaygroundSidecar } from "../src/playground/engine.ts";
import { discoverCallsites } from "../src/playground/callsites.ts";

/** 与 PlaygroundApp 同一条执行路径：sidecar 模式先注册虚拟侧车，single 模式清空。 */
function runPreset(preset: Preset) {
  if (preset.mode === "single") {
    setPlaygroundSidecar(null, "");
    return { kind: "single" as const, analysis: analyzeFile("/playground.js", preset.code) };
  }
  if (preset.mode === "sidecar") {
    setPlaygroundSidecar(preset.sidecarFile, preset.sidecarCode);
    return { kind: "sidecar" as const, report: runPlaygroundCheck(preset.mainCode) };
  }
  setPlaygroundSidecar(null, "");
  return {
    kind: "callsite" as const,
    result: discoverCallsites(
      preset.libCode,
      preset.testCode,
      preset.exportName,
      preset.paramCount,
    ),
  };
}

const byId = (id: string): Preset => {
  const found = presets.find((p) => p.id === id);
  if (!found) throw new Error(`preset ${id} missing`);
  return found;
};

describe("playground presets run on the real engine", () => {
  it("every preset produces output without throwing", () => {
    const empty: string[] = [];
    for (const preset of presets) {
      const run = runPreset(preset);
      if (run.kind === "single") {
        if (run.analysis.functions.length === 0) empty.push(`${preset.id}: no functions`);
      } else if (run.kind === "sidecar") {
        if (run.report.signatures.length === 0) empty.push(`${preset.id}: no signatures`);
      } else {
        const external = run.result.records.filter((r) => !r.internal);
        if (run.result.error || external.length === 0) {
          empty.push(`${preset.id}: ${run.result.error ?? "no call records"}`);
        }
      }
    }
    expect(empty, `presets with no engine output: ${empty.join("; ")}`).toEqual([]);
  });

  it("preset ids are unique and each preset carries a name and group", () => {
    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of presets) {
      expect(p.name.length, p.id).toBeGreaterThan(0);
      expect(p.group.length, p.id).toBeGreaterThan(0);
    }
  });
});

describe("flagship presets keep their documented behaviour", () => {
  it("refine-positive: the violating call site is reported against the contract", () => {
    const preset = byId("refine-positive");
    if (preset.mode !== "single") throw new Error("preset mode changed");
    setPlaygroundSidecar(null, "");
    const report = runPlaygroundCheck(preset.code);

    const sig = report.signatures.find((s) => s.name === "needsPositive");
    expect(sig, "needsPositive signature missing").toBeTruthy();
    // 契约（@nudo:import positive → number().gt(0)）把签名收窄成带 pred 的 number
    expect(sig?.conf).toBe("path");
    expect(sig?.display).toContain("x > 0");

    const violation = report.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violation, "violating call site not reported").toBeTruthy();
    // 违例按「值 ⊭ 谓词」报告：actual -1 #exact、expected x > 0
    expect(violation?.actual).toBe("-1  #exact");
    expect(violation?.expected).toBe("x > 0");
    expect(violation?.message).toContain("needsPositive[x]");
  });

  it("observe-scale: both call sites fold to literals", () => {
    const preset = byId("observe-scale");
    if (preset.mode !== "single") throw new Error("preset mode changed");
    setPlaygroundSidecar(null, "");
    const analysis = analyzeFile("/playground.js", preset.code);
    const results = analysis.functions.flatMap((fn) => fn.cases.map((c) => formatShape(c.abs)));
    expect(results).toContain("6"); // scale(5)
    expect(results).toContain("1"); // scale(0)
  });

  it("sidecar-scale: the contract tightens the signature and gates the call", () => {
    const preset = byId("sidecar-scale");
    if (preset.mode !== "sidecar") throw new Error("preset mode changed");
    setPlaygroundSidecar(preset.sidecarFile, preset.sidecarCode);
    const report = runPlaygroundCheck(preset.mainCode);

    const sig = report.signatures.find((s) => s.name === "scale");
    expect(sig, "scale signature missing").toBeTruthy();
    // 契约 x > 0 进入代数：返回位显示派生的 (x + 1) > 1
    expect(sig?.display).toContain("(x + 1) > 1");
    expect(sig?.conf).toBe("path");
    const violation = report.issues.find((i) => i.code === "nudo:constraint-violated");
    expect(violation, "sidecar violation not reported").toBeTruthy();
    expect(violation?.expected).toBe("x > 0");
  });

  it("cs-formatname: usage-site calls become precise call@ records", () => {
    const preset = byId("cs-formatname");
    if (preset.mode !== "callsite") throw new Error("preset mode changed");
    const result = discoverCallsites(
      preset.libCode,
      preset.testCode,
      preset.exportName,
      preset.paramCount,
    );
    const external = result.records.filter((r) => !r.internal);
    expect(external.length).toBeGreaterThan(0);
    expect(external.every((r) => r.fnName === preset.exportName)).toBe(true);
    // 使用点收获让原本 any 的参数拿到真实实参形状（示例的卖点）
    expect(result.afterSource.length).toBeGreaterThan(0);
  });
});
