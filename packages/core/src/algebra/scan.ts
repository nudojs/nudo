/**
 * 源码级调用图侦察：从 check 门禁拆出的 AST 扫描层。
 *
 * 职责：不做代数求值结论，只回答「谁在调用谁、实参长什么样」——
 * - listTopFunctions：顶层函数清单（scan-top-functions.ts，此处 re-export）
 * - collectCallResolvers / resolveCalleeFn / collectForwarders：
 *   scan-call-graph.ts（别名 / 对象属性 / require / 动态 import / 无条件转发）
 * - scanLiteralCalls：字面量调用点实参 vs 前置约束的违例收集
 */

import { parseSource as parse } from "./parse-source.ts";
import type { Node } from "@babel/types";
import { freeIdentifiers } from "./exec/body-fn.ts";
import { evalExprAbs } from "./exec/run.ts";
import type { RefineEntry } from "./refine.ts";
import {
  instantiateConstraint,
  isIntFlag,
  type NudoConstraint,
  type NudoField,
} from "./constraint.ts";
import {
  effectiveInterface,
  formatConstraint,
  type EffectiveInterface,
  type EffectiveInterfaceOpts,
} from "./interface.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { generalizeFromAst, type PolyFn } from "./generalize.ts";
import { locateContractParam, type FormalParam } from "./param-surface.ts";
import { numLit, litValue, anyAbs } from "./abs.ts";
import type { Abs } from "./abs.ts";
import { hashSource } from "./hash-source.ts";
import type { Phi, Pred } from "./pred.ts";
import { predToString } from "./pred.ts";
import { formatAbs, formatShape } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";
import { getFnImpl } from "./abs-fn.ts";
import { getSlot } from "./objects.ts";

// ---------------------------------------------------------------------------
// 顶层函数清单 → scan-top-functions.ts（对外形状经 re-export 保持不变）
// ---------------------------------------------------------------------------

export { listTopFunctions } from "./scan-top-functions.ts";
import {
  collectCallResolvers,
  collectForwarders,
  resolveCalleeFn,
  type ExternalFnRef,
} from "./scan-call-graph.ts";

/**
 * HOF 实参是否满足目标 fn 形状。
 * 自定义放宽比较：JS 允许多余实参（src.params.length >= tgt.params.length）。
 * 不直接喂 leqAbs（arity 严格相等对 JS 太严）。
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
// 静态实参求值辅助（absUnknown / evalArgAbs）
// ---------------------------------------------------------------------------

export function absUnknown(): Abs {
  return { shape: { k: "unknown" }, conf: "partial" };
}

/** 确定 undefined / null 字面量（term lit；区别于「无 lit」的 unknown） */
function isExactUndef(a: Abs): boolean {
  return (
    a.term?.op === "lit" &&
    ((a.term.value as unknown) === undefined || (a.term.value as unknown) === null)
  );
}

/** 实参是否携带可执法信息（含确定 undefined；纯 unknown 不算） */
function isInformativeArg(a: Abs | undefined | null): boolean {
  // B 执行态 args 可能有空洞（稀疏调用/可选实参）——fail-closed 当无信息
  if (!a || typeof a !== "object") return false;
  if (a.term?.op === "lit") return true;
  return a.shape?.k !== "unknown" && a.shape !== undefined;
}

