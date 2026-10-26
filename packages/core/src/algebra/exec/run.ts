/**
 * 进程内 求值引擎执行：transpile 源码 → new Function 跑在 runtime 上。
 * 不写临时文件；相对 import 用注入的 AbsModuleExports / JS 导出绑定。
 *
 * mode:
 * - "exec"（默认）：执行全部顶层（含副作用）
 * - "analyze"：transpile 阶段只发射非效应顶层语句（`TranspileOptions.mode`;
 *   判定见 transpile/analyze-strip.ts）——跳过顶层表达式/循环/if 的副作用，
 *   分析入口安全，不触发 fetch 等顶层副作用
 *
 * analyze 的剥离在**发射期**完成：本文件不再解析生成产物做二次剥除。
 */

import {
  rtAllBindings,
  compileRuntimeModuleUnit,
  compileRuntimeUnit,
  runtimeArgValues,
  runtimeModuleArgValues,
} from "./rt.ts";
import {
  enterEvalCallBudgetSession,
  exitEvalCallBudgetSession,
  setEvalBindingSink,
} from "./calls.ts";
import { withExecPhi, $copy } from "./runtime.ts";
import type { Abs } from "../abs.ts";
import type { Phi } from "../pred.ts";
import { never, unknown, abs, strLit } from "../abs.ts";
import { makeAbsApplyResult, type AbsApplyResult } from "../abs-fn.ts";
import { joinAbs } from "../objects.ts";
import { type AbsModuleExports, namespaceAbsOf, defaultImportBindingOf } from "../abs-modules.ts";
import { formatAbs } from "../format.ts";
import { transpileModule, transpileExpression } from "./transpile.ts";
import { RUNTIME_IMPORT_RE } from "./transpile/runtime-import.ts";
import { HOST_INTRINSIC_NAMES, HOST_INTRINSIC_SET } from "./transpile/intrinsics.ts";
import { NAMESPACE_GLOBALS } from "./runtime/containers.ts";
import { NudoUnsupportedError } from "./unsupported.ts";
import { drainClassCollisions, beginClassEpoch } from "./class-registry.ts";
import { registerLiveImportRefresh, refreshLiveImports } from "./live-imports.ts";
import { errorTypeAbs, throwPayloadOf } from "./may-throw.ts";
import { drainPromiseMicros, errorBrandAbs } from "../builtins.ts";
import { sourceHasCjsExports, sourceHasEsmSyntax } from "../code-text.ts";
import { isNudoThrow, isNudoReturn, $isForkExit, runWithLoopExits, takeLoopExits, takeThrowExits, asAbsVal, withNewTargetReset, NudoThrow } from "./runtime.ts";
import { $call } from "./call.ts";
import { refineFnReturnType } from "./class.ts";
import {
  runWithCollectorScope,
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "../collector-scope.ts";

export type RunTranspiledOptions = {
  /** 说明符 → 依赖导出（host 模块图或 runTranspiled 产物） */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  maxLoopIters?: number;
  /** analyze = 跳过效应性顶层语句 */
  mode?: "exec" | "analyze";
  /** @nudo:replace 注入值：varName → Abs */
  replacements?: Record<string, Abs>;
  /** @nudo:replace 匹配表：传给 transpile（stmtStart/stmtEnd = **字符区间**
   *  `[start, end)`，非行号——Bug 166 起按 AST 节点身份定位） */
  replacementTargets?: Array<{
    target: string;
    varName: string;
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  /** @nudo:as 注入值：varName → Abs */
  asOverrides?: Record<string, Abs>;
  /** @nudo:as 语句范围表（stmtStart/stmtEnd = **字符区间**，非行号） */
  asOverrideTargets?: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  /** @nudo:env 全局 Abs（JSON/Math/console…）→ 作用域绑定 */
  envGlobals?: Record<string, Abs>;
  /** @nudo:mock 注入值：name → Abs（mockDirectivesToAbsSeeds 产物） */
  mocks?: Record<string, Abs>;
  /** 节点级 Abs 记录插桩（hover 重放用——透传 transpile 的
   * recordPositions：Identifier 值读 / 静态成员读包 $nodoPos） */
  recordPositions?: boolean;
  /** 宽松全局（调用点发现 exec 采集：未声明全局调用保守 unknown 不中断） */
  lenientGlobals?: boolean;
  /**
   * **关闭** async 体的生成器路径（`$async` 同步路径）——安全网。
   *
   * Bug 1139：生成器模式下 `await` 的位置表与转译侧脱节 ⇒ `yield` 落进嵌套
   * 箭头 ⇒ `new Function` SyntaxError ⇒ **整个模块**编译失败 ⇒ 全部导出
   * 丢失 ⇒ L2 闸门**假绿**（exit 0）。本开关让求值引擎能在生成器模式编译
   * 失败时**重试一次**（关闭生成器路径）⇒ 模块至少编译得出来 ⇒ 导出可见。
   */
  disableAsyncGen?: boolean;
};

/**
 * inject/modules **内容**指纹（memo 键）。对象身份对「每次新建同内容」
 * 的 CLI 注入不稳——同一语义的 inject 跨 checkSource 调用会 miss 缓存。
 */
export function runTranspiledOptionsMemoKey(
  opts: RunTranspiledOptions | undefined,
): string {
  if (!opts) return "-";
  const seen = new WeakSet<object>();
  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return String(v);
    if (typeof v === "function") return "fn";
    if (typeof v !== "object") return String(v);
    const obj = v as object;
    if (seen.has(obj)) return "@";
    seen.add(obj);
    if ("shape" in obj && "conf" in obj) {
      try {
        return formatAbs(obj as Abs);
      } catch {
        return "?abs";
      }
    }
    if (Array.isArray(v)) return `[${v.map(fmt).join(",")}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${k}:${fmt(o[k])}`)
      .join(",")}}`;
  };
  return fmt(opts);
}

/** 运行时 import 行正则：单一真值源在 `transpile/runtime-import.ts`。
 *  宿主编译单元（模块体 / body-fn / evalExprAbs）已不再拼运行时 import 行
 *  （运行时符号由 compileRuntimeUnit 以形参注入）；本文件按**公开面**原样
 *  再导出（exec/index.ts 的公开符号，运行时消费方按它剥离生成物）。 */
export { RUNTIME_IMPORT_RE };

/**
 * 具名导入的绑定物化：**原样直出声明 Abs**（不再把 fn Abs 包成 JS 箭头 wrapper）。
 *
 * Bug 932：此前 fn Abs 被包成 `w = (...args) => $call(v, args)`（原 Abs 只挂在
 * `w.__nudoAbsFn` 上，没有任何一处在物化绑定时读它）⇒ 绑定值成了引擎为宿主
 * 函数合成的**裸 fn 形状**（无 `paramTypes` / 无 `returnType`）⇒ 值面退化成
 * 通用 fn，签名面渲染成**非法占位符** `() => ?`；而同一份 env 声明经
 * **命名空间**导入（`bindNamespace`：槽直填原 Abs）渲染成完整的
 * `(CallbackFn) => PromiseFn` ⇒ 同一文件、同一导出、两种导入形态两种类型。
 *
 * 直出原 Abs 后，具名与命名空间**共用同一物化逻辑**（都是原 Abs）⇒ 两种导入
 * 形态给出同一个类型；调用面照旧派发到同一份声明类型。
 *
 * **可调用性不丢**：Abs 一等函数在两条调用面上原生可派发——
 * 标识符调用走 `$callNamed`（Abs 分支 → `$call(fn, args)`，exec/calls.ts:769），
 * `new` 走 `$new`（Abs 分支 → exec/class/declare.ts:565）。JS wrapper 只在
 * 「宿主 JS 侧需要一个真函数」时才有意义，本路径没有这种需求。
 */
function bindImport(
  modules: RunTranspiledOptions["modules"],
  spec: string,
  name: string,
): unknown {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (name === "default") {
    // Bug 282：默认导入的绑定值走 core 单一事实源（defaultImportBindingOf）——
    // CJS 互操作模块（env 模块：node:fs…）的 default = **模块对象本身**
    // （= 命名空间）⇒ 与同一模块的命名空间导入给出同一个类型；用户模块缺
    // default ⇒ 仍是 unknown（Bug 990 口径，不得回退到命名空间）。
    const d = defaultImportBindingOf(mod);
    if (typeof d === "function") return d;
    return d as Abs;
  }
  const named = (mod as AbsModuleExports).named;
  const v = named?.[name];
  if (v === undefined) {
    const rec = (mod as Record<string, unknown>)[name];
    if (typeof rec === "function") return rec;
    // 缺名：unknown Abs（非 JS undefined）——re-export 走 __nudoExport 时留槽
    return unknown;
  }
  if (typeof v === "function") return v;
  return v as Abs;
}

/** `import * as ns`：整命名空间（named + default 槽）→ Abs 对象。
 *  ESM namespace 对象成员是 live binding（Bug ②）：`const N = U; mut(); N.x`
 *  原生仍读当前值——槽 value 经 getter 读取时解析依赖当前导出表（导出名集
 *  在命名空间构建时固定，与 ESM link-time 名集一致）。 */
function bindNamespace(modules: RunTranspiledOptions["modules"], spec: string): Abs {
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) return unknown;
  if (!mod.named) return unknown;
  const named = mod.named;
  const slots: Record<string, { value: Abs }> = {};
  const liveSlot = (read: () => Abs): { value: Abs } => {
    const slot = {} as { value: Abs };
    Object.defineProperty(slot, "value", { get: read });
    return slot;
  };
  for (const key of Object.keys(named)) {
    slots[key] = liveSlot(() => named[key]);
  }
  if (mod.default !== undefined) {
    slots["default"] = liveSlot(() => (mod as AbsModuleExports).default as Abs);
  }
  return abs({ k: "obj", slots, open: true }, undefined, undefined, "path");
}

/**
 * require 值解析（普通 require 与可选 require **共用**口径）：
 * `module.exports = X` 重赋值形态（cjsMain）→ 原生 require 返回 X 本身
 * （ms 等单函数导出包可直接调用），返回 default 而非命名空间对象——
 * Bug 10 的 obj-callee 定抛暴露了旧口径的形状失真（namespace obj 不可调）。
 * 否则 → 可 $get 的 namespace Abs。
 */
function requireValueOf(mod: AbsModuleExports): unknown {
  if (mod.cjsMain) {
    const d = (mod as AbsModuleExports).default;
    if (d !== undefined) return d;
  }
  if (mod.named) return namespaceAbsOf(mod);
  return mod;
}

/**
 * CJS require：modules[spec] → 可 $get 的 namespace Abs；非字符串 → unknown（不炸）。
 *
 * Bug 276：**缺失模块必须抛**（原生 require 缺失 → MODULE_NOT_FOUND）。
 * 此前缺失被当作普通值 `unknown` 返回 ⇒ 用户 try/catch 的 **catch 臂成死
 * 代码** ⇒ 引擎声称「不抛」⇒ L2 `nudo:entry-may-throw` 门禁**少报**。
 * 抛 NudoThrow（Error brand）：用户的 catch 臂可吸收（$catchVal 认
 * NudoThrow ⇒ 绑错误 Abs），未吸收则如实计入 throws 面。
 *
 * `loading` = 模块**装载期**（模块体正在求值）。装载期的 require 缺失 =
 * **模块装载失败**（原生 MODULE_NOT_FOUND 打断装载）——引擎保持既有降级
 * （该 require 折 unknown，文件其余部分照常分析；缺模块由诊断面
 * `nudo:module-missing` 报）。若装载期也抛 ⇒ 整文件装载失败 ⇒ 全文件
 * 退化 unknown ⇒ 门禁假绿（且顶层绑定未记录 ⇒ 跨文件契约检查失效）。
 * 调用期（模块已装载，导出函数被调用）的 require 缺失 = 抛 ✔。
 */
function requireFromModules(
  modules: RunTranspiledOptions["modules"],
  spec: string,
  loading: boolean,
): unknown {
  if (typeof spec !== "string") return unknown;
  const mod = modules?.[spec] as AbsModuleExports | undefined;
  if (!mod) {
    if (loading) return unknown;
    throw new NudoThrow(
      errorBrandAbs("Error", [strLit(`Cannot find module '${spec}'`)]),
    );
  }
  return requireValueOf(mod);
}

/**
 * 可选 require（try/catch 双侧字面量）：优先成功侧——第一个能解析的 spec；
 * 全不能解析 → unknown（诚实降级，不假装某模块）。
 *
 * Bug 275：此前**漏了 cjsMain 分支**——`module.exports = X` 的模块经可选
 * require 拿到的是**命名空间**而非 X 本身（与普通 require 口径分叉）。
 */
function requireOptionalFromModules(
  modules: RunTranspiledOptions["modules"],
  specs: string[],
): unknown {
  if (!Array.isArray(specs)) return unknown;
  for (const spec of specs) {
    if (typeof spec !== "string") continue;
    const mod = modules?.[spec] as AbsModuleExports | undefined;
    if (!mod) continue;
    return requireValueOf(mod);
  }
  return unknown;
}

/** runTranspiled 顶层绑定表（checkSource varAbs 通道；WeakMap 不碰返回面） */
const runBindings = new WeakMap<object, Map<string, unknown>>();

/**
 * env 全局注入时**不得**遮蔽的宿主内建名——**派生**自两张单一事实源，
 * 不再手工维护第三份名单：
 *
 * - `HOST_INTRINSIC_NAMES`（未遮蔽 → 转译器按字面量折叠：`void 0` / `0/0` /
 *   `1/0`；被用户绑定遮蔽时标识符读点发 `$absVal(<标识符>)`，按 JS 词法
 *   绑定决定读值）。注入形式是模块级 `let <name> = __nudoEnv["<name>"]`
 *   （可写绑定，原生 globalThis 属性可赋值），会**取代**宿主全局；env 注入
 *   还绕过源 AST 声明扫描（转译器看不到注入，无法判定遮蔽）。
 *   典型故障（已修）：env 把 `undefined` 绑成 Abs 后，
 *   `$fork(test, cons, undefined)` 的第三参从「省略」变成 truthy 非函数 →
 *   调用炸 → fail-closed unknown；`NaN` 绑成抽象 number 时 `0 === NaN` 从
 *   恒 false 退化成 boolean。env 注入对这三个名字无收益 → 跳过。
 * - `NAMESPACE_GLOBALS` 名字（namespaceNameOf 的宿主对象身份路由表）：
 *   env 若注入 `const Math = …` 会把 `$get`/`$invoke` 接收者从宿主对象换成
 *   Abs 表项 ⇒ 路由失效、区间透传/内建语义回退（issue #87）。跳过后接收者
 *   回到宿主身份，等价于 env 关。名单与路由表同源 ⇒ 路由名必 skip、skip 名
 *   必有路由收益，两个方向的漂移都从结构上消失。
 *
 * 表外全局（console / document / process …）不跳过：没有身份路由收益的
 * 跳过只会丢弃用户的 env 声明、让代码退化 unknown。
 *
 * @nudo:mock 相反——mock 遮蔽宿主全局正是意图（Bug 274），其名字进转译
 * 选项 shadowedIntrinsics（见下方 mockedIntrinsicNames），不经过本名单。
 *
 * Bug 322（连带后果记录）：URL 的 skip 保住了「宿主身份路由不被 env 遮蔽」，
 * 却让 env 侧更完整的 URL 实例模型（packages/env/src/web.ts 的
 * `searchParams: URLSearchParams`）永远到不了构造面——`new URL(...)` 走 core
 * 的 makeUrlAbs（exec/class/declare.ts），不看 env 注入；构造面的实例槽由
 * core 侧补齐（declare.ts 的 withUrlSearchParamsSlot）。
 *
 * **延迟派生**：run.ts 位于模块图的环上（body-fn / call ↔ run ↔
 * runtime/containers/member），模块求值期 `NAMESPACE_GLOBALS` 可能仍是 TDZ
 * ——不能顶层 `new Set([...NAMESPACE_GLOBALS])`。首次注入时派生并记忆。
 */
let envShadowSkipGlobalsCache: ReadonlySet<string> | undefined;

export function getEnvShadowSkipGlobals(): ReadonlySet<string> {
  return (envShadowSkipGlobalsCache ??= new Set([
    ...HOST_INTRINSIC_NAMES,
    ...NAMESPACE_GLOBALS.map(([name]) => name),
  ]));
}

/**
 * CJS 顶层 `this` 的模块级绑定名（Bug 277）：Node CJS 把模块体包在
 * `wrapper.call(module.exports, …)` 里 ⇒ **顶层 this === module.exports**。
 * 转译器把顶层 `this` 折成 `opts.thisParam`（缺省 `$lit(void 0)` = ESM
 * 语义）⇒ 本绑定名即该 `thisParam`；绑定**值**按文件口味定（CJS ⇒ exports；
 * 纯 ESM ⇒ undefined；非 ESM 无 CJS 面 ⇒ 空对象 = module.exports 初始形态）。
 */
const CJS_THIS_BIND = "__nudoCjsThis";

/**
 * 分析面槽位表（Symbol 键，非枚举）——run 表返回对象的**第二个面**：
 * 键 = 顶层函数**本地名**，值 = 读取本地绑定的 thunk。
 *
 * 为什么需要：run 表的字符串键是**导出面**（同名 re-export / 别名会覆盖
 * 私有本地函数名）。按函数名分析（generalize / 调用点 / LSP replay）必须以
 * **源码绑定**为准，不能走导出槽——否则 `function g(){}` +
 * `export { g } from "./dd.js"` 会把依赖的 g 当成待分析函数。
 * `Object.keys(run)` 不受影响（Symbol + 非枚举）。
 */
const ANALYSIS_SLOTS_KEY = "nudo.analysis";
const ANALYSIS_SLOTS = Symbol.for(ANALYSIS_SLOTS_KEY);

/**
 * run 表的**顶层绑定表**：
 * - 顶层 const/let（`$recordBinding` 通道，Abs 值）；
 * - **私有**顶层函数声明（宿主 JS 函数；与 ANALYSIS_SLOTS 同源，导出面同名
 *   可枚举键不重复登记——导出函数只走导出表）。
 *
 * 后者供 LSP completion / collectAbsBindingsFromGraph 与导出面复用同一套
 * 宿主函数 → Abs 转换（源码形参表 / ctor facet）。
 */
export function bindingsOf(run: Record<string, unknown>): Map<string, unknown> | undefined {
  return runBindings.get(run);
}

/**
 * 执行一段 求值引擎程序，返回顶层 `export function` / `export const`。
 */
export function runTranspiled(
  source: string,
  opts: RunTranspiledOptions = {},
): Record<string, unknown> {
  // collector 作用域（幂等）：宿主入口包一次；嵌套（checkSource 内 /
  // 导出桥 re-entry）零开销复用外层 store。无外层宿主时行为 = fallback。
  return runWithCollectorScope(() => {
    enterEvalCallBudgetSession(); // 宿主入口：最外层重置；嵌套导出桥继承外层预算
    try {
      try {
        return runTranspiledInner(source, opts);
      } catch (e) {
        // Bug 1139（安全网）：**生成器模式编译失败**（`new Function` 抛
        // SyntaxError：`yield` 落进了嵌套箭头）⇒ 关闭 asyncGen **重试一次**
        // ⇒ `await` 退化为 `$await`（同步近似）⇒ 模块至少**编译得出来**
        // ⇒ 导出可见 ⇒ L2 闸门照常判定。
        //
        // 为什么必须重试而不是直接回落：编译失败 ⇒ **整个模块**的导出全部
        // 丢失 ⇒ 闸门看不到任何入口 ⇒ **零诊断 + exit 0** ⇒ CI 闸门**假绿**
        // （合法代码与违约代码都判绿）。宁可少精确，不可整模块消失。
        //
        // 只在**首次**尝试（未关闭 asyncGen）时重试 ⇒ 不会无限递归。
        if (e instanceof SyntaxError && !opts.disableAsyncGen) {
          return runTranspiledInner(source, { ...opts, disableAsyncGen: true });
        }
        throw e;
      }
    } finally {
      exitEvalCallBudgetSession();
    }
  });
}

function runTranspiledInner(
  source: string,
  opts: RunTranspiledOptions,
): Record<string, unknown> {
  const modules = opts.modules ?? {};
  // Bug 277：CJS 文件的**顶层 this** === module.exports（Node CJS 语义——
  // 包装函数以 `this = module.exports` 调用）。此前顶层 this 恒 $lit(void 0)
  // （ESM 语义）⇒ `this.x = v` 定抛 TypeError ⇒ 整个模块求值失败
  // （fail-closed unknown ⇒ L2 门禁假绿）。
  //
  // 转译器把**顶层** this（及捕获它的顶层箭头）折成 `opts.thisParam`
  // （缺省 `$lit(void 0)` = ESM 语义）；函数体内的 this 走 __this / $rawThis
  // （不受影响）。本处一律给 thisParam，再按文件口味决定该绑定的**值**：
  // - 有 CJS 面（exports/module）⇒ 绑到 exports（=== module.exports）；
  // - 纯 ESM ⇒ 绑 undefined（原生 ESM 顶层 this 就是 undefined）；
  // - 非 ESM 且无 CJS 面（Node `.js` 默认 CJS）⇒ 绑空对象（module.exports
  //   的初始形态）。
  const hasCjsExports = sourceHasCjsExports(source);
  // @nudo:replace / @nudo:as 绑定（模块级 const，在发射产物前注入）。注入名
  // 先算出——它们要并入转译避让集（见下方 userIdents）。
  const reps = opts.replacements ?? {};
  const asVals = opts.asOverrides ?? {};
  const allInject = { ...reps, ...asVals };
  const injectNames = Object.keys(allInject);
  // @nudo:mock 可遮蔽宿主内建（Bug 274：mock 遮蔽宿主全局正是意图）——mock
  // 名以模块级绑定发射（`let <名> = __nudoEnv[...]`），转译器必须按「已遮蔽」
  // 发射标识符读点（$absVal(<名>)），否则未遮蔽面的字面量折叠（$lit(...)）
  // 会让 mock 值被静默丢弃。源内已有的同名绑定由 transpileFile 自行扫描
  // （重复并入无副作用）。
  const mockedIntrinsicNames = Object.keys(opts.mocks ?? {}).filter((n) => HOST_INTRINSIC_SET.has(n));
  const mockNames = new Set(Object.keys(opts.mocks ?? {}));
  // host target：单次 parse 同时产出代码与结构元数据；import/export 在发射期
  // 直接落成 __nudoBind* / __nudoExport*，不再有文本改写阶段。mock 名由发射器
  // 绑定到 __nudoEnv 且不登记 live refresh（刷新会把 mock 冲掉，Bug 274）。
  //
  // env/mock/replace/as 注入名并入转译避让集：host 发射的内部临时名（解构
  // `_d0` / 匿名默认 `__nudoDefaultFn` …）必须避开这些模块级注入名，否则
  // 重复词法声明 ⇒ new Function SyntaxError ⇒ 整文件 fail-closed。源级同名
  // 绑定由 meta.declaredNames 的撞名跳过处理（模块级绑定优先，Bug 273 口径）。
  const transpiled = transpileModule(source, {
    target: "host",
    runtimeImport: null,
    mockNames,
    mode: opts.mode,
    userIdents: new Set([
      ...injectNames,
      ...Object.keys(opts.envGlobals ?? {}),
      ...Object.keys(opts.mocks ?? {}),
    ]),
    maxLoopIters: opts.maxLoopIters,
    source,
    replacements: opts.replacementTargets,
    asOverrides: opts.asOverrideTargets,
    lenientGlobals: opts.lenientGlobals,
    recordPositions: opts.recordPositions,
    thisParam: CJS_THIS_BIND,
    disableAsyncGen: opts.disableAsyncGen,
    ...(mockedIntrinsicNames.length > 0
      ? { shadowedIntrinsics: new Set(mockedIntrinsicNames) }
      : {}),
  });
  let js = transpiled.code;
  const meta = transpiled.meta;
  // 文件口味（strict 前缀 / 顶层 this 的 ESM 值）：meta.isEsm 是 AST 口径，
  // 但 meta 基于**已剥除 TS 的 AST** —— `import type` / `export type` 在剥除
  // 后不留节点，而 .ts 源码因它们**仍是模块**（strict、顶层 this === undefined）。
  // 文本口径补回这一面；JS 源与 AST 口径恒同（注释/字符串/动态 import 都排除）。
  // 旧实现的判据就是文本口径 ⇒ 这里保持行为等价（不因 .ts 类型面变成 sloppy）。
  const isEsmSource = meta.isEsm || sourceHasEsmSyntax(source);
  // 源里有顶层 this（函数体内的 this 不折成本绑定）⇒ 该源需要顶层 this
  // 绑定（否则模块体引用它 → ReferenceError → 整文件求值失败）。
  const usesCjsThis = meta.usesTopLevelThis;

  if (injectNames.length > 0) {
    const binds = injectNames
      .map((n) => `const ${n} = __nudoReplaces[${JSON.stringify(n)}];`)
      .join("\n");
    js = `${binds}\n${js}`;
  }

  // 导出面来自源 AST（meta）：host 产物不残留 export 语句，无需文本回收。
  // 多声明符导出（`export const a = 1, b = 2`）的静态名由源 AST 回收
  // （Bug 280）；发射面已按**真实导出**加 __nudoExport* 调用（私有顶层函数
  // 不再带）⇒ 静态名只含真实导出；私有函数名由下方 hiddenFnNames 单独建
  // 非枚举槽。
  // 静态声明导出名（多声明符全收；解构名走 explicit 面）来自源 AST。
  const staticExportNames = meta.staticExportNames;
  const dynExports: Record<string, unknown> = {};
  // ESM：显式导出（静态 decl 名 + specifier/re-export/default）恒压过
  // export *。star 只填「从未显式导出」的名；star×star 仍按源序后者覆盖。
  // 初始化即完整（host 发射的运行期 __nudoExport* 仍会并入——幂等）。
  const explicitExportNames = new Set<string>([
    ...staticExportNames,
    ...meta.explicitExportNames,
    ...(meta.hasDefault ? ["default"] : []),
  ]);
  // 私有顶层函数**不是**模块导出，但 generalize / 调用点分析仍要能按名直接
  // 调用（callTranspiledExportFull 用 own-property 查表）。它们以**非枚举**
  // 槽先进返回对象——Object.keys(run) 恒等于真正的导出面（service
  // evalExportsToModuleExports 的枚举口径），直接属性访问照常可用。
  // 真实导出名（静态 / specifier）不进私有面 ⇒ 导出槽的插入序与旧实现一致。
  // 名单只能来自源 AST（meta.topLevelFnNames）——转译产物已按真实导出发射
  // __nudoExport* 调用，用它回收会再次把二者混同。
  const topLevelFnNames = meta.topLevelFnNames;
  // 与显式导出同名的私有本地函数不建 hidden 槽（导出槽归导出值）；按名分析
  // 仍由 nudo.analysis 表读**本地绑定**（见下方 analysisSlots）。
  const hiddenFnNames = topLevelFnNames.filter(
    (n) => !explicitExportNames.has(n),
  );
  // 静态槽插入序沿用旧文本回收口径：先**全部导出函数名**（topLevelFnNames
  // 的源序），再其它静态声明名（const/let/class/var、多声明符第 2+ 名；
  // meta.staticExportNames 的源序）。meta 本身是源序，与旧口径在函数/const
  // 混排时不同——这里显式分组，键序不随 meta 实现漂移。
  const staticExportNameSet = new Set(staticExportNames);
  const staticFnNames = topLevelFnNames.filter((n) => staticExportNameSet.has(n));
  const staticFnSet = new Set(staticFnNames);
  const staticExportSlots = [
    ...staticFnNames,
    ...staticExportNames.filter((n) => !staticFnSet.has(n)),
  ];
  const bindings = new Map<string, unknown>();
  // Bug 276：模块**装载期**标志——模块体求值中为 true，模块装载完成后为
  // false（导出函数被调用时为 false）。缺失 require 的抛/不抛按此分（见
  // requireFromModules 注释）：装载期缺失 = 装载失败（引擎保持降级），
  // 调用期缺失 = 抛（原生 MODULE_NOT_FOUND ⇒ catch 臂是活代码）。
  let moduleLoading = true;
  const hostArgNames = [
    "__nudoModules",
    "__nudoBindImport",
    "__nudoBindNamespace",
    "__nudoRegisterImportRefresh",
    "__nudoReplaces",
    "__nudoRequire",
    "__nudoRequireOptional",
    "__nudoEnv",
    "__nudoExport",
    "__nudoExportLazy",
    "__nudoExportStar",
    "__nudoExports",
  ];
  const hostArgs = hostArgNames.map((n) => {
    if (n === "__nudoModules") return modules;
    if (n === "__nudoBindImport") {
      return (spec: string, name: string) => bindImport(modules, spec, name);
    }
    if (n === "__nudoBindNamespace") {
      return (spec: string) => bindNamespace(modules, spec);
    }
    if (n === "__nudoRegisterImportRefresh") {
      return (fn: () => void) => registerLiveImportRefresh(fn);
    }
    if (n === "__nudoReplaces") return allInject;
    if (n === "__nudoRequire") {
      // Bug 276：缺失模块按**装载期 / 调用期**分（见 requireFromModules 注释）
      return (spec: string) => requireFromModules(modules, spec, moduleLoading);
    }
    if (n === "__nudoRequireOptional") {
      return (specs: string[]) => requireOptionalFromModules(modules, specs);
    }
    // mock 与 env 同通道绑定（service eval-run 同口径）：check/generalize
    // 的 inject.mocks 若不进自由标识符作用域，函数体调用会 ReferenceError。
    if (n === "__nudoEnv") return { ...(opts.envGlobals ?? {}), ...(opts.mocks ?? {}) };
    if (n === "__nudoExport") {
      return (name: string, value: unknown) => {
        dynExports[name] = value;
        explicitExportNames.add(name);
      };
    }
    if (n === "__nudoExportLazy") {
      // ESM live binding（Bug ②）：导出槽挂 getter，读取时解析绑定当前值
      return (name: string, get: () => unknown) => {
        Object.defineProperty(dynExports, name, {
          enumerable: true,
          configurable: true,
          get,
        });
        explicitExportNames.add(name);
      };
    }
    if (n === "__nudoExportStar") {
      return (spec: string) => {
        const mod = modules?.[spec];
        if (mod && "named" in (mod as object)) {
          const namedTbl = (mod as AbsModuleExports).named;
          for (const k of Object.keys(namedTbl)) {
            if (explicitExportNames.has(k)) continue;
            // 描述符拷贝：来源 named 表的 live getter 原样传递（名集按源序
            // 当下固定——ESM star 名集是 link-time 属性）
            const d = Object.getOwnPropertyDescriptor(namedTbl, k);
            if (!d) continue;
            Object.defineProperty(
              dynExports,
              k,
              d.get
                ? { enumerable: true, configurable: true, get: d.get }
                : { enumerable: true, configurable: true, writable: true, value: d.value },
            );
          }
        }
      };
    }
    if (n === "__nudoExports") return dynExports;
    return rtAllBindings()[n];
  });

  // @nudo:env 全局 + @nudo:mock 绑定（与 __nudoEnv 合并表一致）。
  //
  // Bug 274：env-skip 名单（getEnvShadowSkipGlobals，「不遮蔽宿主内建」）此前作用在**合并表**上
  // ⇒ `@nudo:mock Math` / `JSON` / `Date` 被**静默丢弃**（no-op）——用户以为
  // mock 生效，实际跑的是宿主内建。口径：skip 名单**只作用于 env 全局**
  // ——mock 的值本身就是一个 Abs，没有宿主对象身份需要保全；遮蔽宿主全局
  // 正是 mock 的意图。
  //
  // let 而非 const：env 全局在原生是 globalThis 的可写属性，`process.exitCode = 1`
  // 这类成员写经 memberPath 写回链重绑根标识符（`process = $set(process, …)`）——
  // const 注入会把它变成原生 TypeError 并毒化整场求值（issue #148：
  // 返回值折 unknown + entry-may-throw）。
  const envTable = opts.envGlobals ?? {};
  const mockTable = opts.mocks ?? {};
  const envInjectNames = Object.keys(envTable).filter((k) => !getEnvShadowSkipGlobals().has(k));
  const mockInjectNames = Object.keys(mockTable);
  const injectCandidates = [...new Set([...envInjectNames, ...mockInjectNames])];
  if (injectCandidates.length > 0) {
    // Bug 273：注入的 `let <名> = …` 与**模块级同名绑定**重复声明 ⇒
    // new Function SyntaxError ⇒ 整文件求值失败（fail-closed unknown ⇒
    // L2 门禁绿灯 exit 0）。口径：**模块级绑定优先**——撞名的注入跳过
    // （import 绑定的 mock 已在发射期改写为读 __nudoEnv 值，此处不再二次
    // 注入；用户自己声明的同名顶层绑定胜出）。占用名 = 源顶层声明 / import
    // 本地名 / CJS 前导 + 发射器条件绑定的 refresh keep 变量 + 上方已拼入的
    // @nudo:replace / @nudo:as 注入绑定。
    const occupied = new Set<string>([
      ...meta.declaredNames,
      "__nudoRefreshKeep",
      ...injectNames,
    ]);
    const injectable = injectCandidates.filter((k) => !occupied.has(k));
    if (injectable.length > 0) {
      const envBinds = injectable
        .map((k) => `let ${k} = __nudoEnv[${JSON.stringify(k)}];`)
        .join("\n");
      js = `${envBinds}\n${js}`;
    }
  }

  // CJS 面：exports.X = v / module.exports 命名空间建模（此前 exports 未绑定
  // → ReferenceError → CJS 文件整体 eval-incapable）。exports = 命名空间 obj Abs
  // （$set 写槽）；module.exports 重赋值 → 单导出（default）。
  // 字符串/注释里的 exports. 不算 CJS 面。
  if (hasCjsExports) {
    // Bug 277：顶层 this === module.exports（Node CJS 语义）——本绑定与
    // exports 同一对象（$set 写槽就地改 ⇒ `this.x = v` 对 module.exports
    // 可见，与原生一致）。
    js = `let exports = $obj({});\nlet module = $obj({ exports });\nconst __nudoCjsOrig = exports;\nlet ${CJS_THIS_BIND} = exports;\n${js}`;
  } else if (usesCjsThis) {
    // 无 exports/module 面的源：顶层 this 仍按文件口味取值——纯 ESM ⇒
    // undefined（原生 ESM 顶层 this 就是 undefined ⇒ `this.x = v` 抛）；
    // 非 ESM（Node `.js` 默认 CJS）⇒ module.exports 的初始形态（空对象）
    // ⇒ `this.x = v` 不再定抛。
    js = `let ${CJS_THIS_BIND} = ${isEsmSource ? "$lit(void 0)" : "$obj({})"};\n${js}`;
  }

  // 动态导出（specifier/re-export/star/default）先展开，静态声明名后写。
  // 冲突语义：显式导出（静态 decl / specifier / 显式 re-export）恒压过 export *
  // （ESM 早错保证 decl/specifier 不重名，star×star 按源序后者覆盖——
  // 与 collectAbsExports 顺序口径一致）。
  const cjsMerge = hasCjsExports
    ? `(() => { const me = $get(module, "exports"); if (me !== __nudoCjsOrig && me && typeof me === "object" && "shape" in me) { return { default: me, [Symbol.for("nudo.cjsMain")]: true }; } const out = {}; if (__nudoCjsOrig && __nudoCjsOrig.shape && __nudoCjsOrig.shape.k === "obj") { for (const k of Object.keys(__nudoCjsOrig.shape.slots)) out[k] = __nudoCjsOrig.shape.slots[k].value; } return out; })()`
    : usesCjsThis
      // 只用顶层 this 的 CJS 源：顶层 this === module.exports ⇒ 其槽即导出面
      ? `(() => { const out = {}; if (${CJS_THIS_BIND} && ${CJS_THIS_BIND}.shape && ${CJS_THIS_BIND}.shape.k === "obj") { for (const k of Object.keys(${CJS_THIS_BIND}.shape.slots)) out[k] = ${CJS_THIS_BIND}.shape.slots[k].value; } return out; })()`
      : "{}";
  // ESM live binding（Bug ②）：导出表是间接引用——返回对象挂 getter：
  // - 动态导出（__nudoExportLazy 的 getter / star 拷贝的 getter）按描述符
  //   迁移（对象字面量展开会把 getter 求值成快照，liveness 断链）；
  // - 静态声明名 getter 读模块作用域当前值（`export let x` 被导出函数
  //   变异后，读取方拿到当前值而非装载完成时刻快照）。
  // 优先级与旧展开形态一致：dyn → cjs → 静态名（显式压过 star/default 合并）。
  // getter 带 converting setter：宿主侧对 run 表槽位再赋值（mock 桥替换、
  // 测试探针）首次写即降级为普通数据槽——对象保持可写，行为与旧快照面兼容。
  //
  // 分析面槽位表（Symbol，非枚举）：**所有**顶层函数本地名 → 读本地绑定的
  // thunk。与导出面解耦——同名 re-export / 别名覆盖本地名时 run[name] 是
  // 导出值，但按函数名分析（generalize / 调用点 / LSP）仍须拿本地绑定。
  // computed key 避免 `__proto__` 字面量走原型设置特例。
  const analysisSlots =
    topLevelFnNames.length === 0
      ? []
      : [
          `  Object.defineProperty(__nudoRet, Symbol.for(${JSON.stringify(ANALYSIS_SLOTS_KEY)}), {`,
          "    enumerable: false, configurable: true,",
          "    value: {",
          ...topLevelFnNames.map((n) => `      [${JSON.stringify(n)}]: () => ${n},`),
          "    },",
          "  });",
        ];
  // 私有顶层函数（hiddenFnNames）先以**非枚举**槽定义：按名分析可用，但
  // Object.keys(run)（模块导出面）看不到。真实导出槽在定义前先 delete 同名
  // 非枚举槽——属性重定义会保留原插入位置，delete 后重建才能让导出键序与
  // 旧实现（dyn → cjs → 静态名）一致。hidden setter 同样 delete 后重建
  // （Object.assign 的 CJS 合并键命中私有槽时，合并名必须是可枚举导出）。
  const hiddenSlots =
    hiddenFnNames.length === 0
      ? []
      : [
          "  const __nudoHidden = (__nudoK, __nudoGet) => Object.defineProperty(__nudoRet, __nudoK, {",
          "    enumerable: false, configurable: true,",
          "    get: __nudoGet,",
          "    set: (__nudoV) => {",
          "      delete __nudoRet[__nudoK];",
          "      Object.defineProperty(__nudoRet, __nudoK, { enumerable: true, configurable: true, writable: true, value: __nudoV });",
          "    },",
          "  });",
          ...hiddenFnNames.map((n) => `  __nudoHidden(${JSON.stringify(n)}, () => ${n});`),
        ];
  // 只有存在非枚举槽时才需要「先删后建」保序；无私有函数时不引入 delete 开销。
  const clearSlots =
    hiddenFnNames.length === 0 ? [] : ["    delete __nudoRet[__nudoK];"];
  const ret = [
    "return (() => {",
    "  const __nudoRet = {};",
    ...analysisSlots,
    ...hiddenSlots,
    "  const __nudoSlot = (__nudoK, __nudoGet) => {",
    ...clearSlots,
    "    Object.defineProperty(__nudoRet, __nudoK, {",
    "      enumerable: true, configurable: true,",
    "      get: __nudoGet,",
    "      set: (__nudoV) => Object.defineProperty(__nudoRet, __nudoK, { enumerable: true, configurable: true, writable: true, value: __nudoV }),",
    "    });",
    "  };",
    "  for (const __nudoK of Reflect.ownKeys(__nudoExports)) {",
    // host 发射对静态声明也发 __nudoExportLazy（live binding）——这里跳过，
    // 由末尾的静态名槽统一建：键插入序保持 dyn → cjs → 静态名（旧实现口径）。
    // 名字集合**内联**在循环里（不建 IIFE 局部绑定）——IIFE 局部名会遮蔽
    // 同名模块级导出（静态槽 getter 读到的就不是用户绑定了）。
    ...(staticExportSlots.length === 0
      ? []
      : [
          `    if ([${staticExportSlots.map((n) => JSON.stringify(n)).join(", ")}].includes(__nudoK)) continue;`,
        ]),
    "    const __nudoD = Object.getOwnPropertyDescriptor(__nudoExports, __nudoK);",
    "    if (__nudoD && __nudoD.enumerable) {",
    "      if (__nudoD.get) __nudoSlot(__nudoK, __nudoD.get);",
    ...(hiddenFnNames.length === 0
      ? ["      else Object.defineProperty(__nudoRet, __nudoK, __nudoD);"]
      : [
          "      else {",
          "        delete __nudoRet[__nudoK];",
          "        Object.defineProperty(__nudoRet, __nudoK, __nudoD);",
          "      }",
        ]),
    "    }",
    "  }",
    `  Object.assign(__nudoRet, ${cjsMerge});`,
    ...staticExportSlots.map((n) => `  __nudoSlot(${JSON.stringify(n)}, () => ${n});`),
    "  return __nudoRet;",
    "})();",
  ].join("\n");
  // Bug 116：求值引擎模块体按 ESM 语义应为 strict——此前 new Function 默认
  // sloppy：静默赋值未声明变量（原生 ESM ReferenceError）、重复参数/八进制
  // 字面量/delete 变量等 sloppy 合法面不抛、函数 this 归一 globalThis（strict
  // 应保 undefined/null）。指令前缀必须是函数体首语句（envBinds/CJS prelude
  // 之前拼入）。注：宿主面折叠不覆盖 arguments.callee 读——$arguments 是纯
  // Abs 构造，该面由 $get 的 Arguments brand 毒丸接管（C1 提交另落）。
  // 修订（benchmark 回退）：strict 只对 ESM 面生效（meta.isEsm——源 AST 含
  // 静态 import/export 或 import.meta）；无 ESM 语法的源按 Node `.js` 默认
  // CJS（sloppy）口径。强制 strict 会让 CJS 里合法的 sloppy 语法（yargs 的
  // `arguments` 绑定/赋值等）在 new Function 编译期直接 SyntaxError
  // （"Unexpected eval or arguments in strict mode"）→ 整模块 fail-closed
  // 空导出，且求值失败不进 memo → 每次全量重转译（yargs check 5.5x）。
  // 源码自身的 "use strict" 指令前缀经 transpile 原样保留，不受此开关影响。
  const strictPrefix = isEsmSource ? `"use strict";\n` : "";
  const fn = compileRuntimeModuleUnit<Record<string, unknown>>(
    `${strictPrefix}${js}\n${ret}`,
    hostArgNames,
  );
  setEvalBindingSink(bindings);
  // BUG-026：开新求值 epoch——同名类碰撞只在
  // 本 run 内判定（跨 run 重注册是常态，
  // last-wins 覆盖语义见 class-registry.ts）
  beginClassEpoch();
  try {
    const result = fn(...runtimeModuleArgValues(), ...hostArgs) as Record<string, unknown>;
    // 私有顶层函数进**绑定表**（LSP completion / collectAbsBindingsFromGraph）：
    // 它们既不在导出面（Object.keys）也不走 $recordBinding（只记录 const/let）。
    // 只补**非枚举**名——导出面同名 re-export / CJS 合并等枚举名不重复登记
    // （导出语义仍走导出槽；按名分析另走 ANALYSIS_SLOTS + preferLocal）。
    const analysis = (result as Record<PropertyKey, unknown>)[ANALYSIS_SLOTS];
    if (analysis !== null && typeof analysis === "object") {
      for (const [n, read] of Object.entries(analysis)) {
        if (Object.getOwnPropertyDescriptor(result, n)?.enumerable === true) continue;
        if (typeof read !== "function") continue;
        bindings.set(n, (read as () => unknown)());
      }
    }
    runBindings.set(result, bindings);
    return result;
  } finally {
    // 模块装载完成 ⇒ 之后的 require 缺失按**调用期**语义抛（Bug 276）
    moduleLoading = false;
    setEvalBindingSink(null);
    // 每次求值出口排空微队列：模块级 Promise.then 不得窜到后续文件的调用窗口
    drainPromiseMicros();
    // BUG-026：同名类碰撞观测——裸名键注册表消歧
    // 失败（不同形 spec 同名注册）排进回落观测面，
    // 不再静默 clobber（查找侧无法消歧：brand 名
    // 即查找键；同形重注册是重评估语义，不在面）
    noteDrainedClassCollisions();
  }
}

/** BUG-026/G3：排空同名类碰撞缓冲进回落观测面。run 顶层出口与
 *  入口调用出口（callTranspiledExportFull）共用——碰撞记录不得
 *  滞留缓冲到下一个无关宿主入口（NudoUnsupportedError 无 path/loc，
 *  滞留即误归属错文件；进程内再无 run 则永不现）。 */
function noteDrainedClassCollisions(): void {
  for (const c of drainClassCollisions()) {
    noteEvalFallback(
      new NudoUnsupportedError(
        "class-collision",
        undefined,
        `class '${c.name}' registered again with a different shape (${c.previous} -> ${c.next}); name-keyed lookup may resolve to either definition`,
      ),
    );
  }
}

/** evaluator 回落事件（观测单一埋点；reason: unsupported:* = 能力边界，internal = 引擎自身缺陷） */
export type EvalFallback = {
  reason: string;
  message: string;
  loc?: { line: number; column: number };
};

/** 回落事件 collector（作用域化：runWithCollectorScope 内各分析互不串台；
 *  无作用域 = fallback 模块级单变量，行为同今日。
 *  注意：_fb* 计数器刻意保持进程级累计（health 指标口径，与 collector 无关）。 */
const evalFallbackCollectorSlot = createScopedSlot<
  ((f: EvalFallback) => void) | null
>(() => null);
registerCollectorScopeParticipant((body) => evalFallbackCollectorSlot.runScoped(body));

export function setEvalFallbackCollector(
  collector: ((f: EvalFallback) => void) | null,
): void {
  evalFallbackCollectorSlot.set(collector);
}

/** 表达式级求值（scan 的 case 字面量实参等静态求值面）：编译单表达式经
 *  eval 运行时执行。bindings：表达式自由标识符 → Abs（调用方按绑定表注入）。
 *  编译失败抛错（调用方按需 catch）。 */
export function evalExprAbs(
  expr: import("@babel/types").Expression,
  bindings: Record<string, Abs> = {},
): Abs {
  // bindings 以编译单元形参注入 ⇒ 同名宿主内建（undefined/NaN/Infinity）被
  // **遮蔽**：转译必须发标识符读点（$absVal）而不是字面量折叠，否则注入值
  // 被静默丢弃。
  const shadowed = Object.keys(bindings).filter((n) => HOST_INTRINSIC_SET.has(n));
  const src = transpileExpression(expr, shadowed.length > 0 ? { shadowedIntrinsics: new Set(shadowed) } : {});
  // 运行时符号由 compileRuntimeUnit 以形参注入 ⇒ 单元不拼运行时 import 行
  // （宿主编译单元一律无 import/export 语句）。
  const js = [
    // Bug 116：case 实参等单表达式面同模块体 ESM 语义——strict 前缀
    `"use strict";`,
    `return (${src});`,
  ].join("\n");
  const factory = compileRuntimeUnit<Abs>(js, Object.keys(bindings));
  return factory(...runtimeArgValues(), ...Object.values(bindings));
}

/** 回落计数（D6-A：internal 可暴露为 health 指标，不静默吞） */
export type EvalFallbackStats = {
  internal: number;
  unsupported: number;
  moduleThrow: number;
  total: number;
};

let _fbInternal = 0;
let _fbUnsupported = 0;
let _fbModuleThrow = 0;

/** 始终累计（与 collector 无关）——health / 测试读同一口径 */
export function getEvalFallbackStats(): EvalFallbackStats {
  return {
    internal: _fbInternal,
    unsupported: _fbUnsupported,
    moduleThrow: _fbModuleThrow,
    total: _fbInternal + _fbUnsupported + _fbModuleThrow,
  };
}

/** 宿主入口 / health 按文件分析前重置 */
export function resetEvalFallbackStats(): void {
  _fbInternal = 0;
  _fbUnsupported = 0;
  _fbModuleThrow = 0;
}

/** 回落事件归类（unsupported:* 能力边界 / module-throw 程序自身抛 / internal 引擎缺陷） */
function evalFallbackOf(e: unknown): EvalFallback {
  return e instanceof NudoUnsupportedError
    ? { reason: `unsupported:${e.reason}`, message: e.message, ...(e.loc ? { loc: e.loc } : {}) }
    : isNudoThrow(e)
      ? // NudoThrow：程序自身的抛（如顶层 this 写 / strict 写 TypeError）——
        // 模块装载失败，不是 B 能力边界也不是 B 缺陷（catch 可吸收）
        { reason: "module-throw", message: e instanceof Error ? e.message : String(e) }
      : { reason: "internal", message: e instanceof Error ? e.message : String(e) };
}

/** 记录一次 B 回落（body-fn / tryRunTranspiled / call 边界兜底共用） */
export function noteEvalFallback(e: unknown): void {
  const f: EvalFallback = evalFallbackOf(e);
  if (f.reason === "internal") _fbInternal++;
  else if (f.reason === "module-throw") _fbModuleThrow++;
  else if (f.reason.startsWith("unsupported:")) _fbUnsupported++;
  const evalFallbackCollector = evalFallbackCollectorSlot.get();
  if (!evalFallbackCollector) return;
  try {
    evalFallbackCollector(f);
  } catch {
    /* collector 不得打断 */
  }
}

/**
 * B 单一入口：runTranspiled + 类型化回落观测。
 * unsupported:*（能力边界）/ internal（B 缺陷）都记录到收集器；
 * 返回 undefined 表示调用方应走解释路径。
 */
/** run 表是否来自 CJS `module.exports = X` 重赋值形态（供桥接层标 cjsMain）。 */
export function isCjsMainRun(run: Record<string, unknown>): boolean {
  return Boolean((run as Record<PropertyKey, unknown>)[Symbol.for("nudo.cjsMain")]);
}

export function tryRunTranspiled(
  source: string,
  opts: RunTranspiledOptions = {},
): Record<string, unknown> | undefined {
  try {
    return runTranspiled(source, opts);
  } catch (e) {
    noteEvalFallback(e);
    return undefined;
  }
}

/**
 * tryRunTranspiled 的**详细形态**：回落原因随失败一起返回。
 *
 * Bug 380：转译器拒绝构造 ⇒ tryRunTranspiled 返回 undefined ⇒ L2 证据面
 * （check-may-throw.ts）把「**没分析出** may-throw」与「**分析出没有**
 * may-throw」当成同一件事 ⇒ 门禁由红转绿。失败原因必须**可观测**，
 * 调用方才能 fail-closed（把「不可判定」显式交给门禁）。
 *
 * 不进 exec/index.ts 的公开面（模块内可见即可；公开面零新增）。
 */
export type TranspileAttempt = {
  /** 成功时的 run 表（导出槽 → 值） */
  run?: Record<string, unknown>;
  /** 失败时的回落原因（unsupported:* / module-throw / internal） */
  fallback?: EvalFallback;
};

export function tryRunTranspiledDetailed(
  source: string,
  opts: RunTranspiledOptions = {},
): TranspileAttempt {
  try {
    return { run: runTranspiled(source, opts) };
  } catch (e) {
    noteEvalFallback(e);
    return { fallback: evalFallbackOf(e) };
  }
}

export type TranspiledCallResult = {
  result: Abs;
  /** 非 never 表示函数可能 throw 该类型 */
  throws: Abs;
};

export function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
}

/** 调用 runTranspiled 导出（捕获 $throw）。opts.phi：入口 Φ 种子
 *  （instantiate/symbolic 的约束入口——eval 侧路径条件收窄）。
 *  opts.shareArgs：evaluator 内部桥（跨模块 import / mock 文件桥，
 *  callTranspiledExportApply）传引用——被调方对容器实参的变异必须对
 *  caller 帧可见（与同文件闭包调用同语义）；宿主重放（case/记录/LSP）
 *  不传，保持 D1 防御副本。
 *  opts.preferLocal：**分析面**语义——按源码本地函数名解析
 *  （nudo.analysis 表优先）。默认 false = 导出语义（callTranspiledExportApply
 *  跨模块导出桥必须走导出槽；同名 re-export / CJS 合并值不得被本地函数顶替）。
 *  嵌套进入（导出桥 apply）继承外层预算；仅最外层宿主入口重置。
 *  #152 assume 前提不设选项位：播种统一走 withAssumePremises 动态域
 *  包裹（check.ts 的 runSeeded extent），单一机制无第二路径。 */
export function callTranspiledExportFull(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
  opts?: { phi?: Phi; shareArgs?: boolean; preferLocal?: boolean },
): TranspiledCallResult {
  // collector 作用域（幂等）：同 runTranspiled——最外层宿主入口开 store，
  // 嵌套（同一次分析内的逐导出调用 / 导出桥）复用外层。
  return runWithCollectorScope(() => {
    enterEvalCallBudgetSession();
    // G3（BUG-026 epoch 作用域）：入口调用阶段自成求值单元——函数体内
    // 块级同名类正是在此注册（不在 runTranspiled 顶层）。开新 epoch：
    // ① 缓存命中（tryRunEval 不重跑 run）后的重执行不得与无关文件
    // 刚完成 fresh run 的同名类共享陈旧 epoch（跨文件同名类按设计走
    // last-wins 静默）；② 出口排水使碰撞在本次分析即可观测，不再滞留
    // 缓冲误归属到下一个无关 run。last-wins 解析语义不变（观测面修复）。
    beginClassEpoch();
    try {
      // Bug 456：调用**入口**刷新 ESM live import 绑定。此前只在 $call 出口
      // 刷新（调用返回后重读依赖当前导出值）⇒ 被调方在**本次调用内**读到的
      // import 绑定是上一次调用留下的旧值。ESM import 环（a ⇄ b）里先求值的
      // 一侧绑定到 unknown（对侧尚未求值），于是环内第一次调用恒得 unknown，
      // 第二次才开始正确——同一导出按调用次序给出不同结果（原生恒定值）。
      // 入口刷新 = 被调方读绑定前先对齐到依赖当前导出值（ESM live binding
      // 语义）。refresh 闭包纯读不发起新调用（无重入）；注册表空时零开销。
      refreshLiveImports();
      return callTranspiledExportFullInner(exports, name, args, opts);
    } finally {
      exitEvalCallBudgetSession();
      noteDrainedClassCollisions();
    }
  });
}

/**
 * 调用目标解析。默认 = **导出语义**：`exports[name]`（own-property；含
 * 无同名导出冲突时的私有 hidden 槽）。`preferLocal` = **分析面语义**：
 * 先查 nudo.analysis 表（源码本地绑定），再回落导出槽。
 *
 * run 表的字符串键是导出面——同名 re-export / CJS 合并会覆盖私有本地函数名。
 * 按函数名分析（generalize / 调用点 / LSP replay）必须显式 preferLocal；
 * 导出桥（callTranspiledExportApply）必须保持默认，否则跨模块 import 的
 * 被调方会被同名的本地私有函数顶替。
 */
function callTargetOf(
  exports: Record<string, unknown>,
  name: string,
  preferLocal: boolean,
): unknown {
  if (preferLocal) {
    const analysis = (exports as Record<PropertyKey, unknown>)[ANALYSIS_SLOTS];
    if (
      analysis !== null &&
      typeof analysis === "object" &&
      Object.hasOwn(analysis, name)
    ) {
      const read = (analysis as Record<string, unknown>)[name];
      // 生成表值恒为 thunk（读本地绑定，保持 live 语义）
      return typeof read === "function" ? (read as () => unknown)() : read;
    }
  }
  // own-property：name 为 toString/constructor 等 Object.prototype 成员且模块
  // 无同名自有导出时，裸读会把原型方法当导出调用（constructor 曾原样返回实参）
  return Object.hasOwn(exports, name) ? exports[name] : undefined;
}

function callTranspiledExportFullInner(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
  opts?: { phi?: Phi; shareArgs?: boolean; preferLocal?: boolean },
): TranspiledCallResult {
  const fn = callTargetOf(exports, name, opts?.preferLocal === true);
  if (typeof fn === "function") {
    // 宿主裸值（raw string/array/number…）先经 asAbsVal 收成 Abs（与 $fork
    // 对缺参/宿主裸值同口径）：否则裸值流进代数算子（$not/$forOf/…）读
    // .shape.k 直接 TypeError，被记成 internal 回落 + throws TypeError
    // （症状 B：raw 数组实参 → `Cannot read properties of undefined
    // (reading 'k')`）。raw 字面量收成 exact lit，具体实参照常精确求值。
    // D1：宿主重放（case/记录/LSP）用副本——mutator 不得把入参态污染回
    // 调用方/记录。evaluator 内部桥（shareArgs，跨模块 import 调用）传
    // 引用：JS 引用语义下被调方变异必须写回 caller 帧（h.n = v 后 caller
    // 读 h.n 得 v，back === h 折 true）——复制会让 caller 绑定读到 stale
    // 值（假 exact），与同文件闭包调用（直达、无副本）语义分叉。
    // 一次调用内共用身份图 memo：`f(obj, obj)` 的两个实参必须映射到同一个
    // 副本（原生别名语义）；自引用实参也不能让快照栈溢出。
    const copyMemo = new WeakMap<object, Abs>();
    const callArgs = args.map((a) => {
      if (!(a && typeof a === "object" && "shape" in (a as object))) return asAbsVal(a);
      return opts?.shareArgs ? (a as Abs) : $copy(a as Abs, copyMemo);
    });
    return runExportCallGuarded(() => {
      const invoke = () =>
        withNewTargetReset(() => (fn as (...a: Abs[]) => unknown)(...callArgs));
      return opts?.phi ? withExecPhi(opts.phi, invoke) : invoke();
    });
  }
  if (isAbsVal(fn)) {
    // export const f = (x) => …：导出值是一等 fn Abs —— 按调用语义 apply
    if (fn.shape.k === "fn") {
      return runExportCallGuarded(() => $call(fn, args), {
        // 观测结果回填 fn.returnType 槽（与类方法槽同口径，展示用
        // 不回写分析）——arity-only fn Abs 调用后携带真实返回
        onNormal: (r) => refineFnReturnType(fn, r),
        // $call 内冒出的原生 ReferenceError（编译体自由名）属引擎回落面：
        // 保持 noteEvalFallback + fail-closed unknown，不走 JS 导出分支的
        // 「原生必抛」TDZ 路由（throws 面两路一致，结果面为既有差异）。
        referenceErrorIsFallback: true,
      });
    }
    drainPromiseMicros();
    return { result: fn, throws: never };
  }
  drainPromiseMicros();
  return { result: unknown, throws: never };
}

