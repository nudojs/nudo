/**
 * L2 入口 may-throw（nudo:entry-may-throw）：entry 求值 / throws 域收集。
 *
 * 从 check.ts 拆出的内聚段：用 any 入口实参求值函数体，捕获 any/nullish
 * 成员访问等 throws 效果；显式 throw 也进 throws 域。evaluator 优先。
 *
 * **类方法桥（Bug 379）**：类分支原先**只有静态方法桥**（`$staticInvoke`）⇒
 * 实例方法拿不到任何 throws 证据 ⇒ L2 门禁对类实例方法**完全无感**（假绿）。
 * 现补**实例方法桥**（类 Abs → `$new` → `$invoke`）；静态/实例按**源码类
 * 声明**判定（运行期无法用返回值区分）。
 *
 * **构造器隔离（Bug 1070）**：实例桥造实例要跑构造器 ⇒ 构造器实参一律补
 * `any` ⇒ 构造器体内的强制转换必产 TypeError ⇒ 那是**构造器**的
 * may-throw（真实调用点传 number 时构造器是 total 的），**不是**方法体的
 * ⇒ 归因到方法入口 = 假红（普通类即触发 error 级 `nudo:entry-may-throw`）。
 * 构造器改在**独立 may-throw 会话**里跑（效果与硬抛都不归因给方法），
 * 方法体自身的证据照常收集。
 *
 * **fail-closed 口径（Bug 380）**：入口**没被分析**（转译器拒绝构造 ⇒ 模块
 * 整体未求值）时，may-throw **不可判定**——不得与「分析出没有 may-throw」
 * 混同（旧口径把二者都当空 effects ⇒ 门禁由红转绿）。此类入口记一条
 * fail-closed 证据（kind=Error：不可判定 ⇒ 入口**可能**抛 Error）。
 */

import type { Abs } from "./abs.ts";
import { abs, never } from "./abs.ts";
import type { Phi } from "./pred.ts";
import { pTrue } from "./pred.ts";
import { formatShape } from "./format.ts";
import type { PolyFn } from "./generalize.ts";
import { ctorParamCountOf } from "./generalize.ts";
import type { CheckOptions } from "./check-types.ts";
import { $invoke, $new, $staticInvoke, withExecPhi } from "./exec/index.ts";
import {
  tryRunTranspiledDetailed,
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
import { resolveExportSlotCall } from "./export-slot.ts";
import { extractDeclaredThrows } from "./refine.ts";
import type { parseSource } from "./parse-source.ts";

type ParsedFile = ReturnType<typeof parseSource>;

/**
 * L2 入口求值的三种结局。
 *
 * - `analyzed`：入口已求值 ⇒ `result.throws` 是 throws 域；
 * - `unanalyzable`：模块**没被分析**（转译器拒绝构造）⇒ may-throw 不可判定；
 * - `absent`：该名字没有桥（不在导出表 / 引擎内部异常）⇒ 无证据。
 */
export type ThrowsOutcome =
  | { kind: "analyzed"; result: TranspiledCallResult }
  | { kind: "unanalyzable"; reason: string; loc?: { line: number; column: number } }
  | { kind: "absent" };

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
      // P2-a：L2 throws 求值 evaluator 优先（may-throw 效果通道共享
      // recordMayThrow）。
      const outcome = evalThrowsOutcome(source, fnName, entryArgs, opts, phi, file);
      if (outcome.kind === "unanalyzable") {
        // Bug 380：转译器拒绝构造 ⇒ 整条 L2 证据缺失 ⇒ 记 fail-closed
        // 证据（kind=Error ⇒ 「入口可能抛 Error」是 sound 的过近似：
        // 未能分析 ⇒ 不能证明入口 total）。用户可用 `@nudo:throws Error`
        // 或 `--ignore-throws Error` 显式放行。
        //
        // 只对**能力边界**（unsupported:*）fail-closed：
        // - module-throw = 程序自己的顶层抛（模块装载失败 ⇒ 原生根本没有
        //   这个入口）⇒ 不是「入口可能抛」的问题（Bug 908 族）；
        // - internal = 引擎缺陷 ⇒ 同上，且不该由门禁面承担。
        //
        // **归因**：转译失败是**模块级**的（一个函数体里的不支持构造让整个
        // 模块未求值）⇒ 若对同模块的**所有**入口都发「可能抛 Error」，那
        // 是**不 sound 的过度断言**（原生下那些入口根本不抛）⇒ 只对**自身
        // 源码跨度内含该构造**的入口发证据。
        if (!unsupportedFallsInside(file, fnName, outcome.loc)) return effects;
        effects.push({
          kind: "Error",
          cause: `entry not analyzed (${outcome.reason}) ⇒ may-throw undeterminable`,
        });
        return effects;
      }
      if (outcome.kind !== "analyzed") return effects;
      const full = outcome.result;
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
      // 求值失败 ⇒ L2 证据缺失（**不叠报** may-throw）。
      //
      // ⚠ **不存在** `nudo:eval-error` 这个诊断码（`DIAG` 注册表无此项、
      // 全仓无发射点）⇒ 该幻影码的文档面已在族 32 / Bug 908 删除；
      // 这里只留事实说明，**不要**再把幻影当既有码引用。
    } finally {
      setMayThrowCollector(null);
    }
    return effects;
  });
}

