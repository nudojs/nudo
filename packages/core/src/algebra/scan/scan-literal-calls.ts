/**
 * 字面量调用点违例扫描（scanLiteralCalls）：找 name(literalArgs) /
 * alias(lit) / obj.fn(lit) / require 导入调用点，检查实参 vs 前置约束
 * （nudo:constraint-violated 执法面）＋ HOF 实参形状与静态实参求值辅助。
 * 自 scan.ts 机械拆出；语义未改（scan.ts re-export 保持对外形状不变）。
 *
 * ── 族 11 / S0：本文件已重排为**薄壳** ─────────────────────────────────────
 *
 * 职责只剩「**遍历 + 编排**」：AST 走查、契约绑定（effectiveContract →
 * 形参位索引）、调用点分发（本地 / 跨文件 / 转发）、HOF 实参形状检查。
 * 三块**纯计算**的职责已抽到同包的内部模块（**只在 core 包内相对 import**，
 * **零新增 core 公开导出** —— `src/index.ts` / `algebra/index.ts` /
 * `algebra/exec/index.ts` / `internal.ts` 四张冻结面表一行不动）：
 *
 *   - `scan/literal-args.ts`   实参抽取：`isInformativeArg` / `evalArgAbs` /
 *                               `parseCallArgs`（快路径分派表：Bug 430 在此）
 *                               + `absUnknown` / `restArgAbs` / `arrayLengthOf`
 *                               + `defaultArgAbss`（Bug 444 的默认值实参）
 *   - `scan/literal-preds.ts`  字面量判定：`isNullishLitAbs` / `nullishKindOf` /
 *                               `predEqLiteral` / `predEqNullish` /
 *                               `judgeLiteralPred`
 *   - `scan/literal-shapes.ts` 结构执法：`checkReqs` / `checkShapeAgainstAbs` /
 *                               `checkFieldConstraint` / `checkShapeReqs`
 *
 * **共享 ctx**：`LiteralScanCtx`（`scan/literal-args.ts` 导出）——
 * `out` / `knownFns` / `opts` / `source` / `file` / `varAbs` / `resolve`。
 * 三个内部模块的函数签名与本文件的 ctx 形状写在
 * `packages/core/src/algebra/scan/*.ts` 的**文件头注释**里（族 11 共享契约）。
 */

import { parseSource as parse } from "../parse-source.ts";
import type { RefineEntry } from "../refine.ts";
import { instantiateConstraint } from "../constraint.ts";
import {
  effectiveContract,
  type EffectiveContract,
  type EffectiveContractOpts,
} from "../contract/contract.ts";
import { generalizeFromAst, type PolyFn } from "../generalize.ts";
import {
  loadModuleDepsFingerprint,
  type LoadDepsFingerprint,
} from "../key/load-deps-fp.ts";
import { checkCallSite } from "../diagnostics/diagnostics.ts";
import { locateContractParam, withOptionalParams, type FormalParam } from "../format/param-surface.ts";
import type { Abs } from "../abs.ts";
import { hashSource } from "../key/hash-source.ts";
import type { Phi, Pred } from "../pred.ts";
import { formatAbs, formatShape } from "../format/format.ts";
import type { CheckIssue } from "../check/check-report.ts";
import { getFnImpl } from "../abs-fn.ts";
import {
  collectCallResolvers,
  collectForwarders,
  localClassMemberNames,
  resolveCalleeFn,
  scopeChainChild,
  type ExternalFnRef,
  type ScopeChain,
} from "./scan-call-graph.ts";
import { DIAG } from "../diagnostics/diag-codes.ts";
import {
  absUnknown,
  defaultArgAbss,
  evalArgAbs,
  isExplicitUndefinedArg,
  isInformativeArg,
  optionalParamNames,
  parseCallArgs,
  type LiteralScanCtx,
  type ScanLiteralCallsOptions,
} from "./literal-args.ts";
import { checkReqs, checkShapeReqs } from "./literal-shapes.ts";

/** 静态实参求值辅助（历史对外形状：`scan.ts` re-export 保持不变） */
export { absUnknown };

/**
 * HOF 实参是否满足目标 fn 形状。
 * 自定义放宽比较：JS 允许多余实参（src.params.length >= tgt.params.length）。
 * 不直接喂 leqAbs(arity 严格相等对 JS 太严)。
 */
function hofFnArgOk(src: Abs, tgt: Abs): boolean {
  if (src.shape.k !== "fn") return false;
  const t = tgt.shape;
  if (t.k !== "fn") return false;
  // arity：JS 允许多余实参
  if (src.shape.params.length < t.params.length) return false;
  // 有 returnType 槽时不要求 src 也有（弱信息可接受）
  return true;
}

