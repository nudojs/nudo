/**
 * uncached 路径的 case 合成与 entry 分析：@nudo:case 指令求值
 * （evaluateCaseDirectives）、调用点 case 合成 call@/call@symbolic
 * （synthesizeCallSiteCases）与 entry@ 兜底评估（evaluateEntryCase）。
 * 自 analyzer-orchestrate-uncached.ts 机械拆出；语义未改。
 */
import { dirname } from "node:path";
import type { Node } from "@babel/types";
import {
  anyAbs,
  abs as makeAbsVal,
  formatShape,
  leqAbs,
  localNamedExports,
  effectiveInterface,
  unknown as absUnknown,
} from "@nudojs/core";
import {
  setMayThrowCollector,
  mayThrowEffectsToAbs,
  formatThrowsAbs,
  type MayThrowEffect,
  type EvalMemberDiag,
} from "@nudojs/core/internal";
import type { CaseDirective } from "@nudojs/parser";
import {
  collapseAbsLits,
  neverAbs,
  undefAbs,
  widenJoinAbs,
  type CallRecord,
} from "./evaluator/call-record.ts";
import { mockSeedsToAbsMocks, type AbsMockSeeds } from "./mock-abs.ts";
import { findProjectConfig, interfaceConfig } from "./evaluator/config.ts";
import { defaultLoadModule } from "./load-module.ts";
import { tryEvalCall, tryEvalCallFull } from "./eval-run.ts";
import {
  buildAbsImportLocalMap,
  callRecordFromAbsCall,
  tryEvalAbsFull,
  tryEvalAbsRaw,
  tryEvalEntryAbs,
  tryAttachIntension,
  attachAbsToIntension,
  attachHofSnapshot,
  absIsBetter,
} from "./analyzer-abs-eval.ts";
import { COLLAPSE_LITERAL_THRESHOLD } from "./analyzer-diagnose.ts";
import { extractParamNames, resolveFunctionNode } from "./analyzer-ast.ts";
import type {
  AnalyzeLoadModule,
  CaseHint,
  CaseResult,
  Diagnostic,
  FunctionAnalysis,
  SourceLocation,
} from "./analyzer-types.ts";
import type { Abs } from "@nudojs/core";

/**
 * case 合成 / entry 分析共享的求值环境（uncached 主流程一次组装；
 * diagnostics / caseHints / callRecords 按引用共享，函数内原地追加）。
 */
export type UncachedCaseEnv = {
  source: string;
  filePath: string;
  envNames: string[];
  seeds: AbsMockSeeds;
  loadModule?: AnalyzeLoadModule;
  /** dep 内容指纹段（evaluator 缓存键；模块图组装产物） */
  fnDepSeg: string | null;
  /** B 成功跑通本文件（weak-unknown 放宽判定） */
  evalHosted: boolean;
  selfContained: boolean;
  canAbsModules: boolean;
  pushMemberDiag: (d: EvalMemberDiag, fallbackLine: number) => void;
  diagnostics: Diagnostic[];
  caseHints: CaseHint[];
  callRecords: CallRecord[];
};

/** entry@ 兜底候选（无 @nudo:case 指令函数 + 顶层无指令函数） */
export type SynthCandidate = {
  name: string;
  node: Node;
  analysis: FunctionAnalysis;
  assignedName?: string;
};

/** @nudo:case 指令求值目标（主流程逐函数组装） */
export type CaseDirectiveTarget = {
  name: string;
  fnLoc: SourceLocation;
  analysis: FunctionAnalysis;
  caseDirectives: CaseDirective[];
  caseIdxsToRun: number[];
  activeCaseIdx: number;
};

