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
 *   assume 前提激活时**按形参名作用域**跳过（见 adoptCallArgsToFaces）：
 *   只有当引理前提的自由变量里确实含该位被重锚成的 callee 形参名时才跳过。
 * - 返回位：推断面携带的字面量值落在声明约束域内（literalMeetsConstraint）
 *   或推断面可赋给声明面（leqAbs）→ 保留推断精度；否则**呈现声明面**——
 *   #102 DP-OOB 标记臂 / widen 臂不外溢给调用方（callee 自身的
 *   unproven-return 警告照旧在 callee 侧报）。leq 的字面量保留分支是必要的：
 *   constraintToEntryAbs 的 entry Abs 带 typeof/eq 锚定 pred（锚在形参名/
 *   "return" 项上），裸字面量对它 leq 恒失败（check-interface-drift 同口径
 *   观察）——按约束域判定而非结构 leq。
 *   never（throws 通道承载）与 opaque（预算截断保守面）不替换。
 *   **确定违反**声明约束时（Bug 343）不替换——callee 违约时不得把声明面
 *   当作事实交给 caller（caller 的返回契约会建立在已被引擎证伪的前提上）。
 *   **bigint 与其余标量同口径**（Bug 1142）：域判定必须**在比较之后**发生
 *   （bigint 不得在 `literalMeetsConstraint` 之前被过滤掉），否则
 *   `lit(1n)` 契约既判不出「满足」也判不出「违反」⇒ 违约推断面被声明面
 *   替换 ⇒ 假绿。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import { pTrue, predVars } from "./pred.ts";
