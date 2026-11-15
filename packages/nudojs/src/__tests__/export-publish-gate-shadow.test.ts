/**
 * ADR 0001 §4 D3：export 发布门 = **语义判据**（不是码表）。
 *
 * 判据：`公开面存在降级证据 ∧ 用户申报过契约 ⇒ 阻断`。
 * 「申报」的真值只来自契约解析本身（签名面 provenance 或契约面诊断），
 * 不读源码字符串、不按阻断码表反推。
 *
 * 本文件同时钉住 BUG-021（`contract-syntax` 此前 exit 0、零上屏）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { DIAG, setPublishGateShadow, takePublishGateShadow } from "@nudojs/core/internal";
import type { AnalysisResult } from "@nudojs/service";
import {
  collectExportDiagnostics,
  EXPORT_BLOCKING_CODES,
} from "../commands/export/diagnostics.ts";

/** 无契约申报：纯推导。 */
const PLAIN = `export function f(n) { return n; }`;
/** 申报合法契约（约束名经 sidecar 导入）。 */
const DECLARED = `/// @nudo:import { num } from "./f.nudo.js"
/**
 * @nudo:contract x num
 */
export function f(x) { return x; }`;
/** 申报但契约写坏（BUG-021）：约束名不是合法约束。 */
const BROKEN = `/**
 * @nudo:contract x number()
 */
export function f(x) { return x; }`;

/** 侧车（`f.nudo.js`）：`num` 的唯一定义处。 */
const SIDECAR = `export const num = number();`;

function makeOpts(
  source: string,
  diagnostics: Array<{ severity: string; code?: string; message: string; fn?: string }>,
) {
  return {
    filePath: "/t/export-shadow/f.js",
    source,
    result: { diagnostics } as unknown as AnalysisResult,
    effOpts: {
      // 侧车装载口与生产同形：只回字符串，不碰磁盘。
      loadModule: (spec: string, from: string): string | undefined =>
        spec === "./f.nudo.js" && from.endsWith("/f.js") ? SIDECAR : undefined,
    },
  };
}

const CONFLICT = { severity: "warning", code: DIAG.contractConflict, message: "conflict" };
const SYNTAX = {
  severity: "warning",
  code: DIAG.contractSyntax,
  message: "Malformed @nudo:contract segment",
};
const INTERNAL = { severity: "error", code: DIAG.internal, message: "engine has no evidence" };
const UNKNOWN = { severity: "error", code: DIAG.unknownInference, message: "inference failed" };

afterEach(() => setPublishGateShadow(false));

describe("ADR 0001 §4 D3 · 语义发布门", () => {
  it("无申报 + 降级证据：上屏但不阻断（纯推导文件不得因推断失败而无法发布）", () => {
    const diags = collectExportDiagnostics(makeOpts(PLAIN, [INTERNAL, UNKNOWN]));
    expect(diags.entries.map((d) => d.code)).toEqual([DIAG.internal, DIAG.unknownInference]);
    expect(diags.blocking).toBe(false);
  });

  it("申报 + 无降级：不阻断（契约正常生效）", () => {
    const diags = collectExportDiagnostics(makeOpts(DECLARED, []));
    expect(diags.blocking).toBe(false);
  });

  it("申报 + 降级证据：阻断（契约在，但公开面掉了保证）", () => {
    const diags = collectExportDiagnostics(makeOpts(DECLARED, [INTERNAL]));
    expect(diags.entries.map((d) => d.code)).toContain(DIAG.internal);
    expect(diags.blocking).toBe(true);
  });

  it("降级归因到申报入口：阻断（同一诊断只换 fn）", () => {
    const diags = collectExportDiagnostics(
      makeOpts(DECLARED, [{ ...UNKNOWN, fn: "f" }]),
    );
    expect(diags.blocking).toBe(true);
  });

  it("降级落在未申报的兄弟入口：上屏但不阻断（文件级契约不连坐）", () => {
    // `read` 用宿主 API 恒 unknown，而契约只申报在 `f` 上 ⇒ 产物不得被无关
    // 入口卡住（否则任何「读文件 + 有契约」的模块都无法 export）。
    const diags = collectExportDiagnostics(
      makeOpts(DECLARED, [{ ...UNKNOWN, fn: "other" }]),
    );
    expect(diags.entries.map((d) => d.code)).toContain(DIAG.unknownInference);
    expect(diags.blocking).toBe(false);
  });

  it("BUG-021：契约解析失败 ⇒ 诊断上屏且阻断（此前 exit 0、零诊断）", () => {
    const diags = collectExportDiagnostics(makeOpts(BROKEN, []));
    const syntax = diags.entries.find((d) => d.code === DIAG.contractSyntax);
    expect(syntax).toBeDefined();
    expect(diags.blocking).toBe(true);
  });

  it("BUG-233：warning 级 contract-conflict 仍阻断（不靠 severity）", () => {
    const diags = collectExportDiagnostics(makeOpts(PLAIN, [CONFLICT]));
    expect(diags.blocking).toBe(true);
    expect(diags.conflicts).toHaveLength(1);
  });

  it("契约族诊断本身就是申报证据：无签名 provenance 也阻断", () => {
    const diags = collectExportDiagnostics(makeOpts(PLAIN, [SYNTAX]));
    expect(diags.blocking).toBe(true);
  });

  it("白名单仍是三族（判定不再依赖它枚举阻断）", () => {
    expect(EXPORT_BLOCKING_CODES).toEqual([
      DIAG.contractLoad,
      DIAG.contractParamMismatch,
      DIAG.contractConflict,
    ]);
  });
});

describe("ADR 0001 阶段 1 · 影子双读不改结论", () => {
  it("默认关闭：无对照记录", () => {
    collectExportDiagnostics(makeOpts(PLAIN, [CONFLICT, INTERNAL]));
    expect(takePublishGateShadow()).toBeUndefined();
  });

  it("开启后输出分歧清单，发布结论逐字不变", () => {
    const before = collectExportDiagnostics(makeOpts(PLAIN, [CONFLICT, INTERNAL, UNKNOWN]));
    setPublishGateShadow(true);
    const after = collectExportDiagnostics(makeOpts(PLAIN, [CONFLICT, INTERNAL, UNKNOWN]));
    const shadow = takePublishGateShadow()!;

    expect(shadow.byCode).toEqual([DIAG.contractConflict]);
    expect(shadow.notBlockedByCode).toEqual([DIAG.internal, DIAG.unknownInference]);
    expect(shadow.semanticIfDeclared).toContain(DIAG.internal);

    expect(after.entries).toEqual(before.entries);
    expect(after.blocking).toBe(before.blocking);
    expect(after.contractLoad).toEqual(before.contractLoad);
    expect(after.conflicts).toEqual(before.conflicts);
  });
});