export function evaluateCaseDirectives(
  env: UncachedCaseEnv,
  fn: CaseDirectiveTarget,
): void {
  const {
    source,
    filePath,
    envNames,
    seeds,
    loadModule,
    fnDepSeg,
    evalHosted,
    selfContained,
    canAbsModules,
    pushMemberDiag: pushBMemberDiag,
    diagnostics,
    caseHints,
    callRecords,
  } = env;
  const { fnLoc, analysis, caseDirectives, caseIdxsToRun, activeCaseIdx } = fn;
    for (const ci of caseIdxsToRun) {
      const directive = caseDirectives[ci]!;

      let caseAbs: Abs | undefined;
      let caseThrowsAbs: Abs | undefined;
      let caseThrowLoc: SourceLocation | undefined;

      if (filePath) {
        const caseArgsAbs = directive.argsAbs;
        const evalFull = tryEvalCallFull(
          source,
          filePath,
          fn.name,
          caseArgsAbs,
          {
            collectCalls: true,
            envNames,
            mocks: mockSeedsToAbsMocks(seeds),
            ...(loadModule ? { loadModule } : {}),
            depKey: fnDepSeg,
          },
        );
        const res = evalFull?.result;
        const weakUnknown =
          !!res &&
          res.shape.k === "unknown" &&
          (!res.term || (res.term.op === "lit" && res.term.value === undefined));
        const evalOk = !!res && (evalHosted || (!weakUnknown && res.conf !== "opaque"));
        if (evalOk && evalFull) {
          caseAbs = evalFull.result;
          caseThrowsAbs = evalFull.throws;
          for (const d of evalFull.memberDiags ?? []) {
            pushBMemberDiag(d, fnLoc.start.line);
          }
          if (evalFull.calls?.length) {
            const impMap = buildAbsImportLocalMap(source, filePath);
            for (const c of evalFull.calls) {
              callRecords.push(callRecordFromAbsCall(c, impMap));
            }
          }
        }
      }

      if (!caseAbs) {
        if (evalHosted) {
          caseAbs = absUnknown;
          caseThrowsAbs = neverAbs;
        } else {
          const caseArgsAbs = directive.argsAbs;
          const absFull = (selfContained || canAbsModules)
            ? tryEvalAbsFull(
                source,
                fn.name,
                caseArgsAbs,
                filePath,
                mockSeedsToAbsMocks(seeds),
              )
            : undefined;
          const weak =
            !!absFull &&
            absFull.result.shape.k === "unknown" &&
            (!absFull.result.term ||
              (absFull.result.term.op === "lit" && absFull.result.term.value === undefined));
          const absOk =
            !!absFull &&
            !weak &&
            absFull.result.conf !== "opaque" &&
            absFull.throws.shape.k === "never";
          const absThrew =
            !!absFull &&
            !weak &&
            absFull.result.shape.k === "never" &&
            absFull.throws.shape.k !== "never";
          if (absOk) {
            caseAbs = absFull.result;
            caseThrowsAbs = neverAbs;
          } else if (absThrew) {
            caseAbs = absFull!.result; // never
            caseThrowsAbs = absFull!.throws;
            const tl = absFull!.throwLoc;
            if (tl) caseThrowLoc = { start: { ...tl }, end: { ...tl } };
          } else {
            caseAbs = absUnknown;
            caseThrowsAbs = neverAbs;
          }
        }
      }
      if (!caseThrowsAbs) caseThrowsAbs = neverAbs;

      const caseEntry: CaseResult = {
        name: directive.name,
        argAbs: directive.argsAbs,
        abs: caseAbs,
        throwsAbs: caseThrowsAbs,
        throwLoc: caseThrowLoc,
        expected: directive.expected,
        source: "directive",
      };
      tryAttachIntension(caseEntry, source, fn.name);
      attachAbsToIntension(caseEntry, caseAbs, fn.name);
      analysis.cases.push(caseEntry);

      if (directive.commentLine) {
        const hasThrow = caseThrowsAbs.shape.k !== "never";
        const resultStr = caseAbs.shape.k !== "never" ? formatShape(caseAbs) : "";
        const throwStr = hasThrow ? `throws ${formatShape(caseThrowsAbs)}` : "";
        const label = [resultStr, throwStr].filter(Boolean).join(" ");
        const hintLabel = `=> ${label}`;

        let ok = true;
        if (directive.expected) {
          ok = leqAbs(caseAbs, directive.expected).ok;
          if (!ok) {
            diagnostics.push({
              range: { start: { line: directive.commentLine, column: 0 }, end: { line: directive.commentLine, column: 999 } },
              severity: "error",
              message: `debug "${directive.name}": expected ${formatShape(directive.expected)}, got ${formatShape(caseAbs)}. The inferred return type does not match the expected type declared in the @nudo:case witness`,
              code: "nudo:case-expected",
            });
          }
        }

        caseHints.push({ line: directive.commentLine, label: hintLabel, ok });
      }

      const isActive = ci === Math.min(activeCaseIdx, caseDirectives.length - 1);

      if (isActive) {
        if (caseThrowsAbs.shape.k !== "never") {
          const throwRange = caseThrowLoc ?? fnLoc;
          diagnostics.push({
            range: throwRange,
            severity: "warning",
            message: `Function "${fn.name}" case "${directive.name}" may throw: ${formatShape(caseThrowsAbs)}. Consider adding a try-catch block or using @nudo:contract return <constraint>`,
            code: "nudo:may-throw",
          });
        }
        // unreachable 诊断已由文件级 collectEvalDiagnostics 统一上报（无 case 级重复扫描）
      }
    }
}