/**
 * 导出调用的**单一**调用/退出/异常骨架（JS 函数导出与一等 fn Abs 导出共用）。
 *
 * 契约（两个导出分支不得各自长回一份）：
 * - `runWithLoopExits` 框住 invoke + catch：invoke 期间记入的 loop/throw exits
 *   与正常出口 / 异常出口在同一作用域内 join；
 * - 正常返回：先 `drainPromiseMicros()`（同步返回值算完后跑 then/catch 回调），
 *   再经 asAbsVal 收形（宿主裸值 → Abs），`joinControlExits` join 早退 exits，
 *   最后 `onNormal(joined.result)`（Abs fn 分支的 returnType 观测回填）；
 * - `NudoReturn` → 返回值（与 exits join）；`NudoThrow` → result=never + throws=载荷；
 * - 原生 ReferenceError → result=never + throws=ReferenceError（`referenceErrorIsFallback`
 *   时按引擎回落处理：见选项）；
 * - 其余原生异常 → `noteEvalFallback(e)`（D6-A canary，不静默吞）+ result=unknown
 *   （fail-closed，不谎称 never）+ throws=throwPayloadOf(e)。
 *
 * 每个出口（正常 / NudoReturn / NudoThrow / 原生异常）都先排空微队列，与旧
 * 两份骨架逐路径一致。
 */
