/**
 * C0.5：evalMissingSlot 必须 per-analysis 隔离——flag 不粘滞、不串项目。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setEvalMissingSlotEnabled,
  isEvalMissingSlotEnabled,
  runWithEvalMissingSlot,
} from "@nudojs/core";
import { analyzeFile } from "../analyzer.ts";

describe("C0.5 evalMissingSlot per-analysis isolation", () => {
  it("runWithEvalMissingSlot restores outer flag after body", () => {
    setEvalMissingSlotEnabled(false);
    expect(isEvalMissingSlotEnabled()).toBe(false);
    const inner = runWithEvalMissingSlot(true, () => isEvalMissingSlotEnabled());
    expect(inner).toBe(true);
    expect(isEvalMissingSlotEnabled()).toBe(false);
  });

  it("set API still works for tests that poke the flag directly", () => {
    setEvalMissingSlotEnabled(true);
    expect(isEvalMissingSlotEnabled()).toBe(true);
    setEvalMissingSlotEnabled(false);
    expect(isEvalMissingSlotEnabled()).toBe(false);
  });

  it("analyzeFile with evalMissingSlot off does not stick flag on", () => {
    const src = `
export function readField(o) {
  return o.name;
}
`;
    const r = analyzeFile("c05-off.js", src);
    expect(r.diagnostics.filter((d) => d.code === "nudo:missing-slot")).toEqual([]);
    // analysis finished → flag must not remain true from a prior on analysis
    expect(isEvalMissingSlotEnabled()).toBe(false);
  });

  it("project package.json evalMissingSlot:warning does not leak to next analysis", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-c05-iso-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "t", nudo: { analysis: { evalMissingSlot: "warning" } } }),
      );
      const onSrc = `
export function greet(o) {
  return o.name;
}
greet({ id: 1 });
`;
      const onFile = join(dir, "on.js");
      writeFileSync(onFile, onSrc);
      const rOn = analyzeFile(onFile, onSrc);
      expect(rOn.diagnostics.some((d) => d.code === "nudo:missing-slot")).toBe(true);

      // 下一次分析：无项目配置（默认 off），flag 不得粘滞
      const offSrc = `
export function greet2(o) {
  return o.name;
}
greet2({ id: 1 });
`;
      const offFile = join(tmpdir(), `c05-off-${Date.now()}.js`);
      writeFileSync(offFile, offSrc);
      try {
        const rOff = analyzeFile(offFile, offSrc);
        expect(rOff.diagnostics.filter((d) => d.code === "nudo:missing-slot")).toEqual([]);
        expect(isEvalMissingSlotEnabled()).toBe(false);
      } finally {
        rmSync(offFile, { force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
