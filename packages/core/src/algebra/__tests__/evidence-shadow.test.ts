/**
 * ADR 0001 §4 D3：发布门判据的纯函数侧。
 *
 * 钉住三件事：
 * - 降级证据族的判定（含 `contract-syntax`，）；
 * - 影子双读只输出对照清单、不改结论；
 * - 语义判据复用现有诊断码（决议 2，不新增用户可见码）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { DIAG } from "../diagnostics/diag-codes.ts";
import {
  comparePublishGates,
  isDegradedCode,
  setPublishGateShadow,
  takePublishGateShadow,
  recordPublishGateShadow,
} from "../diagnostics/evidence-shadow.ts";

const WHITELIST = [DIAG.contractLoad, DIAG.contractParamMismatch, DIAG.contractConflict];

afterEach(() => setPublishGateShadow(false));

describe("ADR 0001 §4 D3 · 发布门判据", () => {
  it("契约解析失败也是降级证据（BUG-021 的缺口本体）", () => {
    expect(isDegradedCode(DIAG.contractSyntax)).toBe(true);
    expect(isDegradedCode(DIAG.internal)).toBe(true);
    expect(isDegradedCode(DIAG.unknownInference)).toBe(true);
    expect(isDegradedCode(DIAG.contractConflict)).toBe(true);
    // 非证据码不得混入（否则降级面无限扩张）
    expect(isDegradedCode(DIAG.unprovenReturn)).toBe(false);
    expect(isDegradedCode("nudo:totally-unrelated")).toBe(false);
  });

  it("影子默认关闭：不记录对照", () => {
    recordPublishGateShadow([[{ code: DIAG.contractLoad }]], WHITELIST);
    expect(takePublishGateShadow()).toBeUndefined();
  });

  it("开启后如实记录：非清单码的 degraded 诊断不被按码判据阻断", () => {
    setPublishGateShadow(true);
    recordPublishGateShadow(
      [[{ code: DIAG.contractLoad }, { code: DIAG.internal }, { code: DIAG.unknownInference }]],
      WHITELIST,
    );
    const s = takePublishGateShadow()!;
    expect(s.byCode).toEqual([DIAG.contractLoad]);
    expect(s.notBlockedByCode).toEqual([DIAG.internal, DIAG.unknownInference]);
    expect(s.semanticIfDeclared).toContain(DIAG.internal);
    expect(s.semanticIfDeclared).toContain(DIAG.contractLoad);
  });

  it("comparePublishGates：多来源去重、无诊断时全空", () => {
    const a = comparePublishGates(
      [[{ code: DIAG.contractConflict }], [{ code: DIAG.contractConflict }, {}]],
      WHITELIST,
    );
    expect(a.byCode).toEqual([DIAG.contractConflict]);
    expect(a.notBlockedByCode).toEqual([]);
    expect(comparePublishGates([[], []], WHITELIST)).toEqual({
      byCode: [],
      degraded: [],
      notBlockedByCode: [],
      semanticIfDeclared: [],
    });
  });

  it("按来源分派复用现有诊断码，不新增用户可见码（决议 2）", () => {
    const s = comparePublishGates([[{ code: DIAG.internal }]], WHITELIST);
    expect(s.degraded).toEqual([DIAG.internal]);
    expect(s.semanticIfDeclared).toEqual([DIAG.internal]);
  });
});