function runExportCallGuarded(
  invoke: () => unknown,
  opts?: {
    /** 正常出口 join 后、返回前（Abs fn 分支的 fn.returnType 观测回填） */
    onNormal?: (r: Abs) => void;
    /** Abs fn 分支：$call 冒出的原生 ReferenceError 按引擎回落处理
     *  （noteEvalFallback + unknown），而非 JS 导出分支的「原生必抛」never */
    referenceErrorIsFallback?: boolean;
  },
): TranspiledCallResult {
  return runWithLoopExits(() => {
    try {
      const r = invoke();
      // 微任务（then/catch 回调）在同步返回值算完后才跑
      drainPromiseMicros();
      // Bug 26：宿主裸值（裸全局标识符 return parseInt 等）先经 asAbsVal
      // 收成 Abs（与调用入参同口径）——宿主函数折一等 fn Abs，裸
      // 原始值折字面量，不再弃成 unknown
      const joined = joinControlExits(isAbsVal(r) ? r : asAbsVal(r));
      opts?.onNormal?.(joined.result);
      return joined;
    } catch (e) {
      drainPromiseMicros();
      // C2.1：循环体 $loopReturn → 函数返回值（与 exits join）
      if (isNudoReturn(e)) {
        return joinControlExits(e.absValue);
      }
      if (isNudoThrow(e)) {
        // 全臂 throw：兄弟 throw 已在 throwExits；与早退 exits 一并考虑
        const result = joinLoopExits(never);
        const throws = joinThrowExits(e.absValue);
        return { result, throws };
      }
      // 原生 ReferenceError：class TDZ / 未声明引用——原生必抛，记入 throws
      if (!opts?.referenceErrorIsFallback && e instanceof ReferenceError) {
        return {
          result: joinLoopExits(never),
          throws: joinThrowExits(errorTypeAbs("ReferenceError")),
        };
      }
      // 其余原生异常（TypeError/RangeError/栈溢出/引擎缺陷…）也必须进 throws 域：
      // 折成「… + throws=never」会假报「保证不抛」（L2 entry-may-throw 假阴性）。
      // result 保持 fail-closed unknown（不谎称 never）。
      // D6-A canary：与 tryRunTranspiled 同口径记 internal 回落（不静默吞）。
      noteEvalFallback(e);
      return {
        result: joinLoopExits(unknown),
        throws: joinThrowExits(throwPayloadOf(e)),
      };
    }
  });
}