/** 静态求值实参节点 → Abs（标识符走绑定表；对象/数组字面量内的标识符也走绑定表） */
function evalArgAbs(
  node: Record<string, unknown>,
  lookupVar?: (name: string) => Abs | undefined,
): Abs | undefined {
  if (node.type === "Identifier" && typeof node.name === "string" && lookupVar) {
    return lookupVar(node.name);
  }
  try {
    // B 表达式编译执行（fail-closed）；自由标识符
    // 按绑定表注入（`{...base}` / `[x]` 等复合实参的标识符解析）
    const free = freeIdentifiers(node as unknown as Node, []);
    const bindings: Record<string, Abs> = {};
    if (lookupVar) {
      for (const name of free) {
        const v = lookupVar(name);
        if (v) bindings[name] = v;
      }
    }
    return evalExprAbs(node as unknown as import("@babel/types").Expression, bindings);
  } catch {
    return undefined;
  }
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
     * B 路径执行态调用记录（值流回退）：静态实参无信息时按 fnName@line 取
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
  const bCallIndex = new Map<string, Array<Abs[]>>();
  for (const r of opts?.bCalls ?? []) {
    if (!r.callLoc) continue;
    const key = `${r.fnName}\u0000${r.callLoc.line}`;
    const list = bCallIndex.get(key) ?? [];
    list.push(r.args);
    bCallIndex.set(key, list);
  }
  const takeBCallArgs = (fnName: string, line: number | undefined): Abs[] | undefined => {
    if (line === undefined) return undefined;
    const list = bCallIndex.get(`${fnName}\u0000${line}`);
    if (!list || list.length === 0) return undefined;
    return list.shift();
  };

  const flattenPred = (p: Pred): Pred[] =>
    p.op === "and" ? p.args.flatMap(flattenPred) : p.op === "true" ? [] : [p];

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

  /** 解构/默认参契约名 → 实参字段投影（C4.1） */
  const projectArgField = (arg: Abs, field: string): Abs | undefined => {
    if (!arg) return undefined;
    if (arg.shape.k === "brand") {
      return projectArgField(arg.shape.shape as Abs, field);
    }
    if (arg.shape.k !== "obj") return undefined;
    return getSlot(arg.shape.slots, field)?.value;
  };

  /** effectiveInterface → [paramIdx, RefineEntry, field?]（C4.1：解构契约带 field 投影）
   *  conflict 位跳过：契约本身不可满足时调用点不该被当成违例（§2.1 / interface.ts conflict 注释） */
  const interfaceToIndexed = (
    ei: EffectiveInterface,
    paramNames: string[],
    formals?: FormalParam[],
  ): Array<[number, RefineEntry, string | undefined]> => {
    const conflict = new Set(ei.conflict?.params ?? []);
    const entries: Array<[number, RefineEntry, string | undefined]> = [];
    for (const { param, constraint } of ei.params) {
      if (!param || conflict.has(param)) continue;
      const idx = paramNames.indexOf(param);
      if (idx >= 0) {
        entries.push([
          idx,
          { param, pred: instantiateConstraint(constraint, param), constraint },
          undefined,
        ]);
        continue;
      }
      // C4.1：契约名不在求值展示名里 → formals / locateContractParam
      // （解构顶层绑定名、默认参名、rest 裸名）
      if (formals && formals.length > 0) {
        const hit = locateContractParam(formals, param);
        if (hit) {
          entries.push([
            hit.index,
            { param, pred: instantiateConstraint(constraint, param), constraint },
            hit.field,
          ]);
        }
      }
    }
    return entries;
  };

  // nudo:interface-conflict 只在 check.ts fn 级报告（权威面）：conflict 必然
  // 蕴含源文件含 @nudo:contract/@nudo:contract，fn 级门恒开且必然已报——
  // 调用点级再报一次只会双报两种消息形态（此处历史上曾重复，已收口）。

  /** eq(var, lit) / eq(lit, var) 的标量字面量端；非该形态 → undefined */
  const predEqLiteral = (p: Pred): number | string | boolean | undefined => {
    if (p.op !== "eq") return undefined;
    const v =
      p.a.op === "var" && p.b.op === "lit"
        ? p.b.value
        : p.b.op === "var" && p.a.op === "lit"
          ? p.a.value
          : undefined;
    return typeof v === "number" || typeof v === "string" || typeof v === "boolean"
      ? v
      : undefined;
  };

  /**
   * 字面量可判定的原子谓词 → true/false；不可判定（非字面量端 / 非
   * number 值上的数值界）→ undefined。or 分支聚合用：任一 true 即过，
   * 全可判定且全 false 才报，含 undefined 不猜。
   */
  const judgeLiteralPred = (
    p: Pred,
    lv: number | string | boolean,
    strLen: number | undefined,
  ): boolean | undefined => {
    if (p.op === "eq") {
      const v = predEqLiteral(p);
      return v === undefined ? undefined : lv === v;
    }
    if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") {
      return undefined;
    }
    if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
    const n = p.b.value;
    if (p.a.op === "app" && p.a.fn === "length") {
      if (strLen === undefined) return undefined;
      if (p.op === "gt") return strLen > n;
      if (p.op === "ge") return strLen >= n;
      if (p.op === "lt") return strLen < n;
      return strLen <= n;
    }
    if (typeof lv !== "number") return undefined;
    if (p.op === "gt") return lv > n;
    if (p.op === "ge") return lv >= n;
    if (p.op === "lt") return lv < n;
    return lv <= n;
  };

  const checkReqs = (
    displayName: string,
    reqs: Array<[number, import("./pred.ts").Pred, string | undefined, string | undefined]>,
    paramNames: string[],
    absArgs: Abs[],
    /** target 参下标 → 实参下标；缺省恒等 */
    argIndexOf: (reqIdx: number) => number | undefined,
    loc?: { start: { line: number; column: number } },
  ): void => {
    for (const [idx, pred, field, contractParam] of reqs) {
      const argIdx = argIndexOf(idx);
      if (argIdx === undefined) continue;
      let arg = absArgs[argIdx];
      if (!arg) continue;
      // C4.1：解构契约展示名优先用契约面（x），不回落到求值占位 _p0
      const paramName = contractParam || paramNames[idx] || `arg${idx}`;
      // C4.1：解构契约字段投影后再判 pred；缺字段不能静默跳过（FN）
      if (field) {
        const projected = projectArgField(arg, field);
        if (!projected) {
          const k = arg.shape.k;
          // unknown/any 无法证明缺字段；其余已知形态（含 obj 缺槽）→ 违例
          if (k !== "unknown" && k !== "any") {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: `missing field ${field}`,
              suggestion: `add the missing field ${field}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        arg = projected;
      }
      const lv = litValue(arg);
      const isStr = arg.shape.k === "prim" && (arg.shape as { type: string }).type === "string";
      const strLen = typeof lv === "string" ? lv.length : undefined;
      // 确定 undefined：不进 positive/nonEmpty 等 typed 域（any 仍放行）
      const argIsUndef = isExactUndef(arg);
      for (const p of flattenPred(pred)) {
        // typeof 约束（string() / number() / boolean() 裸 prim）
        // 只检查挂在参数自身上的 typeof；字段访问（u.name）交给 shape 路径
        if (p.op === "typeof") {
          if (p.t.op !== "var") continue;
          const expected = p.type;
          const actualPrim =
            arg.shape.k === "prim"
              ? (arg.shape as { type: string }).type
              : arg.shape.k === "obj" || arg.shape.k === "arr" || arg.shape.k === "tuple"
                ? "object"
                : arg.shape.k === "fn"
                  ? "function"
                  : argIsUndef
                    ? "undefined"
                    : undefined;
          // 只在有确定 prim 信息且不匹配时拦截；unknown/any 不猜
          if (actualPrim !== undefined && actualPrim !== expected) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: `typeof ${paramName} = "${expected}"`,
              suggestion: `use a value of type ${expected}, or relax the refine on ${paramName}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        // 确定 undefined 对数值界 / eq / or 同样不满足（undefined ⊭ positive）
        if (argIsUndef) {
          if (
            p.op === "gt" ||
            p.op === "ge" ||
            p.op === "lt" ||
            p.op === "le" ||
            p.op === "eq" ||
            p.op === "or"
          ) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        if (lv === undefined) continue;
        // eq / or 域（lit()/union() 契约实例化出的 eq/or 原子）：此前两个
        // 消费分支都只认 typeof/gt/ge/lt/le，字面量/析取契约违例被静默
        // 跳过——写了等于没写。可判定才报（宁缺勿滥）。
        if (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") {
          if (p.op === "eq") {
            const v = predEqLiteral(p);
            if (v !== undefined && lv !== v) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: argument ⊭ precondition`,
                actual: formatAbs(arg),
                expected: predToString(p),
                suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          if (p.op === "or") {
            let pass = false;
            let unknown = false;
            for (const q of p.args) {
              const r = judgeLiteralPred(q, lv, strLen);
              if (r === true) {
                pass = true;
                break;
              }
              if (r === undefined) unknown = true;
            }
            if (!pass && !unknown) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: argument ⊭ precondition`,
                actual: formatAbs(arg),
                expected: predToString(p),
                suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
        }
        if (
          (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
          p.b.op === "lit" &&
          typeof p.b.value === "number"
        ) {
          const n = p.b.value;
          const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[p.op];
          // length(t) 形式（string().min/max）
          if (p.a.op === "app" && p.a.fn === "length" && strLen !== undefined) {
            let ok = true;
            if (p.op === "gt") ok = strLen > n;
            if (p.op === "ge") ok = strLen >= n;
            if (p.op === "lt") ok = strLen < n;
            if (p.op === "le") ok = strLen <= n;
            if (!ok) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: argument ⊭ precondition`,
                actual: formatAbs(arg),
                expected: `length(${paramName}) ${opSym} ${n}`,
                suggestion: `use a value whose length is ${opSym} ${n}, or relax the precondition on ${paramName}`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          // boolean/null 不进数值域（includes/every/some 返回 boolean 误当收窄）
          if (typeof lv === "boolean" || lv === null) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
            continue;
          }
          // 普通数值界
          if (isStr || typeof lv !== "number") continue;
          let ok = true;
          if (p.op === "gt") ok = (lv as number) > n;
          if (p.op === "ge") ok = (lv as number) >= n;
          if (p.op === "lt") ok = (lv as number) < n;
          if (p.op === "le") ok = (lv as number) <= n;
          if (!ok) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `use a value satisfying ${predToString(p)}, or relax the precondition on ${paramName}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
        }
      }
    }
  };

  /**
   * shape 约束：实参 object Abs 的每个字段 ⊭ 嵌套约束。
   * 缺字段 / 类型不符 / 数值界违例 → nudo:constraint-violated。
   */
  const checkShapeAgainstAbs = (
    displayName: string,
    paramName: string,
    constraint: NudoConstraint,
    absArg: Abs,
    path: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!constraint.fields) return;
    // unknown 实参：无信息，不猜
    if (absArg.shape.k === "unknown" && !absArg.term) return;

    const slots =
      absArg.shape.k === "obj"
        ? (absArg.shape as { slots: Record<string, { value: Abs; optional?: boolean }> }).slots
        : undefined;

    if (!slots) {
      // 有形状信息但不是 object
      if (absArg.shape.k !== "unknown" && absArg.shape.k !== "never") {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: argument ⊭ precondition`,
          actual: formatAbs(absArg),
          expected: `object shape at ${path}`,
          suggestion: `use an object satisfying the ${path} shape constraint`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
      return;
    }

    for (const [key, field] of Object.entries(constraint.fields) as Array<
      [string, NudoField]
    >) {
      const slot = getSlot(slots, key);
      const fieldPath = path === paramName ? `${paramName}.${key}` : `${path}.${key}`;
      if (!slot) {
        if (!field.optional && !field.constraint.isOptional) {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(absArg),
            expected: `missing field ${fieldPath}`,
            suggestion: `add the missing field ${fieldPath}`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
        continue;
      }
      checkFieldConstraint(displayName, paramName, field.constraint, slot.value, fieldPath, loc);
    }
  };

  /** 单字段：prim 类型 + 数值界 + 嵌套 shape + array 元素 + int + 长度 */
  const checkFieldConstraint = (
    displayName: string,
    paramName: string,
    constraint: NudoConstraint,
    fieldAbs: Abs,
    fieldPath: string,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (fieldAbs.shape.k === "unknown" && !fieldAbs.term) return;

    // prim 类型
    if (constraint.prim && fieldAbs.shape.k === "prim") {
      const actualPrim = (fieldAbs.shape as { type: string }).type;
      if (actualPrim !== constraint.prim) {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: argument ⊭ precondition`,
          actual: formatAbs(fieldAbs),
          expected: `typeof ${fieldPath} = "${constraint.prim}"`,
          suggestion: `change ${fieldPath} to ${constraint.prim}`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
        return;
      }
    }

    // int：字面量必须是整数（builder 上 .int 是方法，标志须经 isIntFlag 读）
    if (isIntFlag(constraint)) {
      const iv = litValue(fieldAbs);
      if (typeof iv === "number" && !Number.isInteger(iv)) {
        out.push({
          severity: "error",
          code: "nudo:constraint-violated",
          message: `${displayName}[${paramName}]: argument ⊭ precondition`,
          actual: formatAbs(fieldAbs),
          expected: `${fieldPath} is int`,
          suggestion: `change ${fieldPath} to an integer`,
          fn: displayName,
          line: loc?.start.line,
          column: loc?.start.column,
        });
      }
    }

    // 嵌套 shape
    if (constraint.fields) {
      checkShapeAgainstAbs(displayName, paramName, constraint, fieldAbs, fieldPath, loc);
    }

    // array 元素：逐元素检查
    if (constraint.element) {
      if (fieldAbs.shape.k === "arr") {
        checkFieldConstraint(
          displayName,
          paramName,
          constraint.element,
          (fieldAbs.shape as { element: Abs }).element,
          `${fieldPath}[]`,
          loc,
        );
      } else if (fieldAbs.shape.k === "tuple") {
        const els = (fieldAbs.shape as { elements: Abs[] }).elements;
        els.forEach((el, i) => {
          checkFieldConstraint(
            displayName,
            paramName,
            constraint.element!,
            el,
            `${fieldPath}[${i}]`,
            loc,
          );
        });
      }
    }

    // 数值界 + 长度界（preds 里可能含 length(t) 比较）
    const lv = litValue(fieldAbs);
    const sv = typeof lv === "string" ? lv.length : undefined;
    const isStr = fieldAbs.shape.k === "prim" && (fieldAbs.shape as { type: string }).type === "string";
    for (const p of constraint.preds) {
      const flat = p.op === "and" ? p.args : [p];
      for (const atom of flat) {
        if (
          (atom.op === "gt" || atom.op === "ge" || atom.op === "lt" || atom.op === "le") &&
          atom.b.op === "lit" &&
          typeof atom.b.value === "number"
        ) {
          const n = atom.b.value;
          const opSym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[atom.op];
          // length(t) 形式
          if (atom.a.op === "app" && atom.a.fn === "length") {
            if (sv === undefined) continue;
            let ok = true;
            if (atom.op === "gt") ok = sv > n;
            if (atom.op === "ge") ok = sv >= n;
            if (atom.op === "lt") ok = sv < n;
            if (atom.op === "le") ok = sv <= n;
            if (!ok) {
              out.push({
                severity: "error",
                code: "nudo:constraint-violated",
                message: `${displayName}[${paramName}]: argument ⊭ precondition`,
                actual: formatAbs(fieldAbs),
                expected: `length(${fieldPath}) ${opSym} ${n}`,
                suggestion: `use a ${fieldPath} whose length is ${opSym} ${n}`,
                fn: displayName,
                line: loc?.start.line,
                column: loc?.start.column,
              });
            }
            continue;
          }
          // 普通数值界
          if (lv === undefined || typeof lv !== "number" || isStr) continue;
          let ok = true;
          if (atom.op === "gt") ok = lv > n;
          if (atom.op === "ge") ok = lv >= n;
          if (atom.op === "lt") ok = lv < n;
          if (atom.op === "le") ok = lv <= n;
          if (!ok) {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(fieldAbs),
              expected: `${fieldPath} ${opSym} ${n}`,
              suggestion: `use a value satisfying ${fieldPath} ${opSym} ${n}, or relax the precondition on ${paramName}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
        }
      }
    }

    // eq / union 域（lit()/union() 字段契约）：bounds 分支判不了——域隶属
    // 判定（domain-membership 语义复用）；仅 eq/union 形态触发，防双报
    if (
      lv !== undefined &&
      (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean") &&
      ((constraint.members?.length ?? 0) > 0 ||
        constraint.preds.some((p) => p.op === "eq")) &&
      !literalMeetsConstraint(lv, constraint)
    ) {
      out.push({
        severity: "error",
        code: "nudo:constraint-violated",
        message: `${displayName}[${paramName}]: argument ⊭ precondition`,
        actual: formatAbs(fieldAbs),
        expected: `${fieldPath} ∈ ${formatConstraint(constraint)}`,
        suggestion: `use a ${fieldPath} satisfying ${formatConstraint(constraint)}`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
    }
  };

  /** 对带 shape / array / int / prim 的 refine 做结构检查 */
  const checkShapeReqs = (
    displayName: string,
    reqs: Array<[number, RefineEntry, string | undefined]>,
    paramNames: string[],
    absArgs: Abs[],
    argIndexOf: (reqIdx: number) => number | undefined,
    loc?: { start: { line: number; column: number } },
  ): void => {
    for (const [idx, entry, field] of reqs) {
      const c = entry.constraint;
      if (!c.fields && !c.element && !isIntFlag(c) && !c.prim) continue;
      const argIdx = argIndexOf(idx);
      if (argIdx === undefined) continue;
      let arg = absArgs[argIdx];
      if (!arg) continue;
      const paramName = entry.param || paramNames[idx] || `arg${idx}`;
      // C4.1：解构契约 → 投影到字段再查；缺字段报 violation（与 checkReqs 同口径）
      if (field) {
        const projected = projectArgField(arg, field);
        if (!projected) {
          const k = arg.shape.k;
          if (k !== "unknown" && k !== "any") {
            out.push({
              severity: "error",
              code: "nudo:constraint-violated",
              message: `${displayName}[${paramName}]: argument ⊭ precondition`,
              actual: formatAbs(arg),
              expected: `missing field ${field}`,
              suggestion: `add the missing field ${field}`,
              fn: displayName,
              line: loc?.start.line,
              column: loc?.start.column,
            });
          }
          continue;
        }
        arg = projected;
      }
      // 裸 prim 已由 checkReqs 的 typeof pred 覆盖；此处只处理 shape/array/int
      // shape 字段
      if (c.fields) {
        checkShapeAgainstAbs(displayName, paramName, c, arg, paramName, loc);
      }
      // 顶层 array 元素
      if (c.element) {
        if (arg.shape.k === "arr") {
          checkFieldConstraint(
            displayName,
            paramName,
            c.element,
            (arg.shape as { element: Abs }).element,
            `${paramName}[]`,
            loc,
          );
        } else if (arg.shape.k === "tuple") {
          const els = (arg.shape as { elements: Abs[] }).elements;
          els.forEach((el, i) => {
            checkFieldConstraint(
              displayName,
              paramName,
              c.element!,
              el,
              `${paramName}[${i}]`,
              loc,
            );
          });
        } else if (
          isExactUndef(arg) ||
          (arg.shape.k !== "unknown" && arg.shape.k !== "any")
        ) {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: `array at ${paramName}`,
            suggestion: `use a value satisfying the array constraint`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
      // 顶层 int（builder 上 .int 是方法，标志须经 isIntFlag 读）
      if (isIntFlag(c)) {
        const iv = litValue(arg);
        if (typeof iv === "number" && !Number.isInteger(iv)) {
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${displayName}[${paramName}]: argument ⊭ precondition`,
            actual: formatAbs(arg),
            expected: `${paramName} is int`,
            suggestion: `use an integer`,
            fn: displayName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
    }
  };

  const parseCallArgs = (
    args: Array<Record<string, unknown>>,
  ): { absArgs: Abs[]; hasInfo: boolean } => {
    const absArgs: Abs[] = [];
    let hasInfo = false;
    const note = (abs: Abs | undefined): void => {
      if (abs && isInformativeArg(abs)) hasInfo = true;
    };
    for (const a of args ?? []) {
      if (a.type === "NumericLiteral" && typeof a.value === "number") {
        absArgs.push(numLit(a.value));
        hasInfo = true;
      } else if (
        a.type === "UnaryExpression" &&
        (a as { operator?: string }).operator === "-" &&
        (a as { argument?: Record<string, unknown> }).argument?.type === "NumericLiteral"
      ) {
        const num = (a as { argument: { value: number } }).argument;
        absArgs.push(numLit(-num.value));
        hasInfo = true;
      } else if (a.type === "ObjectExpression") {
        const abs = evalArgAbs(a, (n) => varAbs.get(n));
        absArgs.push(abs ?? absUnknown());
        note(abs);
      } else if (a.type === "ArrayExpression") {
        const abs = evalArgAbs(a, (n) => varAbs.get(n));
        absArgs.push(abs ?? absUnknown());
        note(abs);
      } else if (a.type === "StringLiteral" && typeof a.value === "string") {
        absArgs.push({
          shape: { k: "prim", type: "string" },
          term: { op: "lit", value: a.value },
          conf: "exact",
        });
        hasInfo = true;
      } else if (a.type === "Identifier" && typeof a.name === "string") {
        const abs = varAbs.get(a.name);
        absArgs.push(abs ?? absUnknown());
        note(abs);
      } else if (a.type === "MemberExpression") {
        // 变量键查找（map[k]）→ any（any ≤ 任意目标；≠ unknown 不发明义务）
        const computed = (a as { computed?: boolean }).computed === true;
        const prop = (a as { property?: Record<string, unknown> }).property;
        const litKey =
          prop?.type === "StringLiteral" || prop?.type === "NumericLiteral";
        if (computed && !litKey) {
          absArgs.push(anyAbs);
          hasInfo = true;
          continue;
        }
        const abs = evalArgAbs(a, (n) => varAbs.get(n));
        absArgs.push(abs ?? absUnknown());
        note(abs);
      } else if (a.type === "SpreadElement") {
        // 字面量数组 spread（`f(...[1, -2])`）：静态展开元素（字面量快路径）。
        // 非字面量（`f(...args)`）不猜——B 通道实参回退。
        const inner = (a as { argument?: Record<string, unknown> }).argument;
        if (inner?.type === "ArrayExpression") {
          for (const el of (inner.elements ?? []) as Array<Record<string, unknown> | null>) {
            if (!el) continue;
            if (el.type === "NumericLiteral" && typeof el.value === "number") {
              absArgs.push(numLit(el.value));
              hasInfo = true;
            } else if (el.type === "StringLiteral" && typeof el.value === "string") {
              absArgs.push({
                shape: { k: "prim", type: "string" },
                term: { op: "lit", value: el.value },
                conf: "exact",
              });
              hasInfo = true;
            } else {
              const abs = evalArgAbs(el, (n) => varAbs.get(n));
              absArgs.push(abs ?? absUnknown());
              note(abs);
            }
          }
        } else {
          absArgs.push(absUnknown());
        }
      } else if (a.type === "CallExpression") {
        // 内联调用（a.pop()/a.push(…)/xs.find(…)）：transpile 表达式位可能折
        // $lit(undefined) 假精确，静态不猜——交给 B 执行态实参回退。
        absArgs.push(absUnknown());
      } else {
        absArgs.push(absUnknown());
      }
    }
    return { absArgs, hasInfo };
  };

  const checkOneCall = (
    fnName: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!knownFns.includes(fnName)) return;

    // 传参结构：实参字面量 Abs ≤ 形参必填 slot
    checkArgStructures(fnName, source, args, loc);

    const parsed = parseCallArgs(args);
    let absArgs = parsed.absArgs;
    let hasInfo = parsed.hasInfo;
    // 值流回退：静态实参无信息（嵌套调用形参 / 复杂表达式）时按执行态实参执法。
    // 变量键查找已折 any（hasInfo），不会走到这里。
    if (!hasInfo) {
      const bArgs = takeBCallArgs(fnName, loc?.start.line);
      if (bArgs && bArgs.length > 0) {
        absArgs = bArgs;
        hasInfo = bArgs.some(isInformativeArg);
      }
    }
    if (!hasInfo || absArgs.length === 0) return;

    const g = generalizeFromAst(fnName, source, {
      file,
      refine: {
        loadModule: opts?.loadModule,
        fromFile: opts?.fromFile ?? "",
        ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        ...(opts?.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
      },
    });
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
      checkShapeReqs(fnName, ownFull, paramNames, absArgs, (i) => i, loc);
      checkReqs(
        fnName,
        ownFull.map(([i, e, f]) => [i, e.pred, f, e.param] as [number, Pred, string | undefined, string | undefined]),
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
        checkShapeReqs(`${fnName}→${fwd.target}`, tFull, tParams, absArgs, mapArg, loc);
        checkReqs(
          `${fnName}→${fwd.target}`,
          tFull.map(([i, e, f]) => [i, e.pred, f, e.param] as [number, Pred, string | undefined, string | undefined]),
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
    const parsedExt = parseCallArgs(args);
    let absArgs = parsedExt.absArgs;
    let hasInfo = parsedExt.hasInfo;
    if (!hasInfo) {
      const bArgs = takeBCallArgs(ext.fnName, loc?.start.line);
      if (bArgs && bArgs.length > 0) {
        absArgs = bArgs;
        hasInfo = bArgs.some(isInformativeArg);
      }
    }
    if (!hasInfo || absArgs.length === 0) return;
    let full: Array<[number, RefineEntry, string | undefined]> = [];
    let paramNames: string[] = [];
    try {
      const g = generalizeFromAst(ext.fnName, ext.source);
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
        code: "nudo:no-signature",
        message: `${displayName}: external callee contract could not be resolved; skipping call-site precondition check`,
        fn: displayName,
        line: loc?.start.line,
        column: loc?.start.column,
      });
      return;
    }
    checkShapeReqs(displayName, full, paramNames, absArgs, (i) => i, loc);
    checkReqs(
      displayName,
      full.map(([i, e, f]) => [i, e.pred, f, e.param] as [number, Pred, string | undefined, string | undefined]),
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
          code: "nudo:arg-structure",
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
    /** 跨文件时 ext 定义文件路径（保留签名，供未来侧车相关检查）；同文件忽略 */
    _interfaceFromFile?: string,
  ): void => {
    let gFn: ReturnType<typeof generalizeFromAst>;
    try {
      const sameFile = fnSource === source;
      gFn = generalizeFromAst(
        fnName,
        fnSource,
        {
          ...(sameFile && file ? { file } : {}),
          // refine 侧车/源码契约必须进 generalize——否则 fnRels 只剩 promote，
          // refine→error 路径永远打不开（source 永远是 warning）。
          refine: {
            loadModule: opts?.loadModule,
            fromFile: opts?.fromFile ?? "",
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
        code: "nudo:no-signature",
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

// ---------------------------------------------------------------------------
// T10b：跨文件注入调用点域证据 ⊄ 手写契约（nudo:interface-domain-exceeds）
// 实现见 scan-injected-domain.ts；此处 re-export 保持 scan.ts 对外形状不变。
// ---------------------------------------------------------------------------

export {
  checkInjectedDomainEvidence,
  type InjectedDomainRecord,
  type InjectedDomainEvidenceOpts,
} from "./scan-injected-domain.ts";
