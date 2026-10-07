/**
 * 调用边界契约面（issue #123 fix B）：callee 声明的 param/return 契约
 * 在调用点充当**类型面**——契约从「只执法」升级为「调用方可见的 face」。
 *
 * 注册面（按 fn 对象身份，WeakMap）：
 * - 跨模块：checkSource 对注入模块表（opts.modules / opts.inject.modules）里的
 *   桥接 Abs fn 逐个解析依赖侧车后 attach（$call 消费）。
 * - 同文件：checkSource 安装按名 resolver（$callNamed 消费）；resolve 命中后
 *   回写对象注册，同对象别名调用点（`const g = f; g(…)`）后续可直接命中。
 *
 * 采用规则（zero-FP 纪律，双位点）：
 * - 参数位：实参**无信息**（any / 非 lit unknown）→ 绑定声明面；实参已有信息
 *   （prim/字面量/obj/sum/…）→ **保留实参面**。替换有信息面会隐藏调用点违例
 *   （L1 文件级 scan 的 checkOneCall/checkExternalCall 执法域）或损失精度；
 *   无信息位无可违例——绑定声明面即「契约即接口」语义。
 * - 返回位：推断面携带的字面量值落在声明约束域内（literalMeetsConstraint）
 *   或推断面可赋给声明面（leqAbs）→ 保留推断精度；否则**呈现声明面**——
 *   #102 DP-OOB 标记臂 / widen 臂不外溢给调用方（callee 自身的
 *   unproven-return 警告照旧在 callee 侧报）。leq 的字面量保留分支是必要的：
 *   constraintToEntryAbs 的 entry Abs 带 typeof/eq 锚定 pred（锚在形参名/
 *   "return" 项上），裸字面量对它 leq 恒失败（check-interface-drift 同口径
 *   观察）——按约束域判定而非结构 leq。
 *   never（throws 通道承载）与 opaque（预算截断保守面）不替换。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import { leqAbs } from "./leq.ts";
import { constraintToEntryAbs, type NudoConstraint } from "./constraint.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import type { EffectiveInterface } from "./interface.ts";
import {
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "./collector-scope.ts";

/** fn 对象身份 → 契约面（paramFaces 按形参位锚定；returns 呈现面 + 原约束） */
export type FnContractFaces = {
  paramFaces: Array<Abs | undefined>;
  returns?: Abs;
  /** 返回位原约束（字面量域判定的精确通道；Abs 面只做呈现） */
  returnsConstraint?: NudoConstraint;
};

const facesByFn = new WeakMap<object, FnContractFaces>();

export function attachContractFaces(fnObj: object, faces: FnContractFaces): void {
  facesByFn.set(fnObj, faces);
}

export function contractFacesOf(fnObj: unknown): FnContractFaces | undefined {
  if (!fnObj || (typeof fnObj !== "object" && typeof fnObj !== "function")) {
    return undefined;
  }
  return facesByFn.get(fnObj as object);
}

// ---------------------------------------------------------------------------
// 同文件按名 resolver（checkSource 安装；$callNamed 兜底消费）
// ---------------------------------------------------------------------------

type ContractFaceResolver = (fnName: string) => FnContractFaces | undefined;

const contractFaceResolverSlot = createScopedSlot<ContractFaceResolver | null>(
  () => null,
);
registerCollectorScopeParticipant((body) =>
  contractFaceResolverSlot.runScoped(body),
);

export function setContractFaceResolver(
  resolver: ContractFaceResolver | null,
): ContractFaceResolver | null {
  const prev = contractFaceResolverSlot.get();
  contractFaceResolverSlot.set(resolver);
  return prev;
}

/** 按名解析契约面（被分析文件自身的同名契约；无 resolver / 无契约 → undefined） */
export function resolveContractFacesByName(
  fnName: string,
): FnContractFaces | undefined {
  const resolver = contractFaceResolverSlot.get();
  return resolver ? resolver(fnName) : undefined;
}

