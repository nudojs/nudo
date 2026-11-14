/**
 * 求值引擎能力判定 + 进程内 transpile 执行（service 入口）。
 *
 * 分析默认 mode="analyze"：不执行顶层副作用，只保留函数定义。
 * throws 经 callTranspiledExportFull 捕获 $throw。
 *
 * 拆叶（ServiceReviewer S2）：env 全局/模块表与 harvest 合并在 `env-modules.ts`，
 * evaluator run 缓存与缓存键指纹在 `eval-cache.ts`——两叶均不环入本模块；
 * 符号在此转出以保持既有导入面（`eval-run.ts` 是公开入口）。
 */

import { $invoke, runTranspiled, callTranspiledExport, callTranspiledExportFull, setEvalCallCollector, noteEvalFallback, isAbsVal, isNudoThrow, never, withExecPhi, type EvalCallRecord, type TranspiledCallResult, type Abs, type AbsModuleExports, type Phi } from "@nudojs/core";
import { setMemberDiagCollector, setAbsTruncationCollector, runWithCollectorScope, type EvalMemberDiag, stableAnalyzeKeySource } from "@nudojs/core/internal";
import { parse, type FileDirective } from "@nudojs/parser";
import { dirname } from "node:path";
import { pathEnvPreloadFingerprint } from "./evaluator/env-loader.ts";
import { evalAbsModuleGraph, type AbsGraphOptions, type AbsModuleLoadIssue } from "./abs-modules-graph.ts";
import { applyMockModuleDirectives, applyMockModuleDirectivesFromSource } from "./mock-module.ts";
import { mockScopeSelected, type FromMockError } from "./mock-abs.ts";
import { type LoadModule } from "./load-module.ts";
import { collectEvalReplacementsFromProgram } from "./eval-injection.ts";
import { cjsObjectExportMemberNames } from "./analyzer-ast.ts";
import { applyPureMarkers, pureFnNamesOfAst } from "./eval-pure.ts";
import { collectEnvGlobals, collectEnvModules, mergeHarvestUnderEnv } from "./env-modules.ts";
import {
  evalCacheGet,
  evalCachePeek,
  evalCacheSet,
  evalCacheEntryMatches,
  evalDepKey,
  mockSeedFingerprint,
  pathEnvContentFingerprint,
} from "./eval-cache.ts";

/**
 * 行内指令注入表（@nudo:replace / @nudo:as）——收集器在叶子模块
 * `eval-injection.ts`（根侧与依赖侧共用，避免 eval-run ↔ abs-modules-graph 成环）。
 * 这里转出以保持既有导入面（`eval-run.ts` 是公开入口）。
 */
export { collectEvalReplacements, resolveEvalInjection, type EvalInjection } from "./eval-injection.ts";

/** env 全局/模块表 + harvest 合并（拆叶转出，见文件头） */
export {
  collectEnvGlobals,
  collectEnvModules,
  mergeHarvestUnderEnv,
  setEnvHarvestConflictCollector,
  getEnvHarvestConflictCollector,
  type EnvHarvestConflict,
  type MergeHarvestOptions,
} from "./env-modules.ts";

/** evaluator run 缓存 + 缓存键指纹（拆叶转出，见文件头） */
export {
  pathEnvContentFingerprint,
  mockSeedFingerprint,
  clearEvalCache,
  evictEvalCacheForFiles,
  trimEvalCache,
  getEvalCacheSize,
} from "./eval-cache.ts";

export type EvalRunResult = {
  exports: Record<string, unknown>;
  modules: Record<string, AbsModuleExports>;
  /** 顶层执行期 method-missing */
  memberDiags?: EvalMemberDiag[];
  /** 模块图 cycle/depth/missing（eval 权威） */
  moduleIssues?: import("./abs-modules-graph.ts").AbsModuleLoadIssue[];
  /** Abs 求值递归截断的函数标签 */
  truncatedFns?: string[];
  /** 顶层 $callNamed 调用点（call@ 合成；setEvalCallCollector 采集面） */
  calls?: EvalCallRecord[];
};

