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
 * **fail-closed 口径（Bug 380 / Bug 1153）**：入口**没被分析**（转译器拒绝
 * 构造 ⇒ 模块整体未求值）时，may-throw **不可判定**——不得与「分析出没有
 * may-throw」混同（旧口径把二者都当空 effects ⇒ 门禁由红转绿）。此类入口记
 * 一条 fail-closed 证据（kind=Error：不可判定 ⇒ 入口**可能**抛 Error）。
 * 归因按**执行时机**：构造落在**模块装载期**代码里（顶层语句体 / 顶层初始化
 * 表达式 / 类定义期的 `static {}`、静态字段初始化器、计算键、`extends` 表达式
 * ——Bug 1155）⇒ **每个**入口都不可判定（装载期先于所有入口执行）；否则按
 * **可达性**：构造落在入口自身跨度内，或落在入口可达的顶层辅助函数 / 类内
 * （`reachableTopBindings`）⇒ 该入口背账；不可达的陪葬入口不背。
 *
 * **module-throw（附录 A#1）**：模块装载期**必然抛**（顶层无条件 `throw`）
 * 时导出全丢 ⇒ 本模块的入口证据面仍返回 `absent`（不逐入口做「可能抛」的
 * 过度断言），fail-closed 改在**模块级**发一条 `nudo:module-throw`（check.ts
 * 消费 {@link definiteModuleThrowOf}）。判据只认**句法证据**：引擎在抽象域上
 * 的「必抛」混着宿主 API 近似的产物（原生能正常加载）⇒ 拿引擎结论做门禁 =
 * 假红。条件抛 / try 内抛 / 引擎近似抛不报。
 */