import { currentAssumePremises } from "./exec/runtime.ts";
import { leqAbs } from "./leq.ts";
import {
  constraintAdmitsNullish,
  constraintToEntryAbs,
  derefConstraint,
  type NudoConstraint,
} from "./constraint.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import type { EffectiveInterface } from "./interface.ts";
import {
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "./collector-scope.ts";

/** fn 对象身份 → 契约面（paramFaces 按形参位锚定；returns 呈现面 + 原约束） */
export type FnContractFaces = {
  paramFaces: Array<Abs | undefined>;
  /**
   * 形参位 → 该位被重锚成的 **callee 形参名**（与 paramFaces 同下标；空洞即
   * 该位无面）。#346：assume 前提按形参名作用域判定采用与否的锚点。
   */
  paramAnchors?: string[];
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
 *
 * #152 soundness（**按形参名作用域**，Bug 346）：采用会把无信息实参
 * **重锚为 callee 形参名 term**（constraintToEntryAbs(constraint, calleeParam)），
 * 该 term 经 callee 返回值流回 caller 帧后，与用户引理的裸 var 名匹配
 * （divAssumeBounds 按 termEquals 恒等）= unsound 假证明——callee 形参名
 * 与引理形参名同名时（d/max 等常见名），无关值也能折出界。
 * callAtFunctionBoundary 只清 **callee 帧**的槽，救不了 caller 帧内
 * 已 Fabricate 的假 term。目标帧自身形参由 generalize 的 entry Abs 锚定
 * （不经采用）。
 *
 * ⇒ 只有当**引理前提的自由变量里确实含该位被重锚成的 callee 形参名**时，
 * 才跳过这一位的采用；与本次调用无关的惰性引理（前提里的名字与 callee
 * 形参名无交集）**不再整体关掉采用**——旧口径（前提槽非 pTrue 即全量
 * 跳过）会让一条惰性公理把调用方的返回类型退化成 `any` 并造出假红
 * （nudo:unproven-return / nudo:entry-may-throw）。
 */
export function adoptCallArgsToFaces(args: Abs[], faces: FnContractFaces): Abs[] {
  const n = Math.min(args.length, faces.paramFaces.length);
  let changed = false;
  const out = args.slice();
  const premiseVars = assumePremiseVarNames();
  for (let i = 0; i < n; i++) {
    const face = faces.paramFaces[i];
    if (!face || !argLacksInformation(args[i])) continue;
    const anchor = faces.paramAnchors?.[i];
    if (anchor !== undefined && premiseVars?.has(anchor)) continue;
    out[i] = face;
    changed = true;
  }
  return changed ? out : args;
}

/** assume 前提槽的自由变量名集合（无前提 / 前提无自由变量 → undefined） */
function assumePremiseVarNames(): Set<string> | undefined {
  const phi = currentAssumePremises();
  if (!phi || phi === pTrue || phi.op === "true") return undefined;
  const vars = predVars(phi);
  return vars.size > 0 ? vars : undefined;
}

/**
 * 标量字面量值落在声明约束域内（非标量/不可判定 → false，保守走面替换）。
 *
 * **bigint 必须参与比较**（Bug 1142）：此前本函数在调用
 * `literalMeetsConstraint` **之前**就把 bigint 排除掉 ⇒ bigint 值从不
 * 参与域判定 ⇒ `lit(1n)` 契约既判不出「满足」也判不出「违反」⇒
 * 违约推断面被**声明面替换**（`2n` 被当成满足 `lit(1n)`）⇒ **假绿**。
 * 现在 bigint 与 number / string / boolean 同口径（域隶属通道的
 * `literalSame`：`===` + NaN 特例 ⇒ `1n !== 1`，bigint 与 number 不混同）。
 */
function litMeetsReturnConstraint(r: Abs, c: NudoConstraint | undefined): boolean {
  if (!c) return false;
  const lv = litValue(r);
  if (!lv.ok) return false;
  const v = lv.value;
  if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean"
    && typeof v !== "bigint" && v !== null && v !== undefined) {
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
  // Bug 343：推断面**确定违反**声明约束（callee 违约）时不得用声明面替换——
  // 声明面是「callee 的承诺」，callee 已违约时把承诺当事实交给 caller，
  // caller 的返回契约就会被「证得」（跨模块时零错误的假绿）。
  if (violatesDeclaredReturn(r, faces.returnsConstraint)) return r;
  return face;
}

/**
 * 推断面**确定违反**声明约束吗？只认确定证据（不误伤精度）：
 * - 标量字面量落在声明域外（域判定可判的标量契约）；
 * - nullish 字面量而声明域不承认 nullish。
 * 结构域（shape / array / fn）的域判定判不了（literalMeetsConstraint 对
 * 结构域一律 false）⇒ 不算违反（保守：仍用声明面）。非字面量（无确定值）
 * ⇒ 不算违反。
 *
 * **bigint 必须参与比较**（Bug 1142）：此前 bigint 在比较**之前**被排除
 * ⇒ `lit(1n)` 契约收到 `2n` 判不出「确定违反」⇒ 走声明面替换 ⇒ 违约
 * 被洗白（假绿）。现在 bigint 与其余标量同口径（`2n` 对 `lit(1n)` 违反、
 * `1n` 满足；`1` 对 `lit(1n)` 违反——number 与 bigint 不混同）。
 */
function violatesDeclaredReturn(r: Abs, c: NudoConstraint | undefined): boolean {
  if (!c) return false;
  const cc = derefConstraint(c);
  if (cc.fields || cc.element || cc.fn) return false; // 结构域判不了
  const term = r.term;
  if (!term || term.op !== "lit") return false; // 非字面量：无确定证据
  const v = term.value;
  if (v === null || v === undefined) return !constraintAdmitsNullish(cc);
  if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean"
    && typeof v !== "bigint") {
    return false;
  }
  return !literalMeetsConstraint(v, cc);
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
 *
 * 形参位同时记下**锚点名**（= callee 形参名）：#346 的 assume 前提按名
 * 作用域判定要跳过哪一位的采用。
 */
export function contractFacesFromEffectiveInterface(
  eff: EffectiveInterface,
  paramNames: string[],
): FnContractFaces | undefined {
  if (eff.source !== "handwritten") return undefined;
  const conflictParams = eff.conflict?.params ?? [];
  const paramFaces: Array<Abs | undefined> = [];
  const paramAnchors: string[] = [];
  let hasFace = false;
  for (const e of eff.params) {
    const idx = paramNames.indexOf(e.param);
    if (idx < 0 || conflictParams.includes(e.param)) continue;
    paramFaces[idx] = constraintToEntryAbs(e.constraint, e.param);
    paramAnchors[idx] = e.param;
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
        paramAnchors,
        ...(returns !== undefined ? { returns } : {}),
        ...(returnsConstraint !== undefined ? { returnsConstraint } : {}),
      }
    : undefined;
}