/**
 * 模块图组装的共享产物：analyzer 与 tryRunEval 走同一序列
 * （evalAbsModuleGraph → collectEnvModules → mergeHarvestUnderEnv →
 * applyMockModule*），单一事实源，不再各自漂移。
 */
export type ComposedEvalModules = {
  modules: Record<string, AbsModuleExports>;
  /** 模块图 cycle/depth/missing/missing-export（eval 权威） */
  issues: AbsModuleLoadIssue[];
  /** @nudo:mock-module 应用失败（analyzer 映射 nudo:module-missing 诊断） */
  mockErrors: string[];
  /**
   * 同上的**结构化**形态（name/fromPath/message/code）——inject 装配面
   * （buildEvalInjection）消费；analyzer 面仍读 mockErrors（按 message 映射）。
   */
  mockModuleErrors: FromMockError[];
};

/**
 * 模块图组装单一入口：相对/harvest 模块图 → @nudo:env modules 并入
 * （手写 env wins，B8）→ @nudo:mock-module 覆盖。
 * `fileDirectives`：调用方已抽取的文件指令（省一次 parse）；缺省从 source 解析。
 *
 * 消费方差异全部显式参数化（ServiceReviewer S1，装配序列归一）：
 * - `seedVars` / `seedFns`：analyzer 面把 @nudo:mock 种子注入**模块图**（B 路径
 *   成员求值用）；inject 装配面不传——其 mock 走 runTranspiled 的
 *   `inject.mocks`（运行时注入，不入图），两口径不得混。
 * - `loadModule`：宿主加载器（虚拟 FS / 侧车），透传图组装与 mock-module。
 * - `fileDirectives`：预抽取 vs 从 source 解析（省一次 parse）。
 */
export function composeEvalModules(
  source: string,
  filePath: string,
  opts: {
    envNames?: string[];
    seedVars?: Record<string, Abs>;
    seedFns?: AbsGraphOptions["seedFns"];
    /** 宿主模块加载器（虚拟 FS / 侧车）；缺省 defaultAbsLoadModule */
    loadModule?: LoadModule;
    fileDirectives?: FileDirective[];
  } = {},
): ComposedEvalModules {
  const g = evalAbsModuleGraph(source, filePath, {
    ...(opts.seedVars ? { seedVars: opts.seedVars } : {}),
    ...(opts.seedFns ? { seedFns: opts.seedFns } : {}),
    ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
  });
  // env modules 必须并入图：@nudo:env 的 node:* / 裸包由 loadEnvs 提供，
  // 模块图只处理相对 import 与 harvest 裸包（跳过 node: 前缀）。
  let modules = mergeHarvestUnderEnv(g.modules, collectEnvModules(opts.envNames ?? []));
  const mockOpts = {
    fromFile: filePath,
    ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
  };
  const mm = opts.fileDirectives
    ? applyMockModuleDirectives(modules, opts.fileDirectives, mockOpts)
    : applyMockModuleDirectivesFromSource(source, modules, mockOpts);
  modules = mm.modules;
  return {
    modules,
    issues: g.issues,
    mockErrors: mm.errors.map((e) => e.message),
    mockModuleErrors: mm.errors,
  };
}

