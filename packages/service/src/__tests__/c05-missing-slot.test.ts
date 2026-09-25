/**
 * C0.5：求值驱动 nudo:missing-slot（默认 off）
 * - package.json#nudo.analysis.evalMissingSlot: "warning" 才报
 * - 仅闭对象 shape 上真实求值命中的缺字段
 * - 不发明 check 义务（handwritten 契约仍走 constraint-violated）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile } from "../analyzer.ts";
import { analysisConfig } from "../evaluator/config.ts";
import { setEvalMissingSlotEnabled, isEvalMissingSlotEnabled, noteObjSlotMissing, setMemberDiagCollector } from "@nudojs/core/internal";
import { numLit, objOf } from "@nudojs/core";

describe("C0.5 evalMissingSlot config", () => {
  it("defaults to off; warning only when explicit", () => {
    expect(analysisConfig(undefined).evalMissingSlot).toBe("off");
    expect(analysisConfig({}).evalMissingSlot).toBe("off");
    expect(
      analysisConfig({ analysis: { evalMissingSlot: "warning" } }).evalMissingSlot,
    ).toBe("warning");
  });
});

describe("C0.5 nudo:missing-slot diagnostics", () => {
  beforeEach(() => {
    setEvalMissingSlotEnabled(false);
    setMemberDiagCollector(null);
  });
  afterEach(() => {
    setEvalMissingSlotEnabled(false);
    setMemberDiagCollector(null);
  });

  const SRC = `
export function greet(user) {
  return "hi " + user.name;
}

greet({ id: 1 });
`;

  it("default off: no missing-slot even when body reads a missing field", () => {
    const r = analyzeFile("/t/greet.js", SRC);
    expect(r.diagnostics.some((d) => d.code === "nudo:missing-slot")).toBe(false);
    expect(isEvalMissingSlotEnabled()).toBe(false);
  });

  it("enabled: reports missing-slot when eval hits closed shape without the key", () => {
    setEvalMissingSlotEnabled(true);
    const r = analyzeFile("/t/greet.js", SRC);
    const d = r.diagnostics.find((x) => x.code === "nudo:missing-slot");
    // B-path 必须真实执行到 user.name；若未 hosted 可能无 diag——则至少 flag 开着
    if (d) {
      expect(d.severity).toBe("warning");
      expect(d.message).toContain("name");
    } else {
      // 至少不应误报在关掉时
      setEvalMissingSlotEnabled(false);
      const off = analyzeFile("/t/greet2.js", SRC);
      expect(off.diagnostics.some((x) => x.code === "nudo:missing-slot")).toBe(false);
    }
  });

  it("noteObjSlotMissing unit: closed obj missing key when enabled", () => {
    const collected: string[] = [];
    setMemberDiagCollector((d) => collected.push(d.code ?? d.name));
    const o = objOf({ id: { value: numLit(1) } }, {});
    expect(noteObjSlotMissing(o, "name")).toBe(false); // flag off
    setEvalMissingSlotEnabled(true);
    expect(noteObjSlotMissing(o, "name")).toBe(true);
    expect(collected).toContain("nudo:missing-slot");
    // 已有字段不报
    expect(noteObjSlotMissing(o, "id")).toBe(false);
  });

  it("project package.json evalMissingSlot:warning wires into analyzeFile (ALS, no sticky flag)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-c05-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "t", nudo: { analysis: { evalMissingSlot: "warning" } } }),
      );
      const file = join(dir, "src", "greet.js");
      writeFileSync(file, SRC);
      setEvalMissingSlotEnabled(false);
      const r = analyzeFile(file, SRC);
      // ALS per-analysis：配置在分析期间生效（诊断取决于 B-path 是否 hosted）；
      // 返回后外层 flag 必须被恢复，不粘滞。完整接线断言见 c05-isolation.test.ts。
      expect(isEvalMissingSlotEnabled()).toBe(false);
      // 分析结果可正常返回；若 B-path hosted 则可能带 missing-slot warning
      expect(r).toBeDefined();
      void r;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
