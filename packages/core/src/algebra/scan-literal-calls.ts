/**
 * 字面量调用点违例扫描（scanLiteralCalls）：找 name(literalArgs) /
 * alias(lit) / obj.fn(lit) / require 导入调用点，检查实参 vs 前置约束
 * （nudo:constraint-violated 执法面）＋ HOF 实参形状与静态实参求值辅助。
 * 自 scan.ts 机械拆出；语义未改（scan.ts re-export 保持对外形状不变）。
 *
 * ── 族 11 / S0：本文件已重排为**薄壳** ─────────────────────────────────────
 *
 * 职责只剩「**遍历 + 编排**」：AST 走查、契约绑定（effectiveInterface →
 * 形参位索引）、调用点分发（本地 / 跨文件 / 转发）、HOF 实参形状检查。
 * 三块**纯计算**的职责已抽到同包的内部模块（**只在 core 包内相对 import**，
 * **零新增 core 公开导出** —— `src/index.ts` / `algebra/index.ts` /
 * `algebra/exec/index.ts` / `internal.ts` 四张冻结面表一行不动）：
 *
 *   - `scan/literal-args.ts`   实参抽取：`isInformativeArg` / `evalArgAbs` /
 *                               `parseCallArgs`（快路径分派表：Bug 430 在此）
 *                               + `absUnknown` / `restArgAbs` / `arrayLengthOf`
 *                               + `defaultArgAbss`（Bug 444 的默认值实参）
 *   - `scan/literal-preds.ts`  字面量判定：`isExactUndef` / `nullishKindOf` /
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

import { parseSource as parse } from "./parse-source.ts";
import type { RefineEntry } from "./refine.ts";
import { instantiateConstraint } from "./constraint.ts";
import {
  effectiveInterface,
  type EffectiveInterface,
  type EffectiveInterfaceOpts,
} from "./interface.ts";
import { generalizeFromAst, type PolyFn } from "./generalize.ts";
import { checkCallSite } from "./diagnostics.ts";
import { locateContractParam, type FormalParam } from "./param-surface.ts";
import type { Abs } from "./abs.ts";
import { hashSource } from "./hash-source.ts";
import type { Phi, Pred } from "./pred.ts";
import { formatAbs, formatShape } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";
import { getFnImpl } from "./abs-fn.ts";
import {
  collectCallResolvers,
  collectForwarders,
  resolveCalleeFn,
  type ExternalFnRef,
} from "./scan-call-graph.ts";
import { DIAG } from "./diag-codes.ts";
import {
  absUnknown,
  defaultArgAbss,
  evalArgAbs,
  isInformativeArg,
  parseCallArgs,
  type LiteralScanCtx,
} from "./scan/literal-args.ts";
import { checkReqs, checkShapeReqs } from "./scan/literal-shapes.ts";

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

/** 找 `name(literalArgs)` / `alias(lit)` / `obj.fn(lit)` / require 导入，检查约束 */
export function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
  opts?: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
    /** 顶层绑定表（与结构赋值共享一次执行态求值结果） */
    varAbs?: Map<string, Abs>;
    /**
     * 求值引擎执行态调用记录（值流回退）：静态实参无信息时按 fnName@line 取
     * 执行态实参。变量键查找已折 any（hasInfo），不会误触发本回退。
     */
    bCalls?: Array<{
      fnName: string;
      args: Abs[];
      callLoc?: { line: number; column: number };
    }>;
    /** 侧车 ambient 绑定开关（checkSource 的 package.json 配置下传） */
    autoBind?: boolean;
    /** 项目根：树外侧车不 ambient 绑定 */
    projectDir?: string;
  },
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const file = opts?.file ?? parse(source);
  const knownSet = new Set(knownFns);
  const resolve = collectCallResolvers(source, knownFns, opts);
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
   * effectiveInterface（§11 唯一读取口）调用侧收口：
   * - 同次扫描内按 (fn, fromFile, autoBind) 缓存——localNamedExports 走
   *   errorRecovery 解析不进 parse LRU，逐调用点重解析会放大开销。
   * - §3.3 执法分档：只有 handwritten 契约执法；generated 段是事实快照
   *   （drift 由后续检查报），implicit 无契约。
   */
  const eiCache = new Map<string, EffectiveInterface | undefined>();
  const effectiveInterfaceOf = (
    fnName: string,
    fnSource: string,
    eiOpts: EffectiveInterfaceOpts,
  ): EffectiveInterface | undefined => {
    // 等长不同内容不得串缓存（跨文件 checkExternalCall 场景）
    const key = `${fnName}\u0000${eiOpts.fromFile ?? ""}\u0000${eiOpts.autoBind === false ? "0" : "1"}\u0000${eiOpts.projectDir ?? "-"}\u0000${hashSource(fnSource)}`;
    if (eiCache.has(key)) return eiCache.get(key);
    const r = effectiveInterface(fnSource, fnName, eiOpts);
    eiCache.set(key, r);
    return r;
  };

  /** effectiveInterface → [paramIdx, RefineEntry, fieldPath?, rest?]（C4.1：解构契约带
   *  字段投影；#137：fieldPath 为多段路径，展示用点连接串 = fieldPath.join(".")）
   *  conflict 位跳过：契约本身不可满足时调用点不该被当成违例（§2.1 / interface.ts conflict 注释）
   *
   *  Bug 400：第 4 位 = **rest 形参**标记。`locateContractParam` 明明算出了
   *  `hit.rest`，此前在 `entries.push` 里被**丢掉** ⇒ 下游（执法侧）无从知道
   *  「这个形参吃的是该位之后的**全部**实参」⇒ rest 形参拿到的是**首个**实参
   *  ⇒ 合法调用被误判（「实参 1 ⊭ array 约束」）。 */
  const interfaceToIndexed = (
    ei: EffectiveInterface,
    paramNames: string[],
    formals?: FormalParam[],
  ): Array<[number, RefineEntry, string[] | undefined, boolean | undefined]> => {
    const conflict = new Set(ei.conflict?.params ?? []);
    const entries: Array<
      [number, RefineEntry, string[] | undefined, boolean | undefined]
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
            hit.fieldPath ?? (hit.field !== undefined ? [hit.field] : undefined),
            hit.rest === true ? true : undefined,
          ]);
        }
      }
    }
    return entries;
  };

  // nudo:interface-conflict 只在 check.ts fn 级报告（权威面）：conflict 必然
  // 蕴含源文件含 @nudo:contract/@nudo:contract，fn 级门恒开且必然已报——
  // 调用点级再报一次只会双报两种消息形态（此处历史上曾重复，已收口）。

  /** 共享 ctx（族 11 S0 共享契约①）：显式传给三个内部模块 */
  const ctx: LiteralScanCtx = {
    out,
    knownFns,
    opts,
    source,
    file,
    varAbs,
    resolve,
  };

  const checkOneCall = (
    fnName: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!knownFns.includes(fnName)) return;

    // 传参结构：实参字面量 Abs ≤ 形参必填 slot
    checkArgStructures(fnName, source, args, loc);

    const parsed = parseCallArgs(ctx, args);
    // Bug 364：实参个数按**语法实参个数**判定（parseCallArgs 每个语法
    // 实参产出一项）——默认值补齐后的 absArgs 长度不是调用点实参个数。
    const syntacticArgCount = parsed.absArgs.length;
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
    // Bug 444：零实参调用 → 用被调函数的**默认值形参**补齐实参位再执法。
    // 此前 `absArgs.length === 0` 整条跳过 ⇒ 形参默认值本身违反自身契约时
    // 「引擎自己算出了 -5 却不对账」（假绿）。默认值取不到 ⇒ 保持原早退。
    if (absArgs.length === 0) {
      const defaults = defaultArgAbss(fnName, source, file, (n) => varAbs.get(n));
      if (defaults.length > 0) {
        absArgs = defaults;
        hasInfo = defaults.some(isInformativeArg);
      }
    }

    // Bug 364：调用点验证面（`checkArg` / `checkCall`）接进产品路径 ——
    // 此前本模块只做**契约面**执法 ⇒ 通用化参数面上的调用点验证整体静默。
    // 放在「实参无信息」早退**之前**：实参个数与实参信息量无关。
    const g = generalizeFromAst(fnName, source, {
      file,
      refine: {
        loadModule: opts?.loadModule,
        fromFile: opts?.fromFile ?? "",
        ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        ...(opts?.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
      },
    });
    out.push(
      ...checkCallSite(source, fnName, absArgs, {
        argCount: syntacticArgCount,
        hasInfo,
        fn: g,
        phi,
        line: loc?.start.line,
        column: loc?.start.column,
      }),
    );
    if (!hasInfo || absArgs.length === 0) return;

    const paramNames = g?.params ?? [];
    const optsR: EffectiveInterfaceOpts = {
      loadModule: opts?.loadModule,
      fromFile: opts?.fromFile ?? "",
      ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      ...(opts?.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
    };
    const ownEi = effectiveInterfaceOf(fnName, source, optsR);
    // §3.3 执法分档：仅 handwritten 执法；generated 段是事实快照（drift 另报）
    if (ownEi?.source === "handwritten") {
      const ownFull = interfaceToIndexed(ownEi, paramNames, g?.formals);
      checkShapeReqs(ctx, fnName, ownFull, paramNames, absArgs, (i) => i, loc);
      checkReqs(
        ctx,
        fnName,
        ownFull.map(
          ([i, e, f, r]) =>
            [i, e.pred, f, e.param, r] as [
              number,
              Pred,
              string[] | undefined,
              string | undefined,
              boolean | undefined,
            ],
        ),
        paramNames,
        absArgs,
        (i) => i,
        loc,
      );
    }

    const fwd = forwards.get(fnName);
    if (fwd) {
      const tg = generalizeFromAst(fwd.target, source, file ? { file } : {});
      const tParams = tg?.params ?? [];
      const tEi = effectiveInterfaceOf(fwd.target, source, optsR);
      const tFull = tEi?.source === "handwritten" ? interfaceToIndexed(tEi, tParams, tg?.formals) : [];
      if (tFull.length > 0) {
        const wrapperArgOfTarget = new Map<number, number>();
        fwd.map.forEach((wrapperIdx, targetIdx) => {
          wrapperArgOfTarget.set(targetIdx, wrapperIdx);
        });
        const mapArg = (targetIdx: number) => wrapperArgOfTarget.get(targetIdx);
        checkShapeReqs(ctx, `${fnName}→${fwd.target}`, tFull, tParams, absArgs, mapArg, loc);
        checkReqs(
          ctx,
          `${fnName}→${fwd.target}`,
          tFull.map(
            ([i, e, f, r]) =>
              [i, e.pred, f, e.param, r] as [
                number,
                Pred,
                string[] | undefined,
                string | undefined,
                boolean | undefined,
              ],
          ),
          tParams,
          absArgs,
          mapArg,
          loc,
        );
      }
    }
  };

  const checkExternalCall = (
    ext: ExternalFnRef,
    args: Array<Record<string, unknown>>,
    displayName: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    checkArgStructures(ext.fnName, ext.source, args, loc, displayName, ext.fromFile);
    const parsedExt = parseCallArgs(ctx, args);
    // Bug 364：实参个数按**语法实参个数**判定（同 checkOneCall）
    const syntacticArgCount = parsedExt.absArgs.length;
    let absArgs = parsedExt.absArgs;
    let hasInfo = parsedExt.hasInfo;
    if (!hasInfo) {
      const evalArgs = takeBCallArgs(ext.fnName, loc?.start.line);
      if (evalArgs && evalArgs.length > 0) {
        absArgs = evalArgs;
        hasInfo = evalArgs.some(isInformativeArg);
      }
    }
    // Bug 444（同上）：跨文件零实参调用 → 用被调方（ext.source）的默认值补齐。
    // 跨文件时绑定表不可得（varAbs 是**调用方**的顶层绑定）⇒ 不做标识符解析，
    // 只取标量字面量默认值（fail-closed）。
    if (absArgs.length === 0) {
      const defaults = defaultArgAbss(ext.fnName, ext.source, undefined, undefined);
      if (defaults.length > 0) {
        absArgs = defaults;
        hasInfo = defaults.some(isInformativeArg);
      }
    }
    if (!hasInfo || absArgs.length === 0) return;
    let full: Array<[number, RefineEntry, string[] | undefined, boolean | undefined]> = [];
    let paramNames: string[] = [];
    try {
      const g = generalizeFromAst(ext.fnName, ext.source);
      // Bug 364：调用点验证面接进产品路径（跨文件被调方）
      out.push(
        ...checkCallSite(ext.source, ext.fnName, absArgs, {
          argCount: syntacticArgCount,
          hasInfo,
          fn: g,
          phi,
          displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        }),
      );
      paramNames = g?.params ?? [];
      // 跨文件侧车只在拿到定义文件路径时 ambient 绑定（防误绑到本文件侧车）
      const eiOpts: EffectiveInterfaceOpts = {
        loadModule: opts?.loadModule,
        fromFile: ext.fromFile ?? opts?.fromFile ?? "",
        ...(ext.fromFile ? {} : { autoBind: false }),
        ...(ext.fromFile && opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        ...(opts?.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
      };
      const ei = effectiveInterfaceOf(ext.fnName, ext.source, eiOpts);
      // §3.3 执法分档：仅 handwritten 执法；generated 段不执法
      if (ei?.source === "handwritten") {
        full = interfaceToIndexed(ei, paramNames, g?.formals);
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
    checkShapeReqs(ctx, displayName, full, paramNames, absArgs, (i) => i, loc);
    checkReqs(
      ctx,
      displayName,
      full.map(
        ([i, e, f, r]) =>
          [i, e.pred, f, e.param, r] as [
            number,
            Pred,
            string[] | undefined,
            string | undefined,
            boolean | undefined,
          ],
      ),
      paramNames,
      absArgs,
      (i) => i,
      loc,
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
   * 契约模型（close-ts-dx-gaps §0.1）：义务只来自显式 interface / HOF 关系；
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
    interfaceFromFile?: string,
  ): void => {
    let gFn: ReturnType<typeof generalizeFromAst>;
    try {
      const sameFile = fnSource === source;
      // **refine 的文件基准必须与源码同源**：跨文件被调方的源码配**调用方**的
      // fromFile ⇒ 被调方的契约解析会去读**调用方**的侧车（同名契约错配、
      // 孤儿导出误报）。跨文件时用 ext 的定义文件路径。
      const refineFromFile =
        !sameFile && interfaceFromFile ? interfaceFromFile : (opts?.fromFile ?? "");
      gFn = generalizeFromAst(
        fnName,
        fnSource,
        {
          ...(sameFile && file ? { file } : {}),
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

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & {
      type?: string;
      loc?: { start: { line: number; column: number } };
    };
    if (obj.type === "CallExpression") {
      const callee = obj.callee as Record<string, unknown>;
      const args = (obj.arguments as Array<Record<string, unknown>>) ?? [];
      const resolved = resolveCalleeFn(callee, resolve, knownSet);
      if (typeof resolved === "string") {
        checkOneCall(resolved, args, obj.loc);
      } else if (resolved?.external) {
        const name = resolved.external.fnName || "require()";
        checkExternalCall(resolved.external, args, name, obj.loc);
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return out;
}