/** 模块图 + runTranspiled（默认 analyze 模式） */
export function tryRunEval(
  source: string,
  filePath: string,
  opts: {
    maxLoopIters?: number;
    mode?: "exec" | "analyze";
    envNames?: string[];
    /** @nudo:mock → Abs，注入为全局绑定（防止顶层调用真 fetch 等） */
    mocks?: Record<string, Abs>;
    /** 宽松全局（调用点发现 exec 采集） */
    lenientGlobals?: boolean;
    /** 宿主模块加载器（虚拟 FS / 侧车）；透传图组装与 depKey，缺省 defaultLoadModule */
    loadModule?: LoadModule;
    /**
     * 宿主已计算的依赖指纹（hashSource(loadModuleDepsFingerprint(src, loader, path).fp)）。
     * 提供时跳过重算（per-fn 循环复用宿主一次 BFS，R2-5）；null = fail-closed 禁缓存。
     */
    depKey?: string | null;
    /** 宿主已组装的模块图（analyzer 一次分析内复用，消除重复 parse/eval） */
    composed?: ComposedEvalModules;
    /**
     * 新建独立模块实例（不复用 memo 里的活实例）——调用面专用。
     * memo 里的实例捕获着模块级 `let` 绑定：一次调用改写它，后续用例
     * 就会看到被污染的状态（合成 entry@ 用例之间「串味」，Bug 472）。
     * fresh 实例只重建**根模块**（依赖模块图共享——与原生「同一依赖实例」
     * 一致）；fresh 结果不入 memo 的 value（实例会被调用污染）。
     */
    fresh?: boolean;
  } = {},
): EvalRunResult | undefined {
  // collector 作用域（幂等）：本入口安装 collector，先开作用域再装才能隔离；
  // 嵌套（checkSource / 宿主外层已开）零开销复用外层 store。
  return runWithCollectorScope(() => {
    const mode = opts.mode ?? "analyze";
    // env 维度 = 名字 + 项目级 path env 的**内容**（Bug 501：env 文件改了
    // 类型必须跟着变——只编码名字会让 memo 命中陈旧导出表）
    // + **预载状态**（Bug 993：path 型 env 只能异步装载，同一份源码在
    // 「预载前 / 预载后」得到两份不同结果——env 全局可见性不同。内容指纹
    // 两边相同 ⇒ 不加这一段时「先同步（未预载）、后异步（已预载）」会命中
    // 前者那份「无 env」的陈旧 memo）。
    const envKey = `${(opts.envNames ?? []).join(",")}#${pathEnvContentFingerprint(
      opts.envNames ?? [],
      dirname(filePath),
    )}#${pathEnvPreloadFingerprint() || "-"}`;
    const mockKey = mockSeedFingerprint(opts.mocks);
    const lenientKey = opts.lenientGlobals === true ? "1" : "0";
    const itersKey = opts.maxLoopIters === undefined ? "" : String(opts.maxLoopIters);
    // fresh：新建独立模块实例（不复用 memo 里的活实例）——调用面专用。
    const fresh = opts.fresh === true;
    // 尾部无 @nudo 注释不参与：comment-only 编辑命中 evaluator。
    // 同 source 引用时 stable 快路径返回原串 → 下方 === 为 O(1)。
    const stable = stableAnalyzeKeySource(source);
    // 指纹截断/异常 → 禁止读写 memo（fail-closed）；0 = 关闭：读路径也
    // miss（evalCacheGet 内判）
    const depKey = opts.depKey !== undefined ? opts.depKey : evalDepKey(source, filePath, opts.loadModule);
    const canCache = depKey !== null;
    // 六维键打包：读命中与写回 sameSlot 共用 evalCacheEntryMatches（单一
    // 谓词，eval-cache）——两处各留 === 链会漂移（新增维度只改一边）。
    // canCache=false（depKey=null）时读/写均不发生，此处打包无害。
    const dims = { stableSource: stable, envKey, mockKey, depKey: depKey!, lenientKey, itersKey };
    /** fresh 路径复用 memo 里的组图（依赖状态共享，根模块状态独立） */
    let cachedComposed: ComposedEvalModules | undefined;
    // evalCacheGet：命中刷新 MRU（BoundedLruMap.get）
    const cached = canCache ? evalCacheGet(filePath, mode) : undefined;
    if (cached && evalCacheEntryMatches(cached, dims)) {
      if (!fresh) {
        // memo 里的实例可能被调用污染过（模块级状态）→ 调用面不得复用
        if (cached.value) return cached.value;
      } else {
        cachedComposed = cached.composed;
      }
    }
    let out: EvalRunResult | null = null;
    /** 本轮实际使用的组图（写 memo 时带上——fresh 路径据此复用） */
    let usedComposed: ComposedEvalModules | undefined;
    try {
      const memberDiags: EvalMemberDiag[] = [];
      const truncated = new Set<string>();
      const topCalls: EvalCallRecord[] = [];
      // collector 先于模块图：import 函数体在 evalAbsModuleGraph 内的 method-missing 也要收
      const prevMember = setMemberDiagCollector((d) => memberDiags.push(d));
      const prevTrunc = setAbsTruncationCollector((label, reason) => {
        truncated.add(label);
        // BUG-099：**链式**转发。collector 是单槽，装自己的就把外层的截断观察
        // 面（analyzer 的诊断映射、宿主回调）静默掐断——`nudo test` / `--json`
        // 面因此看不到任何递归/预算截断。setter 只存槽不回调，故闭包内引用
        // `prevTrunc` 时它已初始化。
        prevTrunc?.(label, reason);
      });
      const prevCall = setEvalCallCollector((r) => topCalls.push(r));
      try {
        // 单一组装入口（与 analyzer 共用）；宿主已组装时直接复用；
        // fresh 路径复用 memo 里的组图（依赖状态共享、根模块状态独立）
        const composed =
          opts.composed ??
          cachedComposed ??
          composeEvalModules(source, filePath, {
            envNames: opts.envNames,
            loadModule: opts.loadModule,
          });
        usedComposed = composed;
        const modules = composed.modules;
        // 一次 parse 两用：行内指令注入表（@nudo:as / @nudo:replace）
        // + 纯函数名（@nudo:pure）——同源同次，避免重复 parse。
        const ast = parse(source, { filename: filePath });
        const { targets, values, asTargets, asValues } = collectEvalReplacementsFromProgram(
          ast.program,
          source,
        );
        const pureFns = pureFnNamesOfAst(ast);
        // Bug 274（service 侧剩余半边）：mock 与 env **分表传**。
        //
        // 此前 mock 被并进 `envGlobals` 一张表 ⇒ core 收到时**分不清哪些是
        // mock** ⇒ core 注入面的「不遮蔽宿主内建」跳过表（ENV_SHADOW_SKIP，
        // 只该作用于 env 全局）把名单内的 mock 一并吞掉 ⇒
        // `@nudo:mock Math` / `JSON` / `Date` 静默 no-op（跑的是宿主内建）。
        //
        // 口径：env 全局只装 env；mock 走 `mocks` 形参（core 按两张表分别
        // 过滤）。**优先级不变**——core 的 `__nudoEnv` 读面是
        // `{ ...(opts.envGlobals ?? {}), ...(opts.mocks ?? {}) }` ⇒ 同名时
        // mock 覆盖 env（与此前「合并表里 mock 在后」逐字等价）。
        const envGlobals = collectEnvGlobals(opts.envNames ?? []);
        const mocks = opts.mocks ?? {};
        const exports = runTranspiled(source, {
          modules: modules as never,
          maxLoopIters: opts.maxLoopIters,
          mode,
          replacementTargets: targets.length ? targets : undefined,
          replacements: targets.length ? values : undefined,
          asOverrideTargets: asTargets.length ? asTargets : undefined,
          asOverrides: asTargets.length ? asValues : undefined,
          envGlobals: Object.keys(envGlobals).length ? envGlobals : undefined,
          mocks: Object.keys(mocks).length ? mocks : undefined,
          lenientGlobals: opts.lenientGlobals,
          filename: filePath,
        });
        // 纯度标记落在**刚诞生的这个实例**上（Bug 462 + 分片 J 的 fresh
        // 语义）：memo 实例与 fresh 实例都带标记 ⇒ 标记与调用点解析到
        // 同一对象身份（memo 以对象身份为键）。
        applyPureMarkers(exports, pureFns);
        out = {
          exports,
          modules,
          memberDiags: memberDiags.length ? memberDiags : undefined,
          moduleIssues: composed.issues.length ? composed.issues : undefined,
          truncatedFns: truncated.size ? [...truncated] : undefined,
          calls: topCalls.length ? topCalls : undefined,
        };
      } finally {
        setMemberDiagCollector(prevMember);
        setAbsTruncationCollector(prevTrunc);
        setEvalCallCollector(prevCall);
      }
    } catch (e) {
      // 与 tryRunTranspiled 同口径：失败可观测，且不得写入 memo
      // （瞬时失败入缓存会把该 source 固化成永久空导出）
      //
      // **装载期**失败 ⇒ 该文件的模块装载失败（导出全丢）⇒ 闸门看不到任何
      // 入口 ⇒ 假绿（BUG-072）⇒ 标 loadFailure：可见性（fail-closed）与
      // 标签（BUG-073：用户代码的原生异常 ⇒ module-throw）**分列两维**。
      noteEvalFallback(e, "module", { loadFailure: true });
      out = null;
    }
    if (out !== null && canCache) {
      // 纯读探测（不刷新 MRU）：写回 evalCacheSet 自会刷新
      const prev = evalCachePeek(filePath, mode);
      // 同槽判定与读命中共用同一谓词（任一维不同 ⇒ 旧 value 不续期）
      const sameSlot = prev !== undefined && evalCacheEntryMatches(prev, dims);
      if (fresh) {
        // fresh 实例会被调用污染 → **不入 memo 的 value**；只补齐组图
        // （memo 里的干净实例保持不变，供分析面复用）
        evalCacheSet(filePath, mode, {
          ...dims,
          composed: usedComposed,
          value: sameSlot ? prev?.value : undefined,
        });
      } else {
        evalCacheSet(filePath, mode, {
          ...dims,
          composed: usedComposed,
          value: out,
        });
      }
    }
    return out ?? undefined;
  });
}

