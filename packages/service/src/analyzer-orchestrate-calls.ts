/**
 * env 名收集与调用点发现（collectEnvNames / collectCallRecords / expandTestCallbacks）。
 * 自 analyzer-orchestrate.ts 机械拆出；语义未改。
 */
import { dirname } from "node:path";
import {
  getBCallCollector,
  getFnImpl,
  setBCallCollector,
  $call,
  unknown as absUnknown,
  type Abs,
  type BCallRecord,
} from "@nudojs/core";
import { parse, extractFileDirectives } from "@nudojs/parser";
import { mockSeedsForSource } from "./mock-abs.ts";
import { findProjectConfig } from "./evaluator/config.ts";
import {
  tryRunBPath,
} from "./bpath-run.ts";
import {
  buildAbsImportLocalMap,
  callRecordFromAbsCall,
} from "./analyzer-abs-eval.ts";
import type { CallRecord } from "./evaluator/call-record.ts";

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
export function collectCallRecords(filePath: string, source: string): CallRecord[] {
  // 统一 B（exec 模式）：顶层调用 + 测试回调展开（it/describe/test 的
  // 回调体才是真实调用点——以 unknown 实参 $call 展开，队列自然处理
  // describe 嵌套）。Abs 通道仅兜底（B 失败/历史语法）。
  if (filePath) {
    try {
      const mocks = mockSeedsForSource(source, {
        fromFile: filePath || undefined,
      });
      const run = tryRunBPath(source, filePath, {
        mode: "exec",
        lenientGlobals: true,
        ...(Object.keys(mocks).length > 0 ? { mocks } : {}),
      });
      if (run?.calls?.length) {
        const importLocals = buildAbsImportLocalMap(source, filePath);
        return expandTestCallbacks(run.calls).map((r) => callRecordFromAbsCall(r, importLocals));
      }
    } catch {
      /* B 失败 fail-closed */
    }
  }
  // fail-closed：B 失败（历史语法/B-incapable 构造）→ 无记录（旧 Abs 兜底已删）
  return [];
}

/** 测试回调展开：describe 队列展开（预算 + 对象去重防自注册死循环） */
export function expandTestCallbacks(calls: BCallRecord[]): BCallRecord[] {
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
      // 以 unknown 执行回调体——内部调用点经 BCallCollector 追加
      const collected: BCallRecord[] = [];
      const prev = getBCallCollector();
      setBCallCollector((r) => collected.push(r));
      try {
        $call(abs, params.map(() => absUnknown));
      } catch {
        /* 单个回调失败不影响其余 */
      } finally {
        setBCallCollector(prev);
      }
      out.push(...collected);
      expanded++;
    }
  }
  return out;
}

const TEST_CALLBACK_NAMES = new Set(["it", "test", "describe"]);