/** L2 throws 的 evaluator 求值：顶层导出直调 + default 别名 + CJS 对象方法 +
 *  类方法桥（静态 `$staticInvoke` / 实例 `$new`+`$invoke`）。 */
const evalRunMemo = new Map<string, Record<string, unknown>>();
/** B analyze 选项：inject（mocks/env/replace/modules）与 opts.modules 同源合并。
 *  mode 恒为 analyze（inject 不得覆盖）；modules 优先 opts.modules，缺则用 inject.modules。 */
export function evalAnalyzeOpts(opts: CheckOptions): RunTranspiledOptions {
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
/**
 * 入口的**申报式 throws**（`@nudo:throws`）—— 类入口额外看**构造器**的申报。
 *
 * Bug 1096：类导出入口（`new C()`）的构造器在 directive-scan 里的 scope 名是
 * `C.constructor`（类方法 scope 口径）⇒ 按入口名 `C` 查**查不到** ⇒ 用户在
 * 构造器上申报的 `@nudo:throws TypeError` 会被忽略 ⇒ 闸门无从放行 ⇒ 假红
 * （用户已声明仍被卡）。类入口额外查一次构造器 scope 即可闭环。
 *
 * check.ts 的门禁过滤处（`const declared = extractDeclaredThrows(source, name)
 * ?? …`）改调本函数即可。**不**在此处过滤 effects：门禁过滤 ≠ 藏事实
 * （未过滤的 throws 仍要上屏）。
 */
export function declaredThrowsForEntry(
  source: string,
  fnName: string,
): string[] | "*" | undefined {
  const own = extractDeclaredThrows(source, fnName);
  if (own !== undefined) return own;
  // 类入口（无点号的普查名）⇒ 构造器 scope `C.constructor` 兜底
  if (fnName.includes(".")) return undefined;
  return extractDeclaredThrows(source, `${fnName}.constructor`);
}

/**
 * L2 throws 的 evaluator 求值（详细形态）。
 *
 * 三种结局见 {@link ThrowsOutcome}。**Bug 379**：类方法桥补**实例方法**
 * （此前只有静态 `$staticInvoke` ⇒ 实例方法返回 undefined ⇒ 门禁对类实例
 * 方法**完全无感**：显式 throw 的公开方法判 OK / exit 0）。
 *
 * **Bug 380**：转译器拒绝构造 ⇒ 模块整体未求值 ⇒ 结局是 `unanalyzable`
 * （**不是**「分析出没有 may-throw」）。
 *
 * **Bug 1096**：**类导出入口**（`new C()`）—— 构造器的**无条件抛**（硬抛）
 * 是可判定事实 ⇒ 必须进 throws 域（此前实例方法桥 `catch {}` 吞掉 ⇒ 构造器
 * 必抛在 check 闸门与 `nudo test` 见证面**双面不可见** ⇒ CI 闸门假绿）。
 * 口径见 {@link classEntryThrows}。
 */
export function evalThrowsOutcome(
  source: string,
  fnName: string,
  args: Abs[],
  opts: CheckOptions = {},
  phi: Phi = pTrue,
  file?: ParsedFile,
): ThrowsOutcome {
  // L2 解耦后两引擎口径一致：any 实参的数组方法调用同样记 may-throw
  //（提升是假设、不消除危险），约束与无约束入口都走 B。
  const runKey = `${source}|${runTranspiledOptionsMemoKey(opts.inject)}|${runTranspiledOptionsMemoKey(opts.modules ? { modules: opts.modules } : undefined)}`;
  if (evalRunMemo.size >= MAX_CHECK_MEMO) {
    const oldest = evalRunMemo.keys().next().value;
    if (oldest !== undefined) evalRunMemo.delete(oldest);
  }
  let exports = evalRunMemo.get(runKey);
  if (exports === undefined) {
    const attempt = tryRunTranspiledDetailed(source, evalAnalyzeOpts(opts));
    if (attempt.run === undefined) {
      // Bug 380：转译器拒绝构造 ⇒ 整条 L2 证据缺失 ⇒ 显式记「不可判定」。
      // 只有**能力边界**（unsupported:*）走这条：module-throw（程序自己的
      // 顶层抛 ⇒ 原生模块装载失败 ⇒ 根本没有这个入口）与 internal（引擎
      // 缺陷）不是「入口可能抛」的问题 ⇒ 沿用旧口径（无证据）。
      const reason = attempt.fallback?.reason ?? "transpile failed";
      if (reason.startsWith("unsupported:")) {
        const loc = attempt.fallback?.loc;
        return loc
          ? { kind: "unanalyzable", reason, loc }
          : { kind: "unanalyzable", reason };
      }
      return { kind: "absent" };
    }
    exports = attempt.run;
    evalRunMemo.set(runKey, exports);
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
    // Bug 1096：类导出入口（`new C()`）—— 构造器实参补 any 后**硬抛**
    // （= 无条件 throw）⇒ 那是 `new C()` 这个**真实入口**的 may-throw ⇒
    // 必须进 throws 域（否则构造器必抛在 check 闸门上完全不可见 ⇒ 假绿）。
    // 软效果（any 补位的强制转换，Bug 1070 口径）**不进** ⇒ 普通类不触发
    // error 级 `nudo:entry-may-throw`（不假红）。
    if (!fnName.includes(".")) {
      const clsAbs = classAbsOf(exports, file, fnName);
      if (isAbsVal(clsAbs) && isClassValueAbs(clsAbs)) {
        return {
          kind: "analyzed",
          result: classEntryThrows(clsAbs as Abs, file, fnName, phi),
        };
      }
    }
    // own-property：`in` 走原型链，toString/constructor 等继承名会被当真实导出
    if (Object.hasOwn(exports, fnName)) {
      const r = call(fnName, args);
      return r ? { kind: "analyzed", result: r } : { kind: "absent" };
    }
    // 类方法桥（A.m → 静态 $staticInvoke / 实例 $new + $invoke）
    if (fnName.includes(".")) {
      const [clsName, methodName] = fnName.split(".", 2);
      const clsAbs = classAbsOf(exports, file, clsName ?? "");
      if (isAbsVal(clsAbs)) {
        // Bug 379：静态 vs 实例按**源码类声明**判定（判不出 → 静态，
        // 与既有口径同）。静态桥对实例方法只会折 unknown（不抛）⇒
        // 实例方法此前永远拿不到 throws 证据。
        if (classMethodIsStatic(file, clsName ?? "", methodName ?? "") === false) {
          return {
            kind: "analyzed",
            result: invokeAsThrows(() => {
              const inst = instanceForMethodBridge(
                clsAbs,
                clsName ?? "",
                ctorAnyArgs(file, clsName ?? ""),
              );
              return $invoke(inst, methodName ?? "", args);
            }, phi),
          };
        }
        return {
          kind: "analyzed",
          result: invokeAsThrows(() => $staticInvoke(clsAbs, methodName ?? "", args), phi),
        };
      }
      return { kind: "absent" };
    }
    // default 别名（export default function X / CJS 单导出 default）
    if ("default" in exports) {
      const d = exports["default"];
      if (typeof d === "function") {
        const r = call("default", args);
        return r ? { kind: "analyzed", result: r } : { kind: "absent" };
      }
      if (isAbsVal(d)) {
        if (d.shape.k === "fn") {
          const r = call("default", args);
          return r ? { kind: "analyzed", result: r } : { kind: "absent" };
        }
        // CJS module.exports = { getName(user){...} }：对象方法桥
        if (d.shape.k === "obj") {
          return {
            kind: "analyzed",
            result: invokeAsThrows(() => $invoke(d, fnName, args), phi),
          };
        }
      }
    }
    return { kind: "absent" };
  } catch {
    return { kind: "absent" };
  }
}

/**
 * evalThrowsOf（薄封装）：只给「已分析」的 throws 结果，其余 → undefined。
 *
 * 保留旧签名面（既有调用方 / 测试按 undefined 判「无证据」）。
 */
export function evalThrowsOf(
  source: string,
  fnName: string,
  args: Abs[],
  opts: CheckOptions = {},
  phi: Phi = pTrue,
  file?: ParsedFile,
): TranspiledCallResult | undefined {
  const outcome = evalThrowsOutcome(source, fnName, args, opts, phi, file);
  return outcome.kind === "analyzed" ? outcome.result : undefined;
}

/** 类 Abs 取值（导出槽兜底：`export default class C` 的类只挂在 default 槽） */
function classAbsOf(
  exports: Record<string, unknown>,
  file: ParsedFile | undefined,
  clsName: string,
): unknown {
  const slot = file ? resolveExportSlotCall(file, clsName, exports) : undefined;
  if (slot && slot.kind !== "cjs-member") return exports[slot.key];
  return exports[clsName];
}

/**
 * 类**值**（构造器本身）判定：brand + `ctor: true` facet。
 *
 * 实例 brand **无**此 facet（`exec/class/declare.ts`：ctor facet 只挂类值）
 * ⇒ 判据不会把「实例」误认成「类」。
 */
function isClassValueAbs(v: Abs): boolean {
  return v.shape.k === "brand" && v.shape.ctor === true;
}

/**
 * 类导出入口（`new C()`）的 throws 域（Bug 1096）。
 *
 * 口径（与实例方法桥的构造器隔离**孪生**，两处同构）：
 * - 构造器在**独立 may-throw 会话**里跑 ⇒ 软效果（`recordMayThrow`：any
 *   补位的强制转换 / any 成员访问）与 try 帧栈都**不进**本入口的收集域。
 *   依据 Bug 1070：构造器实参一律补 any ⇒ `x + 1` / `x.toFixed()` 必产
 *   TypeError ⇒ 那是 any 补位的**伪影**（真实调用点传具体实参时构造器可能
 *   是 total 的）⇒ 报它 = 假红（一个普通类就能卡死用户 CI）。
 * - **硬抛**（NudoThrow：构造器里的无条件 `throw`）**进** throws 域 ⇒ 这是
 *   `new C()` 的真实 may-throw ⇒ 归因落点 = 类声明处的 `Class` 入口（此前
 *   构造器必抛被 `catch {}` 吞掉 ⇒ check 闸门与 `nudo test` 见证面双面
 *   不可见 ⇒ 假绿）。
 *
 * 与实例方法桥的差别只有一处：**这里不吞硬抛**（要把它交给门禁），实例方法
 * 桥仍按 Bug 1070 口径把构造器的 throws 挡在方法入口之外（硬抛 ⇒ 裸实例
 * 兜底，见 {@link instanceForMethodBridge}）。
 */
function classEntryThrows(
  clsAbs: Abs,
  file: ParsedFile | undefined,
  clsName: string,
  phi: Phi,
): TranspiledCallResult {
  return invokeAsThrows(
    () => runWithMayThrowSession(() => $new(clsAbs, ctorAnyArgs(file, clsName))),
    phi,
  );
}

/**
 * 类方法静态/实例判定（按**源码类声明**；判不出 → undefined）。
 *
 * 判据来源必须是源码而非运行期：静态桥 `$staticInvoke` 对**不存在**的静态
 * 方法折 unknown（**不抛**）⇒ 运行期无法用「返回值」区分「静态方法存在但
 * 返回 unknown」与「这是实例方法」⇒ 必须看声明。
 */
function classMethodIsStatic(
  file: ParsedFile | undefined,
  clsName: string,
  methodName: string,
): boolean | undefined {
  if (!file) return undefined;
  for (const stmt of file.program.body as unknown[]) {
    const s = stmt as { type?: string; declaration?: unknown };
    let decl: unknown = stmt;
    if (s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration") {
      decl = s.declaration;
    }
    const c = decl as
      | { type?: string; id?: { name?: string }; body?: { body?: unknown[] } }
      | undefined;
    if (!c || c.type !== "ClassDeclaration") continue;
    if (c.id?.name !== clsName) continue;
    for (const m of c.body?.body ?? []) {
      const mem = m as {
        kind?: string;
        static?: boolean;
        key?: { name?: string; value?: unknown };
      };
      if (mem.kind === "constructor") continue;
      const key = mem.key;
      const name =
        key?.name ?? (typeof key?.value === "string" ? (key.value as string) : undefined);
      if (name !== methodName) continue;
      return mem.static === true;
    }
    return undefined;
  }
  return undefined;
}

/** 构造实参（any 补位；与 generalize.ts 的类方法桥同口径） */
function ctorAnyArgs(file: ParsedFile | undefined, clsName: string): Abs[] {
  const n = file ? ctorParamCountOf(file, clsName) : 0;
  return Array.from({ length: n }, () => abs({ k: "any" }, undefined, pTrue, "path"));
}

/**
 * 实例方法桥的**构造器隔离**（Bug 1070）。
 *
 * 造实例就得跑构造器 ⇒ 构造器实参一律补 `any`（`ctorAnyArgs`）⇒ 构造器
 * 体内的任何强制转换（`x + 1` / `x > 0` / `"a" + x` / `x.toFixed()`）必产
 * TypeError ⇒ 那是**构造器**的 may-throw（真实调用点传 number 时构造器是
 * total 的），**不是**方法体的 ⇒ 归因到方法入口 = 假红（一个普通类就能
 * 触发 error 级 `nudo:entry-may-throw` ⇒ 直接卡死用户 CI）。
 *
 * 口径：构造器在**独立的 may-throw 会话**里跑 ⇒
 * - 软效果（`recordMayThrow`）与 try 帧栈都**不进**方法入口的收集域；
 * - 硬抛（NudoThrow / ReferenceError）**不归因给方法**（那是 `new C()`
 *   入口的事）⇒ 退到**裸实例**（跳过构造器）继续求值方法体 ⇒ 方法体
 *   自身的证据照常收集（闸门不整体关掉）。
 *
 * ⚠ 构造器仍**要跑**：方法体读 `this.<字段>` 时需要构造器写入的槽值 ⇒
 * 跳过构造器会把字段读退成 unknown ⇒ 方法体**自己**的 may-throw 证据
 * 也一起丢（假绿）。构造器只隔离「证据」，不隔离「副作用」。
 *
 * **Bug 1096**：硬抛不再被**彻底丢弃**——它归因到 `new C()` 这个**真实
 * 入口**（类导出入口，见 {@link classEntryThrows}）：构造器无条件抛是
 * 可判定事实 ⇒ check 闸门必须看得见（否则假绿）。方法入口仍**不**背这条
 * 账（Bug 1070 口径不变 ⇒ 不假红）。裸实例的内层改为 unknown（构造器写过
 * 的字段 = 不可知，不是「确定不存在」）⇒ 见 {@link bareInstanceOf}。
 */
function instanceForMethodBridge(clsAbs: Abs, clsName: string, ctorArgs: Abs[]): Abs {
  try {
    // 独立会话 ⇒ 构造器期间的效果/帧栈不进外层收集域（见上）
    return runWithMayThrowSession(() => $new(clsAbs, ctorArgs));
  } catch {
    // 构造器抛 ⇒ 归因给构造器入口（`new C()`，见 classEntryThrows），
    // **不**归因给方法 ⇒ 裸实例兜底（字段按不可知处理）
    return bareInstanceOf(clsAbs, clsName);
  }
}

/**
 * 裸实例（跳过构造器）：brand 名取**类值**的 brand 名（类值即 brand ⇒
 * 导出槽兜底 / `export default class` 同口径）。
 *
 * **内层是 unknown，不是空 obj**（Bug 1096）：构造器抛 ⇒ 构造器写过的字段
 * **不可知**（不是「确定不存在」）⇒ 空 obj 会把 `this.v` 折成**确定的
 * undefined**（自信的错值：真实是构造器写入的值）⇒ 连带 `this.v.toFixed()`
 * 在**虚构实例**上抛 TypeError ⇒ 方法签名被折成 `never`（谎称「该方法必
 * 抛、恒返回 never」）+ error 级 `nudo:entry-may-throw`（假红，直接卡 CI）。
 * 内层 unknown ⇒ 字段读 = unknown（不可知）⇒ 成员调用不产 may-throw ⇒
 * 签名不折 never（兜底实例的 TypeError 不得决定方法签名）。
 *
 * 与 `generalize.ts` 的同名孪生实现**同构**（那处是值域通道）——两处必须
 * 一起改，否则证据域与值域口径漂移。
 */
function bareInstanceOf(clsAbs: Abs, clsName: string): Abs {
  const name =
    clsAbs.shape.k === "brand" && clsAbs.shape.name.length > 0
      ? clsAbs.shape.name
      : clsName;
  return abs(
    {
      k: "brand",
      name,
      shape: abs({ k: "unknown" }, undefined, undefined, "partial"),
    },
    undefined,
    undefined,
    "path",
  );
}

/** 源码跨度（行/列，1-based 行） */
type SourceSpan = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

/** 节点的源码跨度（无 loc → undefined） */
function spanOf(node: unknown): SourceSpan | undefined {
  const loc = (node as { loc?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } } } | undefined)?.loc;
  const st = loc?.start;
  const en = loc?.end;
  if (!st || !en || st.line === undefined || en.line === undefined) return undefined;
  return {
    startLine: st.line,
    startColumn: st.column ?? 0,
    endLine: en.line,
    endColumn: en.column ?? 0,
  };
}