/**
 * CJS 对象字面量导出（`module.exports = { h(){} }`）的成员派发接收者（BUG-045）。
 *
 * 只在**导出表里没有同名槽**时调用（具名槽优先，既有解析口径不变）。AST 判据
 * 与普查同源（{@link cjsObjectExportMemberNames}）：只有普查登记过的成员键才允许
 * 从 `default` 槽派发——`export default { … }` 的成员不在此列（它没有 CJS 导出槽
 * 语义，按名求值不该命中）。接收者必须是 `obj` Abs（`$invoke` 的通用槽位面）。
 */
function cjsMemberReceiverOf(
  source: string,
  exports: Record<string, unknown>,
  fnName: string,
): Abs | undefined {
  const recv = exports["default"];
  if (!isAbsVal(recv) || recv.shape.k !== "obj") return undefined;
  try {
    return cjsObjectExportMemberNames(parse(source)).has(fnName) ? recv : undefined;
  } catch {
    /* 解析失败 ⇒ 不猜（与普查同源的前提不成立） */
    return undefined;
  }
}

/**
 * CJS 成员调用：接收者 = `module.exports` 对象 ⇒ 方法体内的 `this` 绑定正确
 * （对象字面量方法可能读写 `this`，按裸值 apply 会丢绑定）。
 *
 * 选型（不做骨架统一）：core 的 `callTranspiledExportApply` /
 * `callTranspiledExportFull` 是**导出槽**骨架（按 `exports[name]` 取函数后
 * 裸调用，runExportCallGuarded 框住）——无接收者 `this` 注入、无入口 Φ
 * 种子；本派发的目标是 `default` 槽对象上的**成员**（不在导出表里）⇒ 无法
 * 复用，保留独立实现。
 *
 * 异常分类口径与 core 骨架钉同（漂移门：service-bug-045 测试文件
 * 「invokeCjsMember 异常分类」）：`NudoThrow` ⇒ `result = never` +
 * `throws = 载荷`（用户 throw，**不进** noteEvalFallback 计数）；其它原生
 * 异常 ⇒ `noteEvalFallback`（不静默吞）+ fail-closed（`undefined`）。
 */
