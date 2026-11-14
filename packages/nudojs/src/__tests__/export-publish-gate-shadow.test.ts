/**
 * ADR 0001 阶段 1 · 切片 4.1：发布门**留基线**。
 *
 * 本文件逐字钉住「按码白名单」的现行行为，包括 BUG-021 的缺口
 * （`nudo:internal` / `nudo:unknown-inference` 这类降级诊断连上屏都被丢）。
 * 影子开关只输出对照清单、不改结论；切片 4.2 切换判据时，这里的
 * 「零行为变更」断言会按预期变成变更记录，而不是悄悄漂移。
 */
import { describe, it, expect, afterEach } from "vitest";
import { DIAG, setPublishGateShadow, takePublishGateShadow } from "@nudojs/core/internal";
import type { AnalysisResult } from "@nudojs/service";
import {
  collectExportDiagnostics,
  EXPORT_BLOCKING_CODES,
} from "../commands/export/diagnostics.ts";

const SOURCE = `export function f(n) { return n; }`;

function makeOpts(
  diagnostics: Array<{ severity: string; code?: string; message: string; fn?: string }>,
) {
  return {
    filePath: "/t/export-shadow/f.js",
    source: SOURCE,
    result: { diagnostics } as unknown as AnalysisResult,
    effOpts: {},
  };
}

const CONFLICT = { severity: "warning", code: DIAG.contractConflict, message: "conflict" };
const INTERNAL = { severity: "error", code: DIAG.internal, message: "engine has no evidence" };
const UNKNOWN = { severity: "error", code: DIAG.unknownInference, message: "inference failed" };

afterEach(() => setPublishGateShadow(false));

describe("ADR 0001 阶段 1 · export 发布门基线", () => {
  it("现行判据：清单码阻断并上屏，非清单码诊断被丢弃（BUG-021 基线）", () => {
    const diags = collectExportDiagnostics(makeOpts([CONFLICT, INTERNAL, UNKNOWN]));
    expect(diags.blocking).toBe(true);
    expect(diags.entries.map((d) => d.code)).toEqual([DIAG.contractConflict]);
    expect(diags.conflicts).toHaveLength(1);
  });

  it("影子开关默认关闭：无对照记录", () => {
    collectExportDiagnostics(makeOpts([CONFLICT, INTERNAL]));
    expect(takePublishGateShadow()).toBeUndefined();
  });

  it("影子开启后输出分歧清单，发布结论逐字不变", () => {
    const before = collectExportDiagnostics(makeOpts([CONFLICT, INTERNAL, UNKNOWN]));
    setPublishGateShadow(true);
    const after = collectExportDiagnostics(makeOpts([CONFLICT, INTERNAL, UNKNOWN]));
    const shadow = takePublishGateShadow()!;

    expect(shadow.byCode).toEqual([DIAG.contractConflict]);
    expect(shadow.lostByCodeFilter).toEqual([DIAG.internal, DIAG.unknownInference]);
    expect(shadow.semanticIfDeclared).toContain(DIAG.internal);

    expect(after.entries).toEqual(before.entries);
    expect(after.blocking).toBe(before.blocking);
    expect(after.contractLoad).toEqual(before.contractLoad);
    expect(after.conflicts).toEqual(before.conflicts);
  });

  it("清单含契约四族，contract-syntax 不再被静默丢弃（BUG-021）", () => {
    expect(EXPORT_BLOCKING_CODES).toContain(DIAG.contractSyntax);
    const SYNTAX = { severity: "warning", code: DIAG.contractSyntax, message: "malformed" };
    const diags = collectExportDiagnostics(makeOpts([SYNTAX]));
    expect(diags.entries.map((d) => d.code)).toContain(DIAG.contractSyntax);
    expect(diags.blocking).toBe(true);
  });

  it("白名单本身不扩张到非契约族（决议 2 不新增码）", () => {
    expect(EXPORT_BLOCKING_CODES).toEqual([
      DIAG.contractLoad,
      DIAG.contractParamMismatch,
      DIAG.contractConflict,
      DIAG.contractSyntax,
    ]);
  });
});
