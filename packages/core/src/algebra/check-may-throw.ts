/**
 * L2 入口 may-throw（nudo:entry-may-throw）：entry 求值 / throws 域收集。
 *
 * 从 check.ts 拆出的内聚段：用 any 入口实参求值函数体，捕获 any/nullish
 * 成员访问等 throws 效果；显式 throw 也进 throws 域。B-path 优先，
 * fail-closed（B 失败 → 无 L2 证据）。
 */

import type { Abs } from "./abs.ts";
import { never } from "./abs.ts";
import type { Phi } from "./pred.ts";
import { pTrue } from "./pred.ts";
import { formatShape } from "./format.ts";
import type { PolyFn } from "./generalize.ts";
import type { CheckOptions } from "./check.ts";
import { $invoke, $staticInvoke, withExecPhi } from "./exec/index.ts";
import {
  tryRunTranspiled,
  callTranspiledExportFull,
  runTranspiledOptionsMemoKey,
  type TranspiledCallResult,
  type RunTranspiledOptions,
} from "./exec/run.ts";
import { isNudoThrow } from "./exec/nudo-throw.ts";
import {
  errorTypeAbs,
  setMayThrowCollector,
  runWithMayThrowSession,
  throwAbsToKinds,
  type MayThrowEffect,
} from "./exec/may-throw.ts";
import { MAX_CHECK_MEMO } from "./check-memo.ts";
import type { parseSource } from "./parse-source.ts";

type ParsedFile = ReturnType<typeof parseSource>;

export function collectEntryMayThrows(
  source: string,
  fnName: string,
  g: PolyFn,
  file: ParsedFile,
  phi: Phi,
  opts: CheckOptions = {},
): MayThrowEffect[] {
  const effects: MayThrowEffect[] = [];
  const entryArgs = g.typeParams.map((t) => t.value);
  return runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      // P2-a：L2 throws 求值 B-path 优先（may-throw 效果通道共享
      // recordMayThrow）；fail-closed：B 失败（类方法/转译失败）→ 无 L2
      // throws 证据（ast-eval analyzeFnFull 兜底已删）
      const full = bPathThrowsOf(source, fnName, entryArgs, opts, phi);
      if (!full) return effects;
      // 显式 throw（未被 try 消化）也进 L2
      if (full.throws && full.throws.shape.k !== "never") {
        // sum 拆成多个 kind——禁止 `kind: "TypeError | Error"` 假单名
        for (const tName of throwAbsToKinds(full.throws)) {
          if (!effects.some((e) => e.kind === tName && e.cause.startsWith("throw"))) {
            effects.push({
              kind: tName,
              cause: `throw ${formatShape(full.throws)}`,
            });
          }
        }
      }
    } catch {
      /* 求值失败：已有 nudo:eval-error；L2 不叠报 */
    } finally {
      setMayThrowCollector(null);
    }
    return effects;
  });
}

/** L2 throws 的 B-path 求值：顶层导出直调 + default 别名 + CJS 对象方法 +
 *  类静态方法桥；B 失败 → undefined（fail-closed：无 L2 证据）。 */
const bPathRunMemo = new Map<string, Record<string, unknown>>();
/** B analyze 选项：inject（mocks/env/replace/modules）与 opts.modules 同源合并。
 *  mode 恒为 analyze（inject 不得覆盖）；modules 优先 opts.modules，缺则用 inject.modules。 */
export function bAnalyzeOpts(opts: CheckOptions): RunTranspiledOptions {
  const inject = opts.inject ?? {};
  const modules = opts.modules ?? inject.modules;
  return {
    ...inject,
    mode: "analyze" as const,
    ...(modules ? { modules } : {}),
  };
}
/** 桥接调用：NudoThrow/ReferenceError → throws Abs（与 callTranspiledExportFull 同口径） */
export function invokeAsThrows(fn: () => Abs, phi: Phi = pTrue): TranspiledCallResult {
  try {
    const result = withExecPhi(phi, fn);
    return { result, throws: never };
  } catch (e) {
    if (isNudoThrow(e)) {
      return { result: never, throws: e.absValue };
    }
    if (e instanceof ReferenceError) {
      return { result: never, throws: errorTypeAbs("ReferenceError") };
    }
    throw e;
  }
}
export function bPathThrowsOf(
  source: string,
  fnName: string,
  args: Abs[],
  opts: CheckOptions = {},
  phi: Phi = pTrue,
): TranspiledCallResult | undefined {
  // L2 解耦后两引擎口径一致：any 实参的数组方法调用同样记 may-throw
  //（提升是假设、不消除危险），约束与无约束入口都走 B。
  const runKey = `${source}|${runTranspiledOptionsMemoKey(opts.inject)}|${runTranspiledOptionsMemoKey(opts.modules ? { modules: opts.modules } : undefined)}`;
  if (bPathRunMemo.size >= MAX_CHECK_MEMO) {
    const oldest = bPathRunMemo.keys().next().value;
    if (oldest !== undefined) bPathRunMemo.delete(oldest);
  }
  let exports = bPathRunMemo.get(runKey);
  if (exports === undefined) {
    const run = tryRunTranspiled(source, bAnalyzeOpts(opts));
    if (run === undefined) return undefined;
    exports = run;
    bPathRunMemo.set(runKey, exports);
  }
  const isAbsVal = (v: unknown): v is Abs =>
    !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
  const call = (name: string, callArgs: Abs[]): TranspiledCallResult | undefined => {
    try {
      return callTranspiledExportFull(exports, name, callArgs, phi.op === "true" ? undefined : { phi });
    } catch {
      return undefined;
    }
  };
  try {
    if (fnName in exports) return call(fnName, args);
    // 类静态方法桥（A.m → $staticInvoke 类值）
    if (fnName.includes(".")) {
      const [clsName, methodName] = fnName.split(".", 2);
      const clsAbs = exports[clsName ?? ""];
      if (isAbsVal(clsAbs)) {
        return invokeAsThrows(() => $staticInvoke(clsAbs, methodName ?? "", args), phi);
      }
      return undefined;
    }
    // default 别名（export default function X / CJS 单导出 default）
    if ("default" in exports) {
      const d = exports["default"];
      if (typeof d === "function") return call("default", args);
      if (isAbsVal(d)) {
        if (d.shape.k === "fn") return call("default", args);
        // CJS module.exports = { getName(user){...} }：对象方法桥
        if (d.shape.k === "obj") {
          return invokeAsThrows(() => $invoke(d, fnName, args), phi);
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