/**
 * 入口（顶层函数 / 类方法）的源码跨度。
 *
 * 只用于**归因**：把「转译器拒绝的构造」定位到**它所在的入口**⇒ 该入口的
 * total 性才真的不可判定（同模块的其它入口只是**陪葬**——它们没被分析，
 * 但原生下并不抛 ⇒ 对它们断言「可能抛」是过度断言）。
 */
function entrySpanOf(file: ParsedFile | undefined, fnName: string): SourceSpan | undefined {
  if (!file) return undefined;
  for (const stmt of file.program.body as unknown[]) {
    const s = stmt as { type?: string; declaration?: unknown };
    let decl: unknown = stmt;
    if (s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration") {
      decl = s.declaration;
    }
    const d = decl as
      | {
          type?: string;
          id?: { name?: string };
          body?: { body?: unknown[] };
          declarations?: unknown[];
        }
      | undefined;
    if (!d || typeof d !== "object") continue;
    // 类方法（Class.method）
    if (fnName.includes(".")) {
      const [clsName, methodName] = fnName.split(".", 2);
      if (d.type !== "ClassDeclaration" || d.id?.name !== clsName) continue;
      for (const m of d.body?.body ?? []) {
        const mem = m as {
          kind?: string;
          key?: { name?: string; value?: unknown };
        };
        if (mem.kind === "constructor") continue;
        const key = mem.key;
        const name =
          key?.name ?? (typeof key?.value === "string" ? (key.value as string) : undefined);
        if (name !== methodName) continue;
        return spanOf(mem);
      }
      return undefined;
    }
    // 顶层函数声明
    if (d.type === "FunctionDeclaration" && d.id?.name === fnName) return spanOf(d);
    // export default function（无名 / 有名皆算）
    if (fnName === "default" && s.type === "ExportDefaultDeclaration") {
      const t = d.type;
      if (t === "FunctionDeclaration" || t === "ArrowFunctionExpression" || t === "FunctionExpression") {
        return spanOf(d);
      }
    }
    // 变量声明（const f = () => …）
    if (d.type === "VariableDeclaration") {
      for (const dec of d.declarations ?? []) {
        const id = (dec as { id?: { name?: string } }).id;
        if (id?.name === fnName) return spanOf(dec);
      }
    }
  }
  return undefined;
}

/** 位置是否落在跨度内 */
function locInSpan(
  loc: { line: number; column: number } | undefined,
  span: SourceSpan | undefined,
): boolean {
  if (!loc || !span) return false;
  if (loc.line < span.startLine || loc.line > span.endLine) return false;
  if (loc.line === span.startLine && loc.column < span.startColumn) return false;
  if (loc.line === span.endLine && loc.column > span.endColumn) return false;
  return true;
}

/**
 * 被拒绝的构造是否落在**该入口自己的**源码跨度内。
 *
 * 跨度判不出（入口形态特殊 / 构造无位置）⇒ **不归因**给该入口 ⇒ 不发
 * 「可能抛」断言（宁可少报，也不做过度断言）。
 */
function unsupportedFallsInside(
  file: ParsedFile | undefined,
  fnName: string,
  loc: { line: number; column: number } | undefined,
): boolean {
  const span = entrySpanOf(file, fnName);
  if (!span) return false;
  return locInSpan(loc, span);
}