import type { Node } from "@babel/types";
import type { Abs } from "./abs.ts";
import { abs, never } from "./abs.ts";
import type { Phi } from "./pred.ts";
import { pTrue } from "./pred.ts";
import { formatShape } from "./format.ts";
import type { PolyFn } from "./generalize.ts";
import { ctorParamCountOf } from "./generalize.ts";
import type { CheckOptions } from "./check-types.ts";
import { $invoke, $new, withExecPhi } from "./exec/index.ts";
import { $staticInvoke } from "./exec/class/this-member.ts";
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
import { instanceForMethodBridge } from "./bridge-instance.ts";
import { resolveExportSlotCall } from "./export-slot.ts";
/** 节点跨度 / 装载期判定共用 `fn-fp.ts` 的勘测（`nodeSpan`）与推迟面清单。 */
import {
  deferredExecutionSpans,
  nodeSpan,
  reachableTopBindings,
  type SourceSpan,
} from "./fn-fp.ts";
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
        // 源码跨度内含该构造**（或经顶层辅助函数 / 类**可达**该构造，
        // Bug 1153）的入口发证据；构造落在**装载期**代码里时（Bug 1155：
        // 顶层语句体 / 初始化表达式 / 类定义期面）则**所有**入口都不可判定
        // ——装载期先于任何入口执行，归属与入口可达性无关。
        if (!unsupportedFallsInside(file, fnName, outcome.reason, outcome.loc)) return effects;
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
      // 例外：module-throw 的 fail-closed 在**模块级**（`nudo:module-throw`，
      // check.ts 消费 `definiteModuleThrowOf`）——不在每个入口上重复断言。
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
              // Bug 1070：构造器在独立 may-throw 会话里跑 ⇒ 软效果/硬抛
              // 不归因给方法；构造器抛 ⇒ 共享桥退裸实例（Bug 1096）。
              const inst = instanceForMethodBridge(
                clsAbs,
                clsName ?? "",
                ctorAnyArgs(file, clsName ?? ""),
                runWithMayThrowSession,
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
      const mem = m as ClassMemberNode;
      if (mem.kind === "constructor") continue;
      if (classMemberName(mem) !== methodName) continue;
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

/** Babel 类成员的宽松形状（ClassMethod / ClassProperty / StaticBlock…）。 */
type ClassMemberNode = {
  type?: string;
  kind?: string;
  static?: boolean;
  key?: { name?: string; value?: unknown };
  value?: unknown;
};

/** 类成员的入口键名（字符串/数字字面量键；私有名 / computed 不算）。 */
function classMemberName(m: ClassMemberNode): string | undefined {
  const key = m.key;
  if (!key) return undefined;
  return key.name ?? (typeof key.value === "string" ? key.value : undefined);
}

/** `exports` / `module.exports`（与 `scan-named-exports.ts` 的入口枚举同口径）。 */
function isExportsTarget(node: unknown): boolean {
  const n = node as
    | { type?: string; name?: string; object?: unknown; property?: unknown }
    | undefined;
  if (!n) return false;
  if (n.type === "Identifier") return n.name === "exports";
  if (n.type !== "MemberExpression") return false;
  const obj = n.object as { type?: string; name?: string } | undefined;
  const prop = n.property as { name?: string } | undefined;
  return obj?.type === "Identifier" && obj.name === "module" && prop?.name === "exports";
}

/** `exports.f` / `module.exports.f` 的导出键（computed 不算，同入口枚举）。 */
function cjsExportName(left: unknown): string | undefined {
  const l = left as
    | { type?: string; computed?: boolean; object?: unknown; property?: unknown }
    | undefined;
  if (!l || l.type !== "MemberExpression" || l.computed === true) return undefined;
  if (!isExportsTarget(l.object)) return undefined;
  const prop = l.property as { name?: string } | undefined;
  return prop?.name;
}

/** 对象键 / 标识符名（字符串字面量键也认：`module.exports = { "f": … }`）。 */
function keyNameOf(node: unknown): string | undefined {
  const n = node as { type?: string; name?: string; value?: unknown } | undefined;
  if (!n) return undefined;
  if (n.type === "Identifier" && typeof n.name === "string") return n.name;
  if (n.type === "StringLiteral" && typeof n.value === "string") return n.value;
  return undefined;
}

/** 可作为入口**值**的节点（函数 / 箭头 / 类）：其跨度覆盖入口体。 */
function entryValueNode(node: unknown): Node | undefined {
  const n = node as { type?: string } | undefined;
  if (!n) return undefined;
  return n.type === "FunctionDeclaration" ||
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression" ||
    n.type === "ClassDeclaration" ||
    n.type === "ClassExpression"
    ? (node as Node)
    : undefined;
}

/**
 * 类方法入口的执行节点：方法自身 +（实例方法）构造器与实例字段初始化器 /
 * （静态方法）静态字段初始化器与静态块。
 *
 * 归因取**保守并集**：`new C()` 会跑构造器与字段初始化器、类定义期会跑静态
 * 面 ⇒ 这些节点里被转译器拒绝的构造，同样让该入口的 total 性不可判定。同类
 * 的**其它**方法不并（那是 `C.m` 的陪葬，不是它的执行路径）。
 */
function classMethodEntryNodes(
  cls: { body?: { body?: unknown[] } },
  methodName: string,
): Node[] | undefined {
  const members = (cls.body?.body ?? []) as ClassMemberNode[];
  let method: ClassMemberNode | undefined;
  for (const m of members) {
    if (m.kind === "constructor") continue;
    if (classMemberName(m) !== methodName) continue;
    method = m;
    break;
  }
  if (!method) return undefined;
  const isStatic = method.static === true;
  const nodes: Node[] = [method as Node];
  for (const m of members) {
    if (m === method) continue;
    if (m.kind === "constructor") {
      if (!isStatic) nodes.push(m as Node);
      continue;
    }
    if (m.type === "StaticBlock") {
      if (isStatic) nodes.push(m as Node);
      continue;
    }
    if (m.type === "ClassProperty" || m.type === "ClassPrivateProperty") {
      if ((m.static === true) !== isStatic) continue;
      nodes.push((m.value as Node | undefined) ?? (m as Node));
    }
  }
  return nodes;
}

/**
 * CJS 入口形态的执行节点（`exports.f = …` / `module.exports = { f: … }`）。
 *
 * 入口集合由 `scan-named-exports.ts` 枚举（`cjsPropName` / `module.exports`
 * 对象属性）；这里只把**已枚举的**名字映射到源码节点——不新造入口。任意
 * 表达式右值（模块顶层求值）**不**归因（模块顶层口径另案）。
 */
function cjsEntryNodes(
  file: ParsedFile,
  expression: unknown,
  fnName: string,
  depth: number,
): Node[] | undefined {
  const e = expression as
    | { type?: string; operator?: string; left?: unknown; right?: unknown }
    | undefined;
  if (!e || e.type !== "AssignmentExpression" || e.operator !== "=") return undefined;
  const right = e.right as { type?: string; name?: string; properties?: unknown[] } | undefined;
  if (!right) return undefined;
  /** 右值 → 入口执行节点：函数/类值直接用；标识符递归解析到其顶层绑定。 */
  const fromValue = (node: unknown): Node[] | undefined => {
    const value = entryValueNode(node);
    if (value) return [value];
    const ident = node as { type?: string; name?: string } | undefined;
    if (ident?.type === "Identifier" && ident.name) {
      return entryNodesOf(file, ident.name, depth + 1);
    }
    return undefined;
  };
  // exports.f = <值> / module.exports.f = <值>
  if (cjsExportName(e.left) === fnName) return fromValue(right);
  // module.exports = { … } / exports = { … }
  if (!isExportsTarget(e.left)) return undefined;
  if (right.type === "ObjectExpression") {
    for (const p of right.properties ?? []) {
      const prop = p as { type?: string; key?: unknown; value?: unknown };
      if (keyNameOf(prop.key) !== fnName) continue;
      // ObjectMethod（`{ f() {} }`）：属性节点本身就是入口体
      if (prop.type === "ObjectMethod") return [prop as Node];
      return fromValue(prop.value);
    }
    return undefined;
  }
  // module.exports = api（api 是顶层绑定 ⇒ 按名解析）
  if (right.type === "Identifier" && right.name === fnName) {
    return entryNodesOf(file, fnName, depth + 1);
  }
  return undefined;
}

/**
 * 入口的**执行节点**（归因用）：把入口名映射到「该构造会随入口执行」的源码
 * 节点集合。判不出入口形态 ⇒ `undefined`（**不**发任何断言——宁可少报，也
 * 不对陪葬入口做过度断言）。
 *
 * - 顶层函数声明 / `const f = () => …` ⇒ 函数节点；
 * - 类入口 `C` ⇒ **整个类声明**（`$new` 跑构造器 + 字段初始化器）；
 * - 类方法入口 `C.m` ⇒ 方法 + 构造器/字段初始化器（见 {@link classMethodEntryNodes}）；
 * - `export default function/class` ⇒ 默认导出节点；
 * - CJS `exports.f = …` 等形态 ⇒ 见 {@link cjsEntryNodes}。
 *
 * 归因范围 = 这些节点的跨度 ∪ 从它们**可达**的顶层绑定
 * （{@link unsupportedFallsInside}）；同一函数体内联与拆到顶层辅助函数结论一致。
 */
function entryNodesOf(
  file: ParsedFile | undefined,
  fnName: string,
  depth = 0,
): Node[] | undefined {
  if (!file || depth > 3) return undefined;
  for (const stmt of file.program.body as unknown[]) {
    const s = stmt as { type?: string; declaration?: unknown; expression?: unknown };
    // CJS：exports.f = … / module.exports = { f }
    if (s.type === "ExpressionStatement") {
      const hit = cjsEntryNodes(file, s.expression, fnName, depth);
      if (hit) return hit;
      continue;
    }
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
    // 类方法（Class.method）——只认类声明里的成员
    if (fnName.includes(".")) {
      const [clsName, methodName] = fnName.split(".", 2);
      if (d.type !== "ClassDeclaration" || d.id?.name !== clsName) continue;
      return classMethodEntryNodes(d, methodName ?? "");
    }
    // 顶层函数声明
    if (d.type === "FunctionDeclaration" && d.id?.name === fnName) return [d as Node];
    // export default：函数 / 类（无名函数也算）
    if (fnName === "default" && s.type === "ExportDefaultDeclaration") {
      const t = d.type;
      if (
        t === "FunctionDeclaration" ||
        t === "ArrowFunctionExpression" ||
        t === "FunctionExpression" ||
        t === "ClassDeclaration"
      ) {
        return [d as Node];
      }
    }
    // 类入口 C ⇒ 整个类声明
    if (d.type === "ClassDeclaration" && d.id?.name === fnName) return [d as Node];
    // 变量声明（const f = () => … / const C = class …）
    if (d.type === "VariableDeclaration") {
      for (const dec of d.declarations ?? []) {
        const id = (dec as { id?: { name?: string } }).id;
        if (id?.name === fnName) return [dec as Node];
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
 * 构造的位置是否落在**模块装载期**执行的代码里（module-init）。
 *
 * 装载期 = 顶层语句体 / 顶层初始化表达式 / 类定义期执行面（`static {}`、
 * 静态字段初始化器、计算键、`extends` 表达式）——这些东西先于**任何**入口
 * 调用执行。函数体 / 参数默认值（调用时跑）与实例字段初始化器 / 构造器 /
 * 方法体（`new` 时跑）不算，由 `deferredExecutionSpans` 列出并排除。
 *
 * 保守边界：IIFE 的函数体按 AST 结构属于函数体 ⇒ 记入推迟面（不归因；与
 * 改造前一致，宁可少报）。
 */
function isModuleInitLoc(
  file: ParsedFile,
  loc: { line: number; column: number } | undefined,
): boolean {
  if (!loc) return false;
  if (!locInSpan(loc, nodeSpan(file.program))) return false;
  for (const span of deferredExecutionSpans(file)) {
    if (locInSpan(loc, span)) return false;
  }
  return true;
}

/**
 * 模块顶层**必然执行**的显式 `throw`：定位 + 可静态判出的抛出类型名。
 *
 * `kind` 只在句法上能确定时给出（`throw new TypeError(…)` / `throw Error(…)`
 * 的构造器名）；`throw someExpr` 不带——**不**拿引擎的抽象域结论补（引擎抛的
 * 类型可能来自宿主 API 的近似，见 {@link definiteModuleThrowOf}）。
 */
export type DefiniteModuleThrow = {
  line: number;
  /** Babel 原生 0-based column */
  column: number;
  kind?: string;
};

/**
 * 模块顶层**必然执行**的显式 `throw` 勘测（附录 A#1 · module-throw fail-closed）。
 *
 * 为什么只认**句法证据**、不认「引擎已经判定必抛」：引擎的「所有抽象路径都抛」
 * 里混着**宿主 API 近似的产物**——`$get` 对被近似成 nullish 的绑定抛 TypeError、
 * `Object.defineProperty` 的建模抛 TypeError、缺失依赖被建模成没有该方法的闭合
 * 对象……真实包实测（node_modules 的 6 个文件：`typescript/lib/_tsserver.js`、
 * `react-dom/cjs/*`、`vitest/dist/chunks/*`）引擎回落 `module-throw` 但顶层
 * **没有** `throw` 语句（= 引擎近似；react-dom 的两个 cjs bundle 原生
 * `require()` 实测成功）⇒ 把引擎结论当门禁证据 = 假红。显式 `throw` 语句是
 * 程序自己的代码，与引擎近似无关：它只可能在「引擎没执行到」时不抛。
 *
 * 「必然执行」判据（保守，只收**无歧义**形态）：
 * - 从 `program.body` **顺序**下钻，只穿过裸块 `{ … }`（无条件的语句序列）；
 * - 命中 `throw` ⇒ 模块装载必定抛（在它之前的语句即便自己抛，模块照样装载失败
 *   ⇒「必抛」仍然成立）；
 * - 遇到可以**非抛**方式离开本序列的语句（`return` / `if` / `switch` / `try` /
 *   循环 / `label` / `with`）⇒ 放弃：后续 `throw` 可能不可达 ⇒ **不报**（宁可
 *   少报，也不对「有正常装载路径」的模块做必抛断言）；
 * - 函数体 / 类体**不**下钻（延迟执行，不是装载期）。
 *
 * 条件抛（`if (typeof window === "undefined") throw …`）一律不报：那是**环境
 * 相关**行为，由宿主决定；引擎在抽象条件上也只把单臂 throw 收进 throwExits
 * （不会冲出模块体），两边口径一致。
 */
export function definiteModuleThrowOf(
  file: ParsedFile | undefined,
): DefiniteModuleThrow | undefined {
  return file ? scanDefiniteThrowSeq(file.program.body as unknown[]) : undefined;
}

/** 顺序扫描语句序列（判据见 {@link definiteModuleThrowOf}）。 */
function scanDefiniteThrowSeq(
  stmts: readonly unknown[],
): DefiniteModuleThrow | undefined {
  for (const stmt of stmts) {
    const s = stmt as {
      type?: string;
      loc?: { start?: { line?: number; column?: number } };
      argument?: unknown;
      body?: unknown[];
    };
    switch (s.type) {
      case "ThrowStatement": {
        const at = s.loc?.start;
        if (at?.line === undefined) return undefined;
        const kind = thrownKindOf(s.argument);
        return {
          line: at.line,
          column: at.column ?? 0,
          ...(kind !== undefined ? { kind } : {}),
        };
      }
      // 裸块 = 无条件的语句序列 ⇒ 继续下钻
      case "BlockStatement": {
        const hit = scanDefiniteThrowSeq(s.body ?? []);
        if (hit) return hit;
        continue;
      }
      case "ReturnStatement":
        return undefined;
      case "IfStatement":
      case "SwitchStatement":
      case "TryStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
      case "LabeledStatement":
      case "WithStatement":
        // 可能以非抛方式离开本序列（或让后续语句不可达）⇒ 必抛不成立
        return undefined;
      default:
        continue;
    }
  }
  return undefined;
}

/** `throw <expr>` 的静态类型名：`new X(…)`；`X(…)` 只认 `*Error` 构造器调用。 */
function thrownKindOf(arg: unknown): string | undefined {
  const a = arg as { type?: string; callee?: unknown } | undefined;
  const callee = a?.callee as { type?: string; name?: string } | undefined;
  if (callee?.type !== "Identifier" || typeof callee.name !== "string") return undefined;
  if (a?.type === "NewExpression") return callee.name;
  // `throw Error("…")` / `throw TypeError("…")`（不带 new 的原生调用同义）
  return a?.type === "CallExpression" && callee.name.endsWith("Error")
    ? callee.name
    : undefined;
}

/**
 * TS-only 声明语句（`namespace` / `import x = require()` …）的转译拒绝理由前缀。
 *
 * Bug 895 × Bug 1155：`.ts` 源码里的 TS-only 语法**不得**把 `nudo check` /
 * 构建弄红。这类构造是**类型层 / 声明层**语法，运行时效果只是值声明
 * （`namespace` 体里「程序自己的抛」属于 module-throw 族，门禁面已静默）；
 * 它们不是「入口可能抛」的证据 ⇒ **不**做模块装载期归因。
 *
 * 只豁免装载期分支：入口可达性归因（Bug 1153）不受影响——TS 声明语句不可能
 * 出现在函数体里。探测结论（`.ts` 顶层，转译器实际拒绝的唯一两种）：
 * `TSModuleDeclaration`（含 export 形态；`declare namespace` / `declare module`
 * 已被剥除）与 `TSImportEqualsDeclaration`；enum / interface / type alias /
 * `declare` 变量·函数·类 / `export =` / `export as namespace` / `as const` /
 * `satisfies` / 抽象类均转译通过。
 */
const TS_ONLY_STATEMENT_REASON_PREFIX = "unsupported:statement:TS";

/**
 * 被拒绝的构造是否会随**该入口**执行。
 *
 * 判据（按序）：
 * 1. 构造的 loc 落在**模块装载期**代码里（{@link isModuleInitLoc}）⇒ **每个**
 *    入口都不可判定（装载期先于所有入口执行，转译失败 ⇒ 整个模块未求值）；
 *    但 TS-only 声明语句（{@link TS_ONLY_STATEMENT_REASON_PREFIX}）除外；
 * 2. 否则落在入口的执行节点内 **或** 落在入口**可达**的顶层绑定（辅助函数 /
 *    类）内 —— 同一函数体内联与拆到顶层辅助函数，结论必须一致（Bug 380 的
 *    `g().x++` 拆进 helper 后不得由红转绿）。可达闭包由
 *    `reachableTopBindings` 计算（`seen` 收敛 ⇒ 互递归必终止）。
 *
 * 跨度判不出 / 构造无位置 / 入口不可达该构造 ⇒ **不归因**（宁可少报，也不
 * 做过度断言：同模块的陪葬入口不背这条账）。
 */
function unsupportedFallsInside(
  file: ParsedFile | undefined,
  fnName: string,
  reason: string,
  loc: { line: number; column: number } | undefined,
): boolean {
  if (!file || !loc) return false;
  // Bug 1155：装载期构造 ⇒ 所有入口的 total 性都不可判定（此前归因只认
  // 入口自身/可达面 ⇒ 顶层语句里的构造无人背账 ⇒ L2 静默转绿）。
  // Bug 895：TS-only 声明语句不在此列（TS 源码必须保持零诊断）。
  if (
    !reason.startsWith(TS_ONLY_STATEMENT_REASON_PREFIX) &&
    isModuleInitLoc(file, loc)
  ) {
    return true;
  }
  const entryNodes = entryNodesOf(file, fnName);
  if (!entryNodes || entryNodes.length === 0) return false;
  for (const node of entryNodes) {
    if (locInSpan(loc, nodeSpan(node))) return true;
  }
  for (const node of entryNodes) {
    for (const reach of reachableTopBindings(file, node, { includeClasses: true })) {
      if (locInSpan(loc, nodeSpan(reach.node))) return true;
    }
  }
  return false;
}