function joinLoopExits(normal: Abs): Abs {
  const exits = takeLoopExits();
  if (exits.length === 0) return normal;
  return exits.reduce((acc, x) => joinAbs(acc, x), normal);
}

function joinThrowExits(base: Abs | undefined): Abs {
  const exits = takeThrowExits();
  let t = base;
  for (const x of exits) t = t ? joinAbs(t, x) : x;
  return t ?? never;
}

function joinControlExits(normal: Abs): { result: Abs; throws: Abs } {
  return { result: joinLoopExits(normal), throws: joinThrowExits(undefined) };
}

/** 调用 runTranspiled 导出（仅结果） */
export function callTranspiledExport(
  exports: Record<string, unknown>,
  name: string,
  args: Abs[],
): Abs {
  return callTranspiledExportFull(exports, name, args).result;
}

/**
 * 包装 runTranspiled 导出为 Abs apply 钩子——throws 面经返回值通道强制保留
 * （H1 / DESIGN-003）。这是包装 `callTranspiledExportFull` 的**唯一入口**：
 * 返回 AbsApplyResult（`{abs, throws}`），$call 统一路由 throws。
 * 手拆 `.result` 会静默丢 throws 面（BUG-006 根因）。
 *
 * 桥是 evaluator 内部调用（caller 帧 → 跨模块 import）：实参传引用
 * （shareArgs），被调方 mutator 写回 caller 绑定——与同文件闭包调用同语义；
 * 宿主重放不走此工厂，保持 D1 防御副本。
 *
 * `exports` 可传惰性 getter（互递归模块桥：导出表在桥创建后才赋值）。
 *
 * **不传 preferLocal**：跨模块 import 桥必须调用**导出值**（同名 re-export /
 * CJS 合并不得被本地私有函数顶替）；按名分析由调用方显式 preferLocal。
 */
export function callTranspiledExportApply(
  exports: Record<string, unknown> | (() => Record<string, unknown>),
  name: string,
): (args: Abs[], thisVal?: Abs) => AbsApplyResult {
  const resolve = typeof exports === "function" ? exports : () => exports;
  return (args: Abs[]) => {
    const full = callTranspiledExportFull(resolve(), name, args, { shareArgs: true });
    return makeAbsApplyResult(full.result, full.throws);
  };
}
