/**
 * eval/exec 波次测试共享 harness（去重自 129+ 份文件内私有副本）。
 *
 * 导入口径：相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree
 * 的 vite8 别名解析会把裸包名落到 dist 旧产物，同 eval-ta-hofs.test.ts）。
 *
 * 本地副本与共享版本语义有差异（额外参数/不同模式）的文件**不强制收编**：
 * 保留本地副本即可，避免行为漂移。
 */
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { $lit } from "../exec/runtime/state.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

/** 转译源并调用导出函数（analyze 模式），返回 CallRecord */
export function call(src: string, fnName = "f", args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args);
}

/** 调用导出函数；JS 字面量实参经 $lit 提升为 Abs（去重自 p0/topic 系列 10 份内联副本） */
export function callLit(src: string, fnName = "f", ...litArgs: unknown[]) {
  return call(src, fnName, litArgs.map((a) => $lit(a as never)));
}

/** 调用结果的字面量值（litValue） */
export function val(src: string, args?: Abs[]) {
  return litValue(call(src, "f", args ?? []).result);
}

/** shape.k === "never" 探针 */
export function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

/** throws 面是 brand 且 name 匹配的探针 */
export function throwsError(t: unknown, name: string): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === name;
}

/** tuple shape 的具体元素（缺 lit 项则整体 undefined） */
export function tupleEls(r: unknown): unknown[] | undefined {
  const a = r as { shape?: { k?: string; elements?: unknown[] } };
  if (!a || typeof a !== "object" || a.shape?.k !== "tuple") return undefined;
  const els = a.shape.elements!.map((e) => {
    const rr = litValue(e as never);
    return rr.ok ? rr.value : undefined;
  });
  if (els.some((e) => e === undefined)) return undefined;
  return els as unknown[];
}

/** obj shape 的槽位字面量（缺 lit 的槽值为 undefined，与 w9 口径一致） */
export function objSlots(r: unknown): Record<string, unknown> | undefined {
  const a = r as { shape?: { k?: string; slots?: Record<string, { value: unknown }> } };
  if (!a || typeof a !== "object" || a.shape?.k !== "obj") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(a.shape.slots ?? {})) {
    const rr = litValue(s.value as never);
    out[k] = rr.ok ? rr.value : undefined;
  }
  return out;
}

/** any 实参运行时效果（may-throw 收集器面，去重后的 kind 列表） */
export function effects(src: string, fnName = "f"): string[] {
  const exports = runTranspiled(src, { mode: "analyze" });
  const eff: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => eff.push(e));
    try {
      callTranspiledExportFull(exports, fnName, [anyAbs]);
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return [...new Set(eff.map((e) => e.kind))];
}