// ---------------------------------------------------------------------------
// 字面量调用点违例扫描（scanLiteralCalls）
// ---------------------------------------------------------------------------

/**
 * 调用点扫描的 knownFns + 模块级本地类成员名（Bug 1156）。
 *
 * 只扩**调用点扫描**：签名普查面（`listTopFunctions`）与 L2 入口表不动 ⇒
 * `nudo check` 的输出面不因本地类扩面。返回新数组（不改调用方传入的表）。
 */
function withLocalClassMembers(
  knownFns: string[],
  source: string,
  file: ReturnType<typeof parse>,
): string[] {
  const extra = localClassMemberNames(source, file);
  if (extra.length === 0) return knownFns;
  const out = knownFns.slice();
  for (const n of extra) {
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** 找 `name(literalArgs)` / `alias(lit)` / `obj.fn(lit)` / require 导入，检查约束 */
export function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
  opts?: ScanLiteralCallsOptions,
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const file = opts?.file ?? parse(source);
  // Bug 1156：模块级**本地类**的 own 方法名并入调用点扫描的 knownFns ——
  // 普通函数普查面（`listTopFunctions`）本就收未导出的本地函数（调用点义务
  // 同一路径），类成员此前只有导出类才进表 ⇒ 未导出本地类的方法在调用点
  // 静默（与本地函数规则不一致 = 假绿）。**不改**签名普查面：`nudo check`
  // 的签名列表不因本地类扩面；未契约的方法仍零诊断。
  const scanKnownFns = withLocalClassMembers(knownFns, source, file);
  const knownSet = new Set(scanKnownFns);
  const resolve = collectCallResolvers(source, scanKnownFns, opts);
  const forwards = collectForwarders(source, knownSet, resolve, file);
  const varAbs = opts?.varAbs ?? new Map<string, Abs>();
  /** fnName@line → 执行态实参表（同名同行多调用按序消费） */
  const evalCallIndex = new Map<string, Array<Abs[]>>();
  for (const r of opts?.bCalls ?? []) {
    if (!r.callLoc) continue;
    const key = `${r.fnName}\u0000${r.callLoc.line}`;
    const list = evalCallIndex.get(key) ?? [];
    list.push(r.args);
    evalCallIndex.set(key, list);
  }
  const takeBCallArgs = (fnName: string, line: number | undefined): Abs[] | undefined => {
    if (line === undefined) return undefined;
    const list = evalCallIndex.get(`${fnName}\u0000${line}`);
    if (!list || list.length === 0) return undefined;
    return list.shift();
  };

  /**
   * effectiveContract（§11 唯一读取口）调用侧收口：
   * - 同次扫描内按 (fn, fromFile, autoBind) 缓存——localNamedExports 走
   *   errorRecovery 解析不进 parse LRU，逐调用点重解析会放大开销。
   * - §3.3 执法分档：只有 handwritten 契约执法；generated 段是事实快照
   *   （drift 由后续检查报），implicit 无契约。
   */
  const eiCache = new Map<string, EffectiveContract | undefined>();
  const effectiveContractOf = (
    fnName: string,
    fnSource: string,
    eiOpts: EffectiveContractOpts,
  ): EffectiveContract | undefined => {
    // 等长不同内容不得串缓存（跨文件 checkExternalCall 场景）
    const key = `${fnName}\u0000${eiOpts.fromFile ?? ""}\u0000${eiOpts.autoBind === false ? "0" : "1"}\u0000${eiOpts.projectDir ?? "-"}\u0000${hashSource(fnSource)}`;
    if (eiCache.has(key)) return eiCache.get(key);
    const r = effectiveContract(fnSource, fnName, eiOpts);
    eiCache.set(key, r);
    return r;
  };

  /**
   * 同文件调用点共用的依赖内容指纹（**一次扫描一个**）。
   *
   * `generalizeFromAst` 的 memo 键含 `refineDepsFingerprint(source, refine)`
   * ——每次调用点都在 generalize 内部重算（一次磁盘 BFS + 全 AST 走查 +
   * 逐依赖 hash）。command.js 这类大文件有 ~100 个调用点 ⇒ 100 次全量 BFS
   * （实测 601ms → 2475ms 的 check 回退，OSS baseline gate 因此连续红）。
   * 同一次扫描里 `(source, opts.loadModule, opts.fromFile)` 恒定 ⇒ 指纹同值，
   * 只需算一次；跨文件被调方（`ext.fromFile`）不共用（loader/基准不同，
   * 由 generalize 按自己的 refine 现算）。
   *
   * 只省计算，不改键值：与 `generalizeMemoKey` 内 `refineDepsFingerprint`
   * 同一函数、同一实参（含 `fromFile === ""` 时其自身的 `"-"` 短路）。
   */
  let sameFileDepsFp: LoadDepsFingerprint | undefined | null = null;
  const depsFpOfSameFile = (): LoadDepsFingerprint | undefined => {
    if (sameFileDepsFp !== null) return sameFileDepsFp;
    const loadModule = opts?.loadModule;
    const fromFile = opts?.fromFile;
    sameFileDepsFp =
      loadModule && fromFile
        ? loadModuleDepsFingerprint(source, loadModule, fromFile)
        : undefined;
    return sameFileDepsFp;
  };

  /** effectiveContract → [paramIdx, RefineEntry, fieldPath?, rest?]（C4.1：解构契约带
   *  字段投影；#137：fieldPath 为多段路径，展示用点连接串 = fieldPath.join(".")）
   *  conflict 位跳过：契约本身不可满足时调用点不该被当成违例（§2.1 / contract.ts conflict 注释）
   *
   *  Bug 400：第 4 位 = **rest 形参**标记。`locateContractParam` 明明算出了
   *  `hit.rest`，此前在 `entries.push` 里被**丢掉** ⇒ 下游（执法侧）无从知道
   *  「这个形参吃的是该位之后的**全部**实参」⇒ rest 形参拿到的是**首个**实参
   *  ⇒ 合法调用被误判（「实参 1 ⊭ array 约束」）。 */
  const contractToIndexed = (
    ei: EffectiveContract,
    paramNames: string[],
    formals?: FormalParam[],
  ): Array<
    [number, RefineEntry, string[] | undefined, boolean | undefined, number | undefined]
  > => {
    const conflict = new Set(ei.conflict?.params ?? []);
    const entries: Array<
      [number, RefineEntry, string[] | undefined, boolean | undefined, number | undefined]
    > = [];
    for (const { param, constraint } of ei.params) {
      if (!param || conflict.has(param)) continue;
      const idx = paramNames.indexOf(param);
      if (idx >= 0) {
        // 展示名直接命中：若该位是 rest 形参（展示名带 "..." 前缀），同样标 rest
        const fp = formals?.[idx];
        entries.push([
          idx,
          { param, pred: instantiateConstraint(constraint, param), constraint },
          undefined,
          fp?.kind === "rest" ? true : undefined,
          undefined,
        ]);
        continue;
      }
      // C4.1：契约名不在求值展示名里 → formals / locateContractParam
      // （解构顶层绑定名、默认参名、rest 裸名；#137 嵌套点路径）
      if (formals && formals.length > 0) {
        const hit = locateContractParam(formals, param);
        if (hit) {
          entries.push([
            hit.index,
            { param, pred: instantiateConstraint(constraint, param), constraint },
            // Bug 8：数组解构命中带 `fieldIndex`（元素下标）⇒ **不能**把
            // `hit.field`（展示名）当对象槽路径退回；否则每个调用都投影失败
            // ⇒ `missing field x` 假红。`fieldPath` 只对对象解构 / 点路径成立。
            hit.fieldPath ??
              (hit.field !== undefined && hit.fieldIndex === undefined
                ? [hit.field]
                : undefined),
            hit.rest === true ? true : undefined,
            hit.fieldIndex,
          ]);
        }
      }
    }
    return entries;
  };

  /**
   * BUG-197：**契约级可选位**（`constraint.isOptional`）→ 形参位次表。
   *
   * `.optional()` 在产物面（`nudo export --format dts` 的 `b?: number`、schema
   * 的 `.optional()`）是「该位可省略」的**权威**来源（Bug 536 的「三来源」序：
   * 契约级 > 实现签名）⇒ 执法面的元数检查必须同源，否则同一份契约
   * 「产物说可省、check 说必填」⇒ TS 合法调用被判 `nudo:arg-count`（假红，
   * BUG-197）。位次映射与 `contractToIndexed` **同一套规则**（展示名直接命中
   * → `locateContractParam`），本地调用与跨文件调用共用本函数 ⇒ 两面同口径。
   *
   * §3.3 执法分档：只有 handwritten 契约执法（generated 段是事实快照、implicit
   * 无契约）⇒ 其它来源返回空集，与 `checkReqs` 的执法面一致。
   */
  const contractOptionalIndexes = (
    ei: EffectiveContract | undefined,
    paramNames: string[],
    formals?: FormalParam[],
  ): ReadonlySet<number> => {
    const optional = new Set<number>();
    if (ei?.source !== "handwritten") return optional;
    const conflict = new Set(ei.conflict?.params ?? []);
    for (const { param, constraint } of ei.params) {
      if (!param || conflict.has(param)) continue;
      if (constraint.isOptional !== true) continue;
      let idx = paramNames.indexOf(param);
      if (idx < 0 && formals && formals.length > 0) {
        idx = locateContractParam(formals, param)?.index ?? -1;
      }
      if (idx >= 0) optional.add(idx);
    }
    return optional;
  };

  // nudo:contract-conflict 只在 check.ts fn 级报告（权威面）：conflict 必然
  // 蕴含源文件含 @nudo:contract/@nudo:contract，fn 级门恒开且必然已报——
  // 调用点级再报一次只会双报两种消息形态（此处历史上曾重复，已收口）。

  /** 共享 ctx（族 11 S0 共享契约①）：显式传给三个内部模块 */
  const ctx: LiteralScanCtx = {
    out,
    knownFns: scanKnownFns,
    opts,
    source,
    file,
    varAbs,
    resolve,
  };

  /**
   * Bug 9：函数体内 `const` 声明的静态值（按作用域 id 分桶）。
   *
   * `varAbs` 只由**模块级**求值绑定表构造 ⇒ `const v = -1; f(v)` 的
   * `Identifier` 实参退化成 `absUnknown()` ⇒ `hasInfo === false` ⇒
   * `checkOneCall` 整条跳过（假绿），而同一形态写在字面量 / 模块级 const
   * 下都报。执行态实参回退（`bCalls`）只覆盖顶层语句 ⇒ 补不了函数体内。
   *
   * 这里在 AST 走查时把局部 const 的**静态可判**值补进实参解析的绑定表；
   * 求不出来的（复杂表达式 / 函数引用）保持无信息（fail-closed，不发明义务）。
   */
  const localBindings = new Map<string, Map<string, Abs>>();
  const scopedCtx = (chain: ScopeChain): LiteralScanCtx => {
    if (localBindings.size === 0) return ctx;
    const merged = new Map(varAbs);
    // 外层 → 内层（内层同名遮蔽外层，与词法作用域同口径）
    for (let i = chain.length - 1; i >= 0; i--) {
      const bucket = localBindings.get(chain[i]!);
      if (bucket) for (const [k, v] of bucket) merged.set(k, v);
    }
    return { ...ctx, varAbs: merged };
  };

  const checkOneCall = (
    fnName: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
    chain: ScopeChain = [""],
  ): void => {
    if (!scanKnownFns.includes(fnName)) return;

    // 传参结构：实参字面量 Abs ≤ 形参必填 slot
    checkArgStructures(fnName, source, args, loc);

    const parsed = parseCallArgs(scopedCtx(chain), args);
    // Bug 364：实参个数按**语法实参个数**判定（parseCallArgs 每个语法
    // 实参产出一项）——默认值补齐后的 absArgs 长度不是调用点实参个数。
    //
    // Bug 1105：非字面量展开（`f(...args)`）⇒ 个数**不可判** ⇒ `argCount`
    // 为 `undefined` ⇒ 元数检查整条跳过（fail-closed：不猜）。用 NaN 传下去：
    // `checkCallSite` 里 `argCount < required` / `argCount > required` 两个比较
    // 对 NaN 恒为 false ⇒ 元数检查让位，而实参义务检查照跑（不复制 arityFace
    // 的必选元数算法 ⇒ 两处口径不会漂）。
    const syntacticArgCount = parsed.argCount;
    let absArgs = parsed.absArgs;
    let hasInfo = parsed.hasInfo;
    // 值流回退：静态实参无信息（嵌套调用形参 / 复杂表达式）时按执行态实参执法。
    // 变量键查找已折 any（hasInfo），不会走到这里。
    if (!hasInfo) {
      const evalArgs = takeBCallArgs(fnName, loc?.start.line);
      if (evalArgs && evalArgs.length > 0) {
        absArgs = evalArgs;
        hasInfo = evalArgs.some(isInformativeArg);
      }
    }
    // Bug 444 / 1110 / 1111：默认值形参的实参位补齐。
    // - 1110：调用点**显式传 `undefined`** ⇒ 运行时走默认值 ⇒ 该位按默认值执法。
    // - 1111：调用点**漏传尾部位置** ⇒ 运行时走默认值 ⇒ 缺失的**所有尾部位置**
    //   都补默认值（此前只在**零实参**时补 ⇒ `e4(1)` 静默 = 假绿）。
    const defaults = defaultArgAbss(fnName, source, file, (n) => varAbs.get(n));
    if (defaults.values.length > 0) {
      const filled = absArgs.slice();
      // 显式 undefined ⇒ 默认值（Bug 1110）
      for (let i = 0; i < filled.length; i++) {
        if (!defaults.defaulted.has(i)) continue;
        if (!isExplicitUndefinedArg(args[i])) continue;
        filled[i] = defaults.values[i]!;
      }
      // 缺失的尾部位置 ⇒ 默认值（Bug 1111）
      for (let i = filled.length; i < defaults.values.length; i++) {
        filled[i] = defaults.values[i]!;
      }
      if (filled.length !== absArgs.length || filled.some((a, i) => a !== absArgs[i])) {
        absArgs = filled;
        hasInfo = absArgs.some(isInformativeArg);
      }
    }

    // Bug 364：调用点验证面（`checkArg` / `checkCall`）接进产品路径 ——
    // 此前本模块只做**契约面**执法 ⇒ 通用化参数面上的调用点验证整体静默。
    // 放在「实参无信息」早退**之前**：实参个数与实参信息量无关。
    const g = generalizeFromAst(fnName, source, {
      file,
      depsFp: depsFpOfSameFile(),
      refine: {
        loadModule: opts?.loadModule,
        fromFile: opts?.fromFile ?? "",
        ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        ...(opts?.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
      },
    });
    // Bug 1108：TS `x?: T` / JSDoc `@param {T} [x]` 的形参**可省略** ⇒
    // 必选元数要减掉这一位 ⇒ `h()`（少传实参）不再被判「expects 1
    // argument(s), got 0」（假红）。形参表来自泛化结果（memo 共享）⇒
    // **不改**原对象，只换一份带 `optional` 的副本。
    const gWithOptional = withOptionalParams(
      g?.formals,
      optionalParamNames(fnName, source, file),
    );
    const fnFace = gWithOptional && g ? { ...g, formals: gWithOptional } : g;
    // BUG-197：**契约级**可选位（`constraint.isOptional`）必须与产物面（dts /
    // schema）同源 ⇒ 元数检查之前先取有效契约。此前 arityFace 只看实现签名
    // （`x?: T` / 默认参）⇒ 契约 `.optional()` 位在 check 面被当必填 ⇒ TS 合法
    // 调用被判 `nudo:arg-count`（假红），而同一契约的 dts 产物写 `b?: number`。
    const optsR: EffectiveContractOpts = {
      loadModule: opts?.loadModule,
      fromFile: opts?.fromFile ?? "",
      ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      ...(opts?.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
    };
    const ownEi = effectiveContractOf(fnName, source, optsR);
    const contractOptional = contractOptionalIndexes(ownEi, g?.params ?? [], g?.formals);
    out.push(
      ...checkCallSite(source, fnName, absArgs, {
        // Bug 1105：个数不可判（非字面量展开）⇒ NaN ⇒ 元数检查两个比较恒假
        // ⇒ 让位；实参义务检查照跑。
        argCount: syntacticArgCount ?? Number.NaN,
        hasInfo,
        fn: fnFace,
        phi,
        // BUG-197：契约级可选位（本地调用与跨文件调用**同口径**）
        contractOptional,
        line: loc?.start.line,
        column: loc?.start.column,
      }),
    );
    if (!hasInfo || absArgs.length === 0) return;

    // Bug 1105：非字面量展开处的**已知长度到此为止** —— 展开后的槽位个数
    // 不可知 ⇒ rest / length 边界**不把展开槽位算进已知长度**（否则
    // `few(1, ...more)` 的 rest 聚合出 `[1, unknown]` ⇒ 长度 2 ⇒ 假红）。
    const contractArgs =
      parsed.spreadAt !== undefined ? absArgs.slice(0, parsed.spreadAt) : absArgs;

    const paramNames = g?.params ?? [];
    // §3.3 执法分档：仅 handwritten 执法；generated 段是事实快照（drift 另报）
    if (ownEi?.source === "handwritten") {
      const ownFull = contractToIndexed(ownEi, paramNames, g?.formals);
      // Bug 1114：结构通道先跑 ⇒ 它报过的实参位（「实参不是 object」）传给谓词
      // 通道**让位** ⇒ 同一条违例只报一次。
      const notObject = checkShapeReqs(
        ctx,
        fnName,
        ownFull,
        paramNames,
        contractArgs,
        (i) => i,
        loc,
      );
      checkReqs(
        ctx,
        fnName,
        ownFull.map(
          ([i, e, f, r, fi]) =>
            [i, e.pred, f, e.param, r, fi] as [
              number,
              Pred,
              string[] | undefined,
              string | undefined,
              boolean | undefined,
              number | undefined,
            ],
        ),
        paramNames,
        contractArgs,
        (i) => i,
        loc,
        notObject,
      );
    }

    const fwd = forwards.get(fnName);
    if (fwd) {
      const tg = generalizeFromAst(fwd.target, source, file ? { file } : {});
      const tParams = tg?.params ?? [];
      const tEi = effectiveContractOf(fwd.target, source, optsR);
      const tFull = tEi?.source === "handwritten" ? contractToIndexed(tEi, tParams, tg?.formals) : [];
      if (tFull.length > 0) {
        const wrapperArgOfTarget = new Map<number, number>();
        fwd.map.forEach((wrapperIdx, targetIdx) => {
          wrapperArgOfTarget.set(targetIdx, wrapperIdx);
        });
        const mapArg = (targetIdx: number) => wrapperArgOfTarget.get(targetIdx);
        const notObjectFwd = checkShapeReqs(
          ctx,
          `${fnName}→${fwd.target}`,
          tFull,
          tParams,
          contractArgs,
          mapArg,
          loc,
        );
        checkReqs(
          ctx,
          `${fnName}→${fwd.target}`,
          tFull.map(
            ([i, e, f, r, fi]) =>
              [i, e.pred, f, e.param, r, fi] as [
                number,
                Pred,
                string[] | undefined,
                string | undefined,
                boolean | undefined,
                number | undefined,
              ],
          ),
          tParams,
          contractArgs,
          mapArg,
          loc,
          notObjectFwd,
        );
      }
    }
  };

  const checkExternalCall = (
    ext: ExternalFnRef,
    args: Array<Record<string, unknown>>,
    displayName: string,
    loc?: { start: { line: number; column: number } },
    chain: ScopeChain = [""],
  ): void => {
    checkArgStructures(ext.fnName, ext.source, args, loc, displayName, ext.fromFile);
    const parsedExt = parseCallArgs(scopedCtx(chain), args);
    // Bug 364：实参个数按**语法实参个数**判定（同 checkOneCall）
    // Bug 1105：非字面量展开 ⇒ 个数不可判 ⇒ 元数检查跳过（NaN）。
    const syntacticArgCount = parsedExt.argCount;
    let absArgs = parsedExt.absArgs;
    let hasInfo = parsedExt.hasInfo;
    if (!hasInfo) {
      const evalArgs = takeBCallArgs(ext.fnName, loc?.start.line);
      if (evalArgs && evalArgs.length > 0) {
        absArgs = evalArgs;
        hasInfo = evalArgs.some(isInformativeArg);
      }
    }
    // Bug 444 / 1110 / 1111（同上）：默认值形参的实参位补齐。
    // 跨文件时绑定表不可得（varAbs 是**调用方**的顶层绑定）⇒ 不做标识符解析，
    // 只取标量字面量默认值（fail-closed）。
    const defaultsExt = defaultArgAbss(ext.fnName, ext.source, undefined, undefined);
    if (defaultsExt.values.length > 0) {
      const filled = absArgs.slice();
      for (let i = 0; i < filled.length; i++) {
        if (!defaultsExt.defaulted.has(i)) continue;
        if (!isExplicitUndefinedArg(args[i])) continue;
        filled[i] = defaultsExt.values[i]!;
      }
      for (let i = filled.length; i < defaultsExt.values.length; i++) {
        filled[i] = defaultsExt.values[i]!;
      }
      if (filled.length !== absArgs.length || filled.some((a, i) => a !== absArgs[i])) {
        absArgs = filled;
        hasInfo = absArgs.some(isInformativeArg);
      }
    }
    if (!hasInfo || absArgs.length === 0) return;
    let full: Array<
      [number, RefineEntry, string[] | undefined, boolean | undefined, number | undefined]
    > = [];
    let paramNames: string[] = [];
    try {
      const g = generalizeFromAst(ext.fnName, ext.source);
      paramNames = g?.params ?? [];
      // 跨文件侧车只在拿到定义文件路径时 ambient 绑定（防误绑到本文件侧车）
      const eiOpts: EffectiveContractOpts = {
        loadModule: opts?.loadModule,
        fromFile: ext.fromFile ?? opts?.fromFile ?? "",
        ...(ext.fromFile ? {} : { autoBind: false }),
        ...(ext.fromFile && opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        ...(opts?.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
      };
      const ei = effectiveContractOf(ext.fnName, ext.source, eiOpts);
      // BUG-197：契约级可选位 —— 与本地调用**共用** `contractOptionalIndexes`
      // （同一套位次映射 + 同一 handwritten 档）⇒ 本地 / 跨文件两面同结论。
      const contractOptional = contractOptionalIndexes(ei, paramNames, g?.formals);
      // Bug 364：调用点验证面接进产品路径（跨文件被调方）
      out.push(
        ...checkCallSite(ext.source, ext.fnName, absArgs, {
          argCount: syntacticArgCount ?? Number.NaN,
          hasInfo,
          fn: g,
          phi,
          contractOptional,
          displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        }),
      );
      // §3.3 执法分档：仅 handwritten 执法；generated 段不执法
      if (ei?.source === "handwritten") {
        full = contractToIndexed(ei, paramNames, g?.formals);
      }
    } catch {
      // 外部被调契约解析失败：不再静默放弃执法——报 warning 便于定位
      out.push({
        severity: "warning",
        code: DIAG.noSignature,
        message: `${displayName}: external callee contract could not be resolved; skipping call-site precondition check`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
      return;
    }
    // Bug 1105：展开处停止（rest / length 边界不把展开槽位算进已知长度）
    const contractArgsExt =
      parsedExt.spreadAt !== undefined ? absArgs.slice(0, parsedExt.spreadAt) : absArgs;
    const notObjectExt = checkShapeReqs(
      ctx,
      displayName,
      full,
      paramNames,
      contractArgsExt,
      (i) => i,
      loc,
    );
    checkReqs(
      ctx,
      displayName,
      full.map(
        ([i, e, f, r, fi]) =>
          [i, e.pred, f, e.param, r, fi] as [
            number,
            Pred,
            string[] | undefined,
            string | undefined,
            boolean | undefined,
            number | undefined,
          ],
      ),
      paramNames,
      contractArgsExt,
      (i) => i,
      loc,
      notObjectExt,
    );
  };

  /**
   * HOF：实参可调用性 / arity（fnRels）。**不做** body 字段 slot 预扫描。
   * 字面量节点静态求 Abs；标识符用文件绑定表。
   */
  /** P4：HOF 实参 fn 形状检查（§6.3 豁免规则） */
  const checkHofFnRelArgs = (
    g: PolyFn,
    args: Array<Record<string, unknown>>,
    loc: { start: { line: number; column: number } } | undefined,
    displayName: string,
    evalArg: (n: Record<string, unknown>) => Abs | undefined,
  ): void => {
    const fnRels = g.fnRels;
    if (!fnRels) return;
    for (let i = 0; i < g.params.length; i++) {
      const pname = g.params[i]!;
      const rel = fnRels.get(pname);
      if (!rel) continue;
      const expected = rel.abs;
      if (expected.shape.k !== "fn") continue;
      const argNode = args[i];
      if (!argNode) continue;
      const absArg = evalArg(argNode);
      if (!absArg) continue;
      // 豁免：any / unknown / 无信息
      if (absArg.shape.k === "any" || absArg.shape.k === "unknown") continue;
      // 豁免：有真实 body 的 impl
      if (getFnImpl(absArg)) continue;
      // 豁免：sum 且任一 member 满足
      if (absArg.shape.k === "sum") {
        const okAny = absArg.shape.members.some((m) =>
          hofFnArgOk(m, expected),
        );
        if (okAny) continue;
      }
      if (!hofFnArgOk(absArg, expected)) {
        // promote 来源 → warning；refine / relationFn → error
        const isPromote = rel.source === "promote";
        out.push({
          severity: isPromote ? "warning" : "error",
          code: DIAG.argStructure,
          message: `${displayName}[${pname}]: argument is not a callable fn`,
          actual: formatAbs(absArg),
          expected: formatShape(expected),
          suggestion: `expected ${formatShape(expected)}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }
  };

  /**
   * 调用点结构检查。
   *
   * 契约模型（close-ts-dx-gaps §0.1）：义务只来自显式 contract / HOF 关系；
   * **不做** body AST → 必填 slot 预扫描（collectParamStructReqs 已移除）。
   * 本函数仅保留 HOF 实参（回调可调用性 / arity）检查。
   */
  const checkArgStructures = (
    fnName: string,
    fnSource: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
    displayName?: string,
    /** 跨文件时 ext 定义文件路径（refine/侧车解析的文件基准）；同文件忽略 */
    contractFromFile?: string,
  ): void => {
    let gFn: ReturnType<typeof generalizeFromAst>;
    try {
      const sameFile = fnSource === source;
      // **refine 的文件基准必须与源码同源**：跨文件被调方的源码配**调用方**的
      // fromFile ⇒ 被调方的契约解析会去读**调用方**的侧车（同名契约错配、
      // 孤儿导出误报）。跨文件时用 ext 的定义文件路径。
      const refineFromFile =
        !sameFile && contractFromFile ? contractFromFile : (opts?.fromFile ?? "");
      gFn = generalizeFromAst(
        fnName,
        fnSource,
        {
          ...(sameFile && file ? { file } : {}),
          // 同文件实参的依赖指纹与本次扫描共用（一次 BFS 而非每调用点一次）；
          // 跨文件被调方的 refine 基准是定义文件 ⇒ 由 generalize 现算。
          ...(sameFile ? { depsFp: depsFpOfSameFile() } : {}),
          // refine 侧车/源码契约必须进 generalize——否则 fnRels 只剩 promote，
          // refine→error 路径永远打不开（source 永远是 warning）。
          refine: {
            loadModule: opts?.loadModule,
            fromFile: refineFromFile,
            ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
            ...(opts?.projectDir !== undefined
              ? { projectDir: opts.projectDir }
              : {}),
          },
        },
      );
    } catch (e) {
      out.push({
        severity: "warning",
        code: DIAG.noSignature,
        message: `${displayName ?? fnName}: signature recovery failed (${e instanceof Error ? e.message : String(e)}); skipping call-site checks`,
        fn: displayName ?? fnName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
      return;
    }
    // HOF 实参 arity/shape 检查（fnRels + RelSource；与 body 字段扫描无关）
    if (gFn?.fnRels && gFn.fnRels.size > 0) {
      checkHofFnRelArgs(gFn, args, loc, displayName ?? fnName, (n) =>
        evalArgAbs(n, (x) => varAbs.get(x)),
      );
    }
  };

  /**
   * 调用点走查（通用 AST 走查 ⇒ 能进表达式）。
   *
   * 作用域链（Bug 1106 / 1107）：进入**开作用域**的节点时把子作用域 id 前插
   * 到链首（与收集侧 `walkStatements` 同一套 id 算法 ⇒ 两端口径一致）。
   */
  const visit = (n: unknown, chain: ScopeChain = [""]): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & {
      type?: string;
      loc?: { start: { line: number; column: number } };
    };
    if (obj.type === "CallExpression") {
      const callee = obj.callee as Record<string, unknown>;
      const args = (obj.arguments as Array<Record<string, unknown>>) ?? [];
      const resolved = resolveCalleeFn(callee, resolve, knownSet, chain);
      if (typeof resolved === "string") {
        checkOneCall(resolved, args, obj.loc, chain);
      } else if (resolved?.external) {
        const name = resolved.external.fnName || "require()";
        checkExternalCall(resolved.external, args, name, obj.loc, chain);
      }
    }
    // Bug 9：收集**本作用域**的 const 声明值，供后续调用点的 `Identifier`
    // 实参解析（前序遍历 ⇒ 声明在使用之前已入表）。只收静态可判的字面量 /
    // 复合值；求不出 ⇒ 不入表（保持无信息，不发明义务）。
    if (obj.type === "VariableDeclaration" && obj.kind === "const") {
      const sid = chain[0] ?? "";
      let bucket = localBindings.get(sid);
      if (!bucket) {
        bucket = new Map<string, Abs>();
        localBindings.set(sid, bucket);
      }
      const probe = scopedCtx(chain);
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string } | undefined;
        const init = d.init as Record<string, unknown> | null | undefined;
        if (id?.type !== "Identifier" || !id.name || !init) continue;
        const parsed = parseCallArgs(probe, [init]);
        const abs = parsed.absArgs[0];
        if (!abs || !isInformativeArg(abs)) continue;
        // 函数 / 联合值不当「确定实参值」登记（避免把引用当值 ⇒ 假红）
        if (abs.shape.k === "fn" || abs.shape.k === "sum") continue;
        bucket.set(id.name, abs);
      }
    }
    const childChain = scopeChainChild(chain, obj);
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach((x) => visit(x, childChain));
      else if (val && typeof val === "object") visit(val, childChain);
    }
  };
  visit(file);
  return out;
}