export function synthesizeCallSiteCases(
  env: UncachedCaseEnv,
  candidate: SynthCandidate,
  records: CallRecord[],
  callSiteBudget: number,
): void {
  const { source, filePath, envNames, seeds, loadModule, fnDepSeg, evalHosted } = env;
      // 案例选择偏好：结果有信息量的记录优先（精确/字面量/结构化），
      // unknown 结果的排后——收集顺序里错误路径或 undefined 形态的测试
      // 常排在前面，slice 截断会把 concrete-precise 记录挤掉（hoek clone
      // 的 682 条记录曾由 3 条 undefined 形态占满前 3 席）。
      const informativeness = (r: CallRecord): number => {
        if (r.resultAbs.shape.k === "unknown") return 2;
        if (r.resultAbs.shape.k === "never") return 1;
        return 0;
      };
      const ordered = records
        .map((r, i) => ({ r, i }))
        .sort((a, b) => informativeness(a.r) - informativeness(b.r) || a.i - b.i)
        .map(({ r }) => r);
      const precise = ordered.slice(0, callSiteBudget);
      for (const rec of precise) {
        // Abs 重求值仅在更有信息量时覆盖（不破坏 mock/callsite 精确结构）
        let absRaw: Abs | undefined;
        let absResult: Abs | undefined;
        if (rec.resultAbs.shape.k !== "never" && rec.argAbs.length > 0) {
          absRaw = tryEvalAbsRaw(source, candidate.name, rec.argAbs, filePath, mockSeedsToAbsMocks(seeds));
          if (absRaw) {
            if (absIsBetter(absRaw, rec.resultAbs)) {
              absResult = absRaw;
            }
          }
        }
        // 记录自带的无损结果 Abs：重求值失败/跳过时作兜底（evaluator 产物）
        if (!absRaw && rec.resultAbs.shape.k !== "never") {
          absRaw = rec.resultAbs;
        }
        const caseAbs = absResult ?? rec.resultAbs;
        const caseResult: CaseResult = {
          name: `call@L${rec.callLoc?.line ?? candidate.analysis.loc.start.line}`,
          argAbs: [...rec.argAbs],
          abs: caseAbs,
          throwsAbs: rec.throwsAbs,
          source: "callsite",
        };
        tryAttachIntension(caseResult, source, candidate.name);
        if (absRaw) attachAbsToIntension(caseResult, absRaw, candidate.name);
        candidate.analysis.cases.push(caseResult);
      }
      // symbolic 聚合只用全已知实参的记录：含 unknown 分量的记录不可重求值
      // （unknown 吸收整个 union，一条循环引用 fixture 的记录就能毒化全部
      // 剩余聚合——clone 704 条中的 53 条 unknown 实参曾拖垮其余 651 条）。
      // 排除不声明覆盖，sound；全部不可求值时不产 symbolic case（诚实）。
      const remaining = ordered
        .slice(callSiteBudget)
        .filter((rec) => !rec.argAbs.some((a) => a.shape.k === "unknown" && !a.term));
      if (remaining.length > 0) {
        const fnNode = resolveFunctionNode(candidate.node);
        const paramCount = extractParamNames(fnNode).length;
        const widenedArgsAbs = Array.from({ length: paramCount }, (_, i) =>
          // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
          // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
          widenJoinAbs(remaining.map((rec) => rec.argAbs[i] ?? undefAbs)),
        );
        // 求值引擎优先；否则 Abs 优先
        let symAbs: Abs | undefined;
        if (filePath) {
          const evalSym = tryEvalCall(
            source,
            filePath,
            candidate.name,
            widenedArgsAbs,
            {
              envNames,
              mocks: mockSeedsToAbsMocks(seeds),
              ...(loadModule ? { loadModule } : {}),
              depKey: fnDepSeg,
            },
          );
          if (evalSym && (evalHosted || !(evalSym.shape.k === "unknown" && !evalSym.term))) {
            symAbs = evalSym;
          }
        }
        if (!symAbs && !evalHosted) {
          const absTry = tryEvalAbsRaw(
            source,
            candidate.name,
            widenedArgsAbs,
            filePath,
            mockSeedsToAbsMocks(seeds),
          );
          const weak =
            !!absTry &&
            absTry.shape.k === "unknown" &&
            (!absTry.term || (absTry.term.op === "lit" && absTry.term.value === undefined));
          if (absTry && !weak && absTry.shape.k !== "never" && absTry.conf !== "opaque") {
            symAbs = absTry;
          }
        }
        const symCase: CaseResult = {
          name: "call@symbolic",
          argAbs: widenedArgsAbs,
          // B4：超预算聚合必须 #widened（可解释降级）
          abs: symAbs
            ? { ...symAbs, conf: symAbs.conf === "exact" ? "widened" : symAbs.conf }
            : absUnknown,
          throwsAbs: neverAbs,
          source: "callsite",
          aggregatedFrom: remaining.length,
        };
        tryAttachIntension(symCase, source, candidate.name);
        if (symAbs) attachAbsToIntension(symCase, symAbs, candidate.name);
        candidate.analysis.cases.push(symCase);
      }
      // Combined covers every observed call site (not just the retained
      // cases), so a large set of same-base literal results collapses to
      // the widened base type instead of a 20-literal union.
      candidate.analysis.combinedAbs = collapseAbsLits(
        records.map((r) => r.resultAbs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
}

export function evaluateEntryCase(env: UncachedCaseEnv, candidate: SynthCandidate): void {
  const {
    source,
    filePath,
    envNames,
    seeds,
    loadModule,
    fnDepSeg,
    evalHosted,
    pushMemberDiag: pushBMemberDiag,
    diagnostics,
  } = env;
    const fnNode = resolveFunctionNode(candidate.node);
    // 入口无约束参数 = any（design-cli-semantics §2）；不是 unknown（推导失败）
    const argAbsEntry = extractParamNames(fnNode).map(() => anyAbs);
    // evaluator 唯一求值；失败 fail-closed（entryAbs 保持 undefined）
    let entryAbs: Abs | undefined;
    let entryThrowsAbs: Abs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
    const entryEffects: MayThrowEffect[] = [];
    setMayThrowCollector((e) => entryEffects.push(e));
    try {
      if (filePath) {
        const evalEntryFull =
          tryEvalCallFull(
            source,
            filePath,
            candidate.analysis.name,
            argAbsEntry,
            {
              envNames,
              mocks: mockSeedsToAbsMocks(seeds),
              collectMemberDiags: true,
              ...(loadModule ? { loadModule } : {}),
              depKey: fnDepSeg,
            },
          ) ??
          (candidate.assignedName
            ? tryEvalCallFull(source, filePath, candidate.assignedName, argAbsEntry, {
                envNames,
                mocks: mockSeedsToAbsMocks(seeds),
                ...(loadModule ? { loadModule } : {}),
                depKey: fnDepSeg,
              })
            : undefined);
        if (evalEntryFull?.memberDiags?.length) {
          for (const d of evalEntryFull.memberDiags) {
            pushBMemberDiag(d, candidate.analysis.loc.start.line);
          }
        }
        const evalEntry = evalEntryFull?.result;
        if (evalEntry && (evalHosted || !(evalEntry.shape.k === "unknown" && !evalEntry.term))) {
          entryAbs = evalEntry;
          if (evalEntryFull?.throws) entryThrowsAbs = evalEntryFull.throws;
        }
      }
      if (!entryAbs) {
        if (evalHosted) {
          entryAbs = absUnknown;
          entryThrowsAbs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
        } else {
          const absEntry = tryEvalEntryAbs(source, candidate.analysis.name, argAbsEntry, filePath, seeds.seedVars, candidate.assignedName);
          if (absEntry) {
            // 任何成功求值（含 any 入参透传）都不回落 unknown（design §2）
            entryAbs = absEntry;
            entryThrowsAbs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
          } else {
            // 求值失败才是真 unknown（推导失败），不是入口无约束 any
            entryAbs = absUnknown;
            entryThrowsAbs = makeAbsVal({ k: "never" }, undefined, undefined, "exact");
          }
        }
      }
    } finally {
      setMayThrowCollector(null);
    }
    // throws 域 = hard throw ∪ soft may-throw（any/nullish 成员访问等）
    const softThrows = mayThrowEffectsToAbs(entryEffects);
    if (entryThrowsAbs.shape.k === "never" && softThrows.shape.k !== "never") {
      entryThrowsAbs = softThrows;
    } else if (entryThrowsAbs.shape.k !== "never" && softThrows.shape.k !== "never") {
      // 已有 hard throws 时并入 soft（展示层取并集名）
      const hard = formatThrowsAbs(entryThrowsAbs);
      const soft = formatThrowsAbs(softThrows);
      if (hard && soft && hard !== soft) {
        entryThrowsAbs = makeAbsVal(
          { k: "sum", members: [entryThrowsAbs, softThrows] },
          undefined,
          undefined,
          "exact",
        );
      }
    }
    const caseResult: CaseResult = {
      name: `entry@L${candidate.analysis.loc.start.line}`,
      argAbs: argAbsEntry,
      abs: entryAbs,
      throwsAbs: entryThrowsAbs,
    };
    // display 来自 generalize；attachAbs 补无损 abs 字段（后写覆盖 abs/conf）
    tryAttachIntension(caseResult, source, candidate.analysis.name);
    attachAbsToIntension(caseResult, entryAbs, candidate.analysis.name);
    candidate.analysis.cases.push(caseResult);
    candidate.analysis.entryOnly = true;
    candidate.analysis.combinedAbs = entryAbs;
    attachHofSnapshot(candidate.analysis, source);
    // nudo:interface-entry-only：导出无根且无域（无手写/生成契约 + 无调用点证据）
    try {
      const exportNames = localNamedExports(source);
      const isEntry =
        exportNames.has(candidate.analysis.name) ||
        (candidate.assignedName !== undefined && exportNames.has(candidate.assignedName));
      if (isEntry) {
        const autoBind = interfaceConfig(
          findProjectConfig(dirname(filePath))?.config,
        ).autoBind;
        const eff = effectiveInterface(source, candidate.analysis.name, {
          loadModule: loadModule ?? defaultLoadModule,
          fromFile: filePath,
          ...(autoBind === false ? { autoBind: false } : {}),
        });
        if (!eff) {
          diagnostics.push({
            range: {
              start: candidate.analysis.loc.start,
              end: candidate.analysis.loc.start,
            },
            severity: "info",
            message: `export '${candidate.analysis.name}' has no contract root and no call-site domain (entry-only)`,
            code: "nudo:interface-entry-only",
          });
        }
      }
    } catch {
      /* 诊断不得打断分析 */
    }
}