function invokeCjsMember(
  recv: Abs,
  member: string,
  args: Abs[],
  phi: Phi | undefined,
): TranspiledCallResult | undefined {
  try {
    const call = () => $invoke(recv, member, args);
    const result = phi ? withExecPhi(phi, call) : call();
    return isAbsVal(result) ? { result, throws: never } : undefined;
  } catch (e) {
    if (isNudoThrow(e)) return { result: never, throws: e.absValue };
    noteEvalFallback(e);
    return undefined;
  }
}

/**
 * 求值引擎求值具名导出（结果 + throws）；opts.collectCalls 时附带调用点记录。
 *
 * `calls` 只含**本次具名调用期间**（callTranspiledExportFull 内）发生的
 * 调用点——不含模块级顶层调用（run.calls）。模块级记录由主分析流程
 * 另行收集（analyzer 的 evalTopCallRecords / absCallRecords）；在此重复返回
 * 会把 求值引擎结果（常为 unknown）当第二组记录推给 analyzer，dedupe 因
 * 结果形态不同而保留，污染被调函数的 case 列表（多余 call@L 重复 +
 * call@symbolic 聚合 case，见 analyzer directive-case 分支）。
 */
export function tryEvalCallFull(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
  opts: {
    collectCalls?: boolean;
    collectMemberDiags?: boolean;
    envNames?: string[];
    mocks?: Record<string, Abs>;
    /** 入口 Φ 种子（assume 约束——eval 侧路径条件收窄） */
    phi?: Phi;
    /** 宿主模块加载器；透传 tryRunEval（图组装 + depKey 同口径） */
    loadModule?: LoadModule;
    /** 宿主已计算的依赖指纹（跳过重算）；null = fail-closed 禁缓存 */
    depKey?: string | null;
  } = {},
): (TranspiledCallResult & {
  calls?: EvalCallRecord[];
  memberDiags?: EvalMemberDiag[];
  moduleIssues?: import("./abs-modules-graph.ts").AbsModuleLoadIssue[];
  truncatedFns?: string[];
}) | undefined {
  // collector 作用域（幂等）：同 tryRunEval——先开作用域再装 collector。
  return runWithCollectorScope(() => {
    const run = tryRunEval(source, filePath, {
      envNames: opts.envNames,
      // mock 表按**被求值的函数作用域**选（Bug 455）：同名 `@nudo:mock`
      // 各归各函数——不分作用域则先声明的函数被后声明的同名 mock 改写成
      // 错误类型（产物面 dts / case 值都受影响）。
      mocks: opts.mocks ? mockScopeSelected(opts.mocks, fnName) : undefined,
      ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
      ...(opts.depKey !== undefined ? { depKey: opts.depKey } : {}),
      // fresh：每次调用一个独立模块实例——调用会改写模块级状态（`n++` 等），
      // 复用同一实例会让后一个用例看到前一个用例的残留（Bug 472）。
      fresh: true,
    });
    if (!run) return undefined;
    // own-property：`in` 走原型链，toString/constructor 等继承名会被当模块导出调用
    const namedSlot = Object.hasOwn(run.exports, fnName);
    // BUG-045：CJS 对象字面量导出的成员（`module.exports = { h(){} }`）既不是模块
    // 作用域绑定、也不是顶层导出槽 ⇒ 按名取落空。导出面（dts / schema / guard）与
    // `nudo check` 必须同源 ⇒ 按 core 的导出槽口径（export-slot.ts 的 cjs-member）
    // 从 `default` 槽派发成员调用；否则三方言一起退化成 unknown / z.unknown() /
    // `return true`（校验器变空操作 = 假绿）。
    const cjsReceiver = namedSlot ? undefined : cjsMemberReceiverOf(source, run.exports, fnName);
    if (!namedSlot && cjsReceiver === undefined) return undefined;
    const collected: EvalCallRecord[] = [];
    const memberDiags: EvalMemberDiag[] = [];
    // CJS 成员派发是**合成的入口调用**（源码里没有这个调用点）⇒ `$invoke` 打的
    // 那条调用点记录（无 `callLoc`）不是见证证据：滤掉。否则它会凭空合成一条
    // `call@L<成员定义行>`（`callsiteCaseName` 的 fallbackLine 兜底）——冻结与
    // `contract --emit` 会把一个不存在的调用点写进源码，且真实调用点域名被
    // 这条假记录支撑（假绿方向）。
    const skipSyntheticEntryRecord = cjsReceiver !== undefined;
    // undefined = 本次未安装（finally 不动全局）；null = 之前就是空
    const prevCall:
      | ((r: EvalCallRecord) => void)
      | null
      | undefined = opts.collectCalls
        ? setEvalCallCollector((r) => {
            if (skipSyntheticEntryRecord && r.callLoc === undefined && r.fnName === fnName) {
              return;
            }
            collected.push(r);
          })
        : undefined;
    const wantMember = opts.collectMemberDiags ?? true;
    const prevMember:
      | ((d: EvalMemberDiag) => void)
      | null
      | undefined = wantMember
        ? setMemberDiagCollector((d) => memberDiags.push(d))
        : undefined;
    try {
      // 按源码本地函数名分析（@nudo:case 见证 / symbolic 聚合）：同名
      // re-export / CJS 合并不得顶替本地私有函数 ⇒ preferLocal。
      const full =
        cjsReceiver !== undefined
          ? invokeCjsMember(cjsReceiver, fnName, args, opts.phi)
          : callTranspiledExportFull(run.exports, fnName, args, {
              preferLocal: true,
              ...(opts.phi ? { phi: opts.phi } : {}),
            });
      if (!full) return undefined;
      const all = [...(run.memberDiags ?? []), ...memberDiags];
      return {
        ...full,
        calls: opts.collectCalls ? collected : undefined,
        memberDiags: all.length ? all : undefined,
        moduleIssues: run.moduleIssues,
        truncatedFns: run.truncatedFns,
      };
    } finally {
      if (prevCall !== undefined) setEvalCallCollector(prevCall);
      if (prevMember !== undefined) setMemberDiagCollector(prevMember);
    }
  });
}

