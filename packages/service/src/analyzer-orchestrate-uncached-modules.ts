/**
 * uncached 路径的模块图组装：dep 内容指纹（computeFnDepSegment）、
 * composeEvalModules + tryRunEval 整文件求值（assembleModuleGraph）与
 * eval 静态诊断（pushEvalStaticDiagnostics）。
 * 自 analyzer-orchestrate-uncached.ts 机械拆出；语义未改。
 */
import {
  DIAG,
  loadModuleDepsFingerprint,
  hashSource,
  type EvalMemberDiag,
} from "@nudojs/core/internal";
import type { FileDirective } from "@nudojs/parser";
import {
  composeEvalModules,
  tryRunEval,
  collectEnvGlobals,
  type ComposedEvalModules,
} from "./eval-run.ts";
import { collectEvalDiagnostics } from "./eval-diagnostics.ts";
import { mockSeedsToAbsMocks, type AbsMockSeeds } from "./mock-abs.ts";
import { defaultLoadModule } from "./load-module.ts";
import {
  buildAbsImportLocalMap,
  callRecordFromAbsCall,
} from "./analyzer-abs-eval.ts";
import type { AnalyzeLoadModule, Diagnostic } from "./analyzer-types.ts";
import type { CallRecord } from "./evaluator/call-record.ts";

/** 模块图组装上报的加载问题（cycle / depth / missing / …） */
export type ModuleGraphIssues = Array<{
  kind:
    | "cycle"
    | "depth"
    | "missing"
    | "missing-export"
    | "exports-unresolved"
    | "unreadable"
    | "json-invalid";
  label: string;
  reason: string;
}>;

export type ModuleGraphResult = {
  /** B 成功跑通本文件 → TypeValue method/property 诊断整类让位（主流程分档用） */
  evalHosted: boolean;
  /** eval 顶层 $callNamed 记录（call@ 合成；TypeValue skip 后的主源） */
  evalTopCallRecords: CallRecord[];
};

/**
 * mock-module **重复声明**族 message 的固定前缀。
 *
 * `mock-module.ts` 造重复声明错误时 message 以此开头
 * （`Duplicate @nudo:mock-module directive for "…" — …`）。
 * `composeEvalModules` 只把 **message** 带出来（`FromMockError.code` 在那一层被丢掉）
 * ⇒ 最终诊断的**码**在本模块按前缀还原（见 {@link mockModuleErrorCode}）。
 */
const MOCK_MODULE_DUPLICATE_PREFIX = "Duplicate @nudo:mock-module directive";

/**
 * mock-module 错误 message → 诊断**码**（码归因）。
 *
 * 两族（与 `mock-module.ts` 的错误分类一一对应）：
 * - **重复声明**（同一 specifier 被声明两次）⇒ `nudo:mock-invalid`
 *   （指令写法有歧义 ⇒ warning；导出表取并集 ⇒ 分析仍然 sound）；
 * - **装载失败 / 点名缺失**（mock 文件缺失、依赖解析失败、mock 没有导出那个名字）
 *   ⇒ `nudo:module-missing`（fail-closed ⇒ error）。
 *
 * 前缀不命中 ⇒ 落 `nudo:module-missing`（与改前口径一致 ⇒ 保守）。
 */
function mockModuleErrorCode(message: string): string {
  return message.startsWith(MOCK_MODULE_DUPLICATE_PREFIX)
    ? DIAG.mockInvalid
    : DIAG.moduleMissing;
}

/**
 * dep 内容指纹段（整文件 evaluator 缓存键与逐函数 fn 缓存键共用）。
 * truncated / 指纹失败 → fail-closed（fnDepSeg = null = 禁缓存）。
 */
export function computeFnDepSegment(
  source: string,
  loadModule: AnalyzeLoadModule | undefined,
  filePath: string,
): { fnDepSeg: string | null; fnDepFailClosed: boolean } {
  // dep 内容指纹（default 与 custom loader 同口径）：全图 BFS 一次，
  // 整文件 evaluator 缓存键（tryRunEval depKey）与逐函数 fn 缓存键共用
  // ——否则 F 个函数 = F 次读盘（R2-5）。truncated / readerr / 指纹失败：
  // 与整文件 noCache 同口径 fail-closed（null = 禁缓存）。
  let fnDepSeg: string | null = "-";
  let fnDepFailClosed = false;
  try {
    const dfp = loadModuleDepsFingerprint(source, loadModule ?? defaultLoadModule, filePath);
    if (dfp.truncated || dfp.readError) {
      fnDepFailClosed = true;
      fnDepSeg = null;
    } else {
      fnDepSeg = hashSource(dfp.fp);
    }
  } catch {
    fnDepFailClosed = true;
    fnDepSeg = null;
  }
  return { fnDepSeg, fnDepFailClosed };
}

