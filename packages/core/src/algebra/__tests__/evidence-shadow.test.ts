/**
 * ADR 0001 阶段 1 · 切片 4.1：发布门影子双读（纯函数侧）。
 *
 * 只钉「两判据的对照口径」与「开关默认关闭」，不切换任何产品判据。
 */
import { describe, it, expect, afterEach } from "vitest";
import { DIAG } from "../diagnostics/diag-codes.ts";
import {
  comparePublishGates,
  setPublishGateShadow,
  takePublishGateShadow,
  recordPublishGateShadow,
} from "../diagnostics/evidence-shadow.ts";

const WHITELIST = [DIAG.contractLoad, DIAG.contractParamMismatch, DIAG.contractConflict];

afterEach(() => setPublishGateShadow(false));

describe("ADR 0001 阶段 1 · 发布门影子双读", () => {
  it("默认关闭：不记录对照", () => {
    recordPublishGateShadow([[{ code: DIAG.contractLoad }]], WHITELIST);
    expect(takePublishGateShadow()).toBeUndefined();
  });

  it("开启后如实记录：非清单码的 degraded 诊断被现有过滤器丢掉（BUG-021）", () => {
    setPublishGateShadow(true);
    recordPublishGateShadow(
      [[{ code: DIAG.contractLoad }, { code: DIAG.internal }, { code: DIAG.unknownInference }]],
      WHITELIST,
    );
    const s = takePublishGateShadow()!;
    expect(s.byCode).toEqual([DIAG.contractLoad]);
    expect(s.lostByCodeFilter).toEqual([DIAG.internal, DIAG.unknownInference]);
    expect(s.semanticIfDeclared).toContain(DIAG.internal);
    expect(s.semanticIfDeclared).toContain(DIAG.contractLoad);
  });

  it("comparePublishGates：多来源去重、无诊断时全空", () => {
    const a = comparePublishGates(
      [[{ code: DIAG.contractConflict }], [{ code: DIAG.contractConflict }, {}]],
      WHITELIST,
    );
    expect(a.byCode).toEqual([DIAG.contractConflict]);
    expect(a.lostByCodeFilter).toEqual([]);
    expect(comparePublishGates([[], []], WHITELIST)).toEqual({
      byCode: [],
      degraded: [],
      lostByCodeFilter: [],
      semanticIfDeclared: [],
    });
  });

  it("按来源分派复用现有诊断码，不新增用户可见码（决议 2）", () => {
    const s = comparePublishGates([[{ code: DIAG.internal }]], WHITELIST);
    expect(s.degraded).toEqual([DIAG.internal]);
    expect(s.semanticIfDeclared).toEqual([DIAG.internal]);
  });
});