/** 求值引擎求值具名导出（仅成功结果） */
export function tryEvalCall(
  source: string,
  filePath: string,
  fnName: string,
  args: Abs[],
  opts: {
    envNames?: string[];
    mocks?: Record<string, Abs>;
    phi?: Phi;
    /** 宿主模块加载器；透传 tryRunEval（图组装 + depKey 同口径） */
    loadModule?: LoadModule;
    /** 宿主已计算的依赖指纹（跳过重算）；null = fail-closed 禁缓存 */
    depKey?: string | null;
    /**
     * Bug 91：`--abs` 观察面专用。「证明必抛」是**精确结论**
     * （`result = never` + `throws ≠ never`），不是推断失败；其它消费点
     * （export 的 dts / contract face）仍按 fail-closed 折成 undefined，
     * 由调用方回落 unknown。只有显式打开本开关才保留 never Abs。
     */
    keepNeverThrows?: boolean;
  } = {},
): Abs | undefined {
  // collector 作用域（幂等）：透传 tryEvalCallFull（已开），此处兜底独立入口。
  return runWithCollectorScope(() => {
    const full = tryEvalCallFull(source, filePath, fnName, args, opts);
    if (!full) return undefined;
    const r = full.result;
    // BUG-028：类型级 result 必填，但运行时不变量
    // 可能被破坏（producer 缺陷）——显式 isAbsVal
    // 守卫 + 回落观测（旧实现 !r 死检查：缺 result
    // 的记录静默 undefined，原因不可观测）
    if (!isAbsVal(r)) {
      // **引擎自身违约**（producer 产出了非 Abs 值）⇒ 不是用户代码抛 ⇒ 标签
      // 仍是 internal（BUG-073 的 module-throw 只归用户代码求值时的原生异常）
      // ⇒ 闸门必须红（引擎缺陷）。
      noteEvalFallback(
        new Error(
          `tryEvalCall: '${fnName}' result is not an Abs value (producer contract violation)`,
        ),
        "engine",
      );
      return undefined;
    }
    if (
      r.shape.k === "never" &&
      full.throws.shape.k !== "never" &&
      !opts.keepNeverThrows
    ) {
      return undefined;
    }
    if (r.shape.k === "unknown" && !r.term) return undefined;
    return r;
  });
}

export { callTranspiledExport, callTranspiledExportFull };