// ---------------------------------------------------------------------------
// 采用规则（参数位 / 返回位）
// ---------------------------------------------------------------------------

/** 实参无信息：any，或非 lit 的 unknown（lit(null/undefined) 是值证据，Bug 22 口径） */
function argLacksInformation(a: unknown): boolean {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return false;
  const k = (a as Abs).shape?.k;
  if (k === "any") return true;
  if (k === "unknown") return (a as Abs).term?.op !== "lit";
  return false;
}

/**
 * 参数面采用：仅替换无信息位，且不改变 arity（缺参位不补——补面会把
 * 运行时 undefined 伪装成契约值，吞掉真实 TypeError）。无变化时原数组引用返回。
 */
export function adoptCallArgsToFaces(args: Abs[], faces: FnContractFaces): Abs[] {
  const n = Math.min(args.length, faces.paramFaces.length);
  let changed = false;
  const out = args.slice();
  for (let i = 0; i < n; i++) {
    const face = faces.paramFaces[i];
    if (!face || !argLacksInformation(args[i])) continue;
    out[i] = face;
    changed = true;
  }
  return changed ? out : args;
}

/** 标量字面量值落在声明约束域内（非标量/不可判定 → false，保守走面替换） */
function litMeetsReturnConstraint(r: Abs, c: NudoConstraint | undefined): boolean {
  if (!c) return false;
  const lv = litValue(r);
  if (!lv.ok) return false;
  const v = lv.value;
  if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean"
    && v !== null && v !== undefined) {
    return false;
  }
  return literalMeetsConstraint(v, c);
}

/** 返回面呈现：字面量满足声明约束 / 推断面可赋给声明面 → 保留推断精度；否则声明面替换 */
export function presentCallResultFace(r: Abs, faces: FnContractFaces): Abs {
  const face = faces.returns;
  if (!face || !r || typeof r !== "object" || !r.shape) return r;
  if (r.shape.k === "never") return r; // always-throw：throws 通道承载，不得伪造返回面
  if (r.conf === "opaque") return r; // 预算截断保守面：不得用声明面洗白
  if (litMeetsReturnConstraint(r, faces.returnsConstraint)) return r;
  if (leqAbs(r, face).ok) return r; // 推断面已满足契约且更精确（谓词可证等）
  return face;
}

// ---------------------------------------------------------------------------
// EffectiveInterface → FnContractFaces（位置映射）
// ---------------------------------------------------------------------------

/**
 * 有效契约 → 位置化契约面。paramNames 是 callee 的形参名表（extractFn /
 * 依赖源码解析）；契约名对不上简单形参位（解构字段 / 别名）→ 该契约不充当
 * 面（callee 自身路径的 C4.1 投影仍由 generalize 执法）。
 * 仅 handwritten 充当面（generated 是事实快照，drift 未对账前不可信）；
 * conflict 位（合取不可满足）跳过。无可充当面 → undefined。
 */
export function contractFacesFromEffectiveInterface(
  eff: EffectiveInterface,
  paramNames: string[],
): FnContractFaces | undefined {
  if (eff.source !== "handwritten") return undefined;
  const conflictParams = eff.conflict?.params ?? [];
  const paramFaces: Array<Abs | undefined> = [];
  let hasFace = false;
  for (const e of eff.params) {
    const idx = paramNames.indexOf(e.param);
    if (idx < 0 || conflictParams.includes(e.param)) continue;
    paramFaces[idx] = constraintToEntryAbs(e.constraint, e.param);
    hasFace = true;
  }
  let returns: Abs | undefined;
  let returnsConstraint: NudoConstraint | undefined;
  if (eff.returns && !eff.conflict?.returns) {
    returns = constraintToEntryAbs(eff.returns.constraint, "return");
    returnsConstraint = eff.returns.constraint;
    hasFace = true;
  }
  return hasFace
    ? {
        paramFaces,
        ...(returns !== undefined ? { returns } : {}),
        ...(returnsConstraint !== undefined ? { returnsConstraint } : {}),
      }
    : undefined;
}
