/**
 * env 名收集与调用点发现（collectEnvNames / collectCallRecords / expandTestCallbacks）。
 * 自 analyzer-orchestrate.ts 机械拆出。
 *
 * 不变量 / Invariants:
 * - 采集到的记录带**调用现场文件**（`callSiteFile`）——合成 `call@` 见证名
 *   据此做来源限定（两个现场文件同一行调用同一函数不撞名；名字里的行号
 *   落在具名文件里可核对）。本文件求值得到的本地记录没有该字段。
 * - 记录只带行号、不带调用点文件 ⇒ 行号超出被求值文件行数 ⇒ 该调用发生
 *   在**依赖模块**里 ⇒ 不标现场文件（不把别的文件的行说成现场文件的行）。
 */
import { dirname } from "node:path";
import {
  getEvalCallCollector,
  getFnImpl,
  setEvalCallCollector,
  $call,
  unknown as absUnknown,
  type Abs,
  type EvalCallRecord,
} from "@nudojs/core";
import { parse, extractFileDirectives } from "@nudojs/parser";
import { mockSeedsForSource } from "./mock-abs.ts";
import { findProjectConfig } from "./evaluator/config.ts";
import {
  tryRunEval,
} from "./eval-run.ts";
import {
  buildAbsImportLocalMap,
  callRecordFromAbsCall,
} from "./analyzer-abs-eval.ts";
import type { CallRecord } from "./evaluator/call-record.ts";

/**
 * 带「调用现场文件」的调用点记录。
 *
 * 外部（`--from` 使用现场）采集的记录带此字段；本文件求值得到的本地
 * 记录没有。合成 `call@` 见证名用它做**来源限定**——否则两个现场文件
 * 在同一行调用同一函数会撞名（固化后同一函数里出现两个 `call@L2`），
 * 且名字里的行号指向的是**现场文件**的行（在被分析文件里无意义）。
 */
export type CallSiteRecord = CallRecord & { callSiteFile?: string };

export function collectEnvNames(filePath: string, source: string, includeProject: boolean): string[] {
  const ast = parse(source);
  const fileDirectives = extractFileDirectives(ast);
  const fileEnvNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);
  if (!includeProject) return fileEnvNames;
  const projectConfig = findProjectConfig(dirname(filePath));
  const projectEnvNames = projectConfig?.config.env ?? [];
  return [...new Set([...projectEnvNames, ...fileEnvNames])];
}


/**
 * 调用点发现（阶段一）：在"使用现场"文件（测试 / 上层应用）中求值
 * 顶层代码，收集它对（外部模块导出的）函数的调用记录。每条记录带
 * 真实的实参类型与结果类型——后续 analyzeFile 将其注入合成 case，
 * 使被使用方从 entry-only（参数全 unknown）升级为真实调用形态。
 *
 * Abs 路径（TypeValue evaluateProgram 已删）：evalAbsModuleGraph + AbsCallRecord。
 * 只做求值与记录，不产出诊断；求值异常不抛出（使用现场文件可能
 * 依赖未 mock 的全局，收集不到就收集不到，不能拖垮主分析）。
 */
export function collectCallRecords(filePath: string, source: string): CallSiteRecord[] {
  // 统一 B（exec 模式）：顶层调用 + 测试回调展开（it/describe/test 的
  // 回调体才是真实调用点——以 unknown 实参 $call 展开，队列自然处理
  // describe 嵌套）。Abs 通道仅兜底（B 失败/历史语法）。
  if (filePath) {
    try {
      const mocks = mockSeedsForSource(source, {
        fromFile: filePath || undefined,
      });
      const run = tryRunEval(source, filePath, {
        mode: "exec",
        lenientGlobals: true,
        ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
      });
      if (run?.calls?.length) {
        const importLocals = buildAbsImportLocalMap(source, filePath);
        // 标上「调用现场文件」——见证名据此做来源限定（见 CallSiteRecord）。
        //
        // **不得用行数上界猜来源**（Bug 089）：记录只带行号，依赖模块里的
        // 调用（`dep.js` 第 2 行调 `greet`）在「行号 ≤ 现场文件行数」时会被
        // 误贴成现场文件 ⇒ 见证名指到现场文件里根本不是该调用的行（甚至是
        // 注释行），并与现场文件自己的调用**撞名**。
        // 判据改为**核对 AST**：本文件在该位置确实有调用表达式才贴；
        // 核不上 ⇒ 不贴（宁可不加来源限定，也不贴错文件）。
        const sites = callSiteKeys(source);
        return expandTestCallbacks(run.calls).map((r): CallSiteRecord => {
          const rec = callRecordFromAbsCall(r, importLocals);
          if (rec.callLoc === undefined) return rec;
          if (!sites.has(`${rec.callLoc.line}:${rec.callLoc.column}`)) return rec;
          return { ...rec, callSiteFile: filePath };
        });
      }
    } catch {
      /* B 失败 fail-closed */
    }
  }
  // fail-closed：B 失败（历史语法/eval-incapable 构造）→ 无记录（旧 Abs 兜底已删）
  return [];
}

/**
 * 本文件所有调用表达式的位置键 `line:column`（1 基行 / 0 基列，与
 * `CallRecord.callLoc` 同口径）。同时收调用表达式起点与 callee 起点——
 * 记录里的 loc 两者都可能是。解析失败 ⇒ 空集（全部不贴，保守）。
 */
function callSiteKeys(source: string): Set<string> {
  const out = new Set<string>();
  const add = (n: unknown): void => {
    const loc = (n as { loc?: { start?: { line?: number; column?: number } } } | null)?.loc;
    const s = loc?.start;
    if (typeof s?.line === "number" && typeof s.column === "number") {
      out.add(`${s.line}:${s.column}`);
    }
  };
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const o = n as { type?: string; callee?: unknown; [k: string]: unknown };
    if (o.type === "CallExpression") {
      add(o);
      if (o.callee && typeof o.callee === "object") add(o.callee);
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = o[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  try {
    visit(parse(source));
  } catch {
    /* 解析失败 ⇒ 空集 */
  }
  return out;
}

/** 测试回调展开：describe 队列展开（预算 + 对象去重防自注册死循环） */
export function expandTestCallbacks(calls: EvalCallRecord[]): EvalCallRecord[] {
  const out = [...calls];
  const seenDescribe = new Set<object>();
  let cursor = 0;
  let expanded = 0;
  while (cursor < out.length && expanded < 500) {
    const rec = out[cursor++]!;
    if (rec.fnName !== "it" && rec.fnName !== "test" && rec.fnName !== "describe") continue;
    for (const a of rec.args) {
      if (!a || typeof a !== "object" || !("shape" in (a as object))) continue;
      const abs = a as Abs;
      if (abs.shape.k !== "fn") continue;
      if (rec.fnName === "describe") {
        if (seenDescribe.has(abs)) continue;
        seenDescribe.add(abs);
      }
      const impl = getFnImpl(abs);
      const params = impl?.params ?? [];
      // 以 unknown 执行回调体——内部调用点经 EvalCallCollector 追加
      const collected: EvalCallRecord[] = [];
      const prev = getEvalCallCollector();
      setEvalCallCollector((r) => collected.push(r));
      try {
        $call(abs, params.map(() => absUnknown));
      } catch {
        /* 单个回调失败不影响其余 */
      } finally {
        setEvalCallCollector(prev);
      }
      out.push(...collected);
      expanded++;
    }
  }
  return out;
}

const TEST_CALLBACK_NAMES = new Set(["it", "test", "describe"]);