export function assembleModuleGraph(args: {
  source: string;
  filePath: string;
  envNames: string[];
  seeds: AbsMockSeeds;
  loadModule?: AnalyzeLoadModule;
  fileDirectives: FileDirective[];
  /** 求值引擎已成功跑通时的 dep 指纹段（tryRunEval depKey） */
  fnDepSeg: string | null;
  diagnostics: Diagnostic[];
  /** 模块加载问题 → 主流程诊断（含 evalModuleIssueKinds 登记） */
  pushModuleIssues: (issues: ModuleGraphIssues | undefined) => void;
  /** memberDiag → 主流程诊断（去重 + 定档） */
  pushMemberDiag: (d: EvalMemberDiag, fallbackLine: number) => void;
}): ModuleGraphResult {
  const {
    source,
    filePath,
    envNames,
    seeds,
    loadModule,
    fileDirectives,
    fnDepSeg,
    diagnostics,
    pushModuleIssues: pushBModuleIssues,
    pushMemberDiag: pushBMemberDiag,
  } = args;
  /** eval 顶层 $callNamed 记录（call@ 合成；TypeValue skip 后的主源） */
  const evalTopCallRecords: CallRecord[] = [];
  /** B 已上报的递归截断函数名（压 TypeValue 叠报） */
  const evalTruncatedFns = new Set<string>();
  /** B 成功跑通本文件 → TypeValue method/property 诊断整类让位 */
  let evalHosted = false;
  // B 模块图：cycle/depth/missing + 顶层 memberDiags（注入 @nudo:mock，
  // 避免缩进 const 调到真 fetch；$callNamed 实参 loc 提供参数级 provenance）
  if (filePath) {
    // 组装走 composeEvalModules 单一入口（与 tryRunEval 同序列）；成功时
    // 整体递给 tryRunEval 复用，消除一次分析内的重复 parse/eval。
    let composed: ComposedEvalModules | undefined;
    try {
      composed = composeEvalModules(source, filePath, {
        envNames,
        seedVars: seeds.seedVars,
        seedFns: seeds.seedFns as never,
        ...(loadModule ? { loadModule } : {}),
        fileDirectives,
      });
      // @nudo:mock-module 应用失败 → 明确诊断（缺文件/缺绑定/重复声明），不静默丢弃
      for (const msg of composed.mockErrors) {
        // 码归因：重复声明 ⇒ nudo:mock-invalid（**不是** nudo:module-missing）
        // ——「重复声明」被说成「模块缺失」是归因错误（码与文案不自洽）。
        const code = mockModuleErrorCode(msg);
        diagnostics.push({
          range: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          // 同码同级（#460 口径）：mock-invalid = 指令写法有歧义 ⇒ warning
          // （不挡门禁，导出表取并集 ⇒ 分析仍然 sound）；
          // module-missing = fail-closed ⇒ error。
          // 与 check 面（check-issues.ts 的 mockFromErrorIssues）同码同级。
          severity: code === DIAG.mockInvalid ? "warning" : "error",
          message: msg,
          code,
        });
      }
      pushBModuleIssues(composed.issues);
    } catch {
      /* 模块图失败交还 TypeValue（tryRunEval 内部自行组装兜底） */
    }
    const evalRun = tryRunEval(source, filePath, {
      envNames,
      mocks: mockSeedsToAbsMocks(seeds),
      ...(loadModule ? { loadModule } : {}),
      depKey: fnDepSeg,
      ...(composed ? { composed } : {}),
    });
    if (evalRun) {
      evalHosted = true;
      if (evalRun.memberDiags?.length) {
        for (const d of evalRun.memberDiags) {
          pushBMemberDiag(d, 1);
        }
      }
      if (evalRun.truncatedFns) {
        for (const fn of evalRun.truncatedFns) evalTruncatedFns.add(fn);
      }
      if (evalRun.calls?.length) {
        const impMap = buildAbsImportLocalMap(source, filePath);
        for (const c of evalRun.calls) {
          evalTopCallRecords.push(callRecordFromAbsCall(c, impMap));
        }
      }
    }
  }
  return { evalHosted, evalTopCallRecords };
}

export function pushEvalStaticDiagnostics(args: {
  source: string;
  envNames: string[];
  seeds: AbsMockSeeds;
  diagnostics: Diagnostic[];
}): void {
  const { source, envNames, seeds, diagnostics } = args;
  /** eval 静态 builtin-unknown 名（压 TypeValue unknown-global 叠报） */
  const evalBuiltinUnknownNames = new Set<string>();
  // 求值引擎静态诊断接管 unreachable + builtin-unknown
  // env/mock 已覆盖的全局不在 builtin-unknown 之列（eval 注入后不再是裸原生调用）
  const evalKnownGlobals = new Set<string>([
    ...Object.keys(collectEnvGlobals(envNames)),
    ...Object.keys(mockSeedsToAbsMocks(seeds)),
  ]);
  const evalDiag = collectEvalDiagnostics(source, evalKnownGlobals);
  for (const ur of evalDiag.unreachable) {
    diagnostics.push({
      range: ur.range,
      severity: "info",
      message: "Code after return/throw statement is unreachable",
      tags: ["unnecessary"],
      code: "nudo-unreachable",
      suggestions: ["Remove the unreachable code after the return/throw statement"],
    });
  }
  for (const b of evalDiag.builtinUnknown) {
    evalBuiltinUnknownNames.add(b.name);
    diagnostics.push({
      range: b.range,
      severity: "warning",
      message: `Built-in API "${b.name}" is not covered by Nudo's type inference`,
      code: DIAG.builtinUnknown,
      suggestions: [
        `Use @nudo:mock to define the type: @nudo:mock ${b.name} = stub().returns(...)`,
        `Or use @nudo:contract return <constraint> to declare the return contract`,
      ],
    });
  }
}
