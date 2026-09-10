/**
 * Kernel 路由层：evaluator 在语义域上把路径切到 @nudojs/kernel。
 *
 * 开关：
 *   env NUDO_KERNEL 未设 / 1 / all  → 默认开启 arith,hof,object
 *   env NUDO_KERNEL=0 / off         → 全关（回退旧路径）
 *   env NUDO_KERNEL=arith,hof       → 逗号分隔子集
 *
 * 纪律：kernel 路径失败必须回退旧路径并可选记录，禁止静默吞错改变语义。
 * generalize 进 analyzer 仍需 setKernelModule 注入，不受此默认影响。
 */

import type { TypeValue } from "@nudojs/core";
import { T } from "@nudojs/core";
import {
  typeValueToAbs,
  absToTypeValue,
  getTvConfidence,
  add as kAdd,
  sub as kSub,
  mul as kMul,
  cmp as kCmp,
  type Abs,
  type Phi,
  pTrue,
  and as phiAnd,
  trueConstraint,
  falseConstraint,
  litValue,
  formatAbs,
  abs as makeAbs,
  lit as termLit,
  numLit,
  spread as kSpread,
  joinAbs as kJoinAbs,
  isObj as kIsObj,
} from "@nudojs/kernel";
import { getTerm, getPred } from "./term-registry.ts";

export type KernelDomain = "arith" | "hof" | "object" | "generalize";

const ALL: KernelDomain[] = ["arith", "hof", "object", "generalize"];
/** M5 默认开启的域：与旧路径 931 测试 parity 通过 */
const DEFAULT_ON: KernelDomain[] = ["arith", "hof", "object"];

function parseDomainsFromEnv(): Set<KernelDomain> {
  const raw = process.env.NUDO_KERNEL;
  // 显式关闭
  if (raw === "0" || raw === "off") {
    return new Set();
  }
  // 未设 / 1 / all / on → 默认开启 arith,hof,object；all 额外含 generalize
  if (raw === undefined || raw === "" || raw === "1" || raw === "on") {
    return new Set(DEFAULT_ON);
  }
  if (raw === "all") {
    return new Set(ALL);
  }
  const set = new Set<KernelDomain>();
  for (const part of raw.split(/[,\s]+/)) {
    if ((ALL as string[]).includes(part)) set.add(part as KernelDomain);
  }
  return set;
}

let domains: Set<KernelDomain> = parseDomainsFromEnv();

export function setKernelDomains(ds: KernelDomain[] | "all" | "off"): void {
  if (ds === "all") domains = new Set(ALL);
  else if (ds === "off") domains = new Set();
  else domains = new Set(ds);
}

export function kernelEnabled(domain: KernelDomain): boolean {
  return domains.has(domain);
}

export function currentKernelDomains(): KernelDomain[] {
  return [...domains];
}

// --- Phi 栈 ---

let phiStack: Phi[] = [pTrue];

export function currentPhi(): Phi {
  return phiStack[phiStack.length - 1] ?? pTrue;
}

export function pushPhi(p: Phi): void {
  phiStack.push(p);
}

export function popPhi(): void {
  if (phiStack.length > 1) phiStack.pop();
}

export function resetPhi(): void {
  phiStack = [pTrue];
}

/** 在当前 Φ 上合取额外约束 */
export function withPhiConstraint(extra: Phi, body: () => void): void {
  pushPhi(extra);
  try {
    body();
  } finally {
    popPhi();
  }
}

// --- 算术路由 ---

const ARITH_OPS = new Set(["+", "-", "*"]);
const CMP_OPS = new Set(["<", "<=", ">", ">="]);

function isNumericOperand(tv: TypeValue): boolean {
  if (!tv) return false;
  if (tv.kind === "literal") return typeof tv.value === "number";
  if (tv.kind === "primitive") return tv.type === "number";
  if (tv.kind === "refined") return isNumericOperand(tv.base);
  return false;
}

function isStringOperand(tv: TypeValue): boolean {
  if (!tv) return false;
  if (tv.kind === "literal") return typeof tv.value === "string";
  if (tv.kind === "primitive") return tv.type === "string";
  if (tv.kind === "refined") return isStringOperand(tv.base);
  return false;
}

/** `+` 可接受：双数值；或任一侧 string/template（拼接） */
function canAdd(left: TypeValue, right: TypeValue): boolean {
  if (isNumericOperand(left) && isNumericOperand(right)) return true;
  if (isStringOperand(left) || isStringOperand(right)) return true;
  // template refined：base 是 string
  if (left.kind === "refined" && isStringOperand(left.base)) return true;
  if (right.kind === "refined" && isStringOperand(right.base)) return true;
  return false;
}

/** 带 term 旁路的 TypeValue → Abs */
function toAbsWithTerms(tv: TypeValue): Abs {
  const base = typeValueToAbs(tv);
  const term = getTerm(tv);
  const pred = getPred(tv);
  if (!term && !pred) return base;
  return makeAbs(base.shape, term ?? base.term, pred ?? base.pred, base.conf);
}

/**
 * kernel 计算二元算术/比较。
 * undefined = 不可处理（union、非数/串操作数）→ 旧路径兜底。
 */
export function tryKernelBinary(
  op: string,
  left: TypeValue,
  right: TypeValue,
): TypeValue | undefined {
  if (!kernelEnabled("arith")) return undefined;
  if (!ARITH_OPS.has(op) && !CMP_OPS.has(op)) return undefined;

  if (op === "+") {
    if (!canAdd(left, right)) return undefined;
  } else if (op === "-" || op === "*") {
    if (!isNumericOperand(left) || !isNumericOperand(right)) return undefined;
  } else {
    // 比较：仅数值
    if (!isNumericOperand(left) || !isNumericOperand(right)) return undefined;
  }

  try {
    const la = toAbsWithTerms(left);
    const ra = toAbsWithTerms(right);
    const phi = currentPhi();
    let result: Abs;

    if (op === "+") result = kAdd(la, ra, phi);
    else if (op === "-") result = kSub(la, ra, phi);
    else if (op === "*") result = kMul(la, ra, phi);
    else if (op === "<") result = kCmp("lt", la, ra, phi);
    else if (op === "<=") result = kCmp("le", la, ra, phi);
    else if (op === ">") result = kCmp("gt", la, ra, phi);
    else if (op === ">=") result = kCmp("ge", la, ra, phi);
    else return undefined;

    return absToTypeValue(result);
  } catch {
    return undefined;
  }
}

/**
 * 从 if 测试的结果 TypeValue 提取 true/false 约束，供分支使用。
 * M1.5+ 走 phiFromTest(AST)；此 API 保留兼容，恒 undefined。
 */
export function extractBranchPhis(_test: TypeValue): {
  whenTrue: Phi;
  whenFalse: Phi;
} | undefined {
  return undefined;
}

/**
 * 供测试/调试：当前 Φ 的可读形式。
 */
export function describePhi(): string {
  const p = currentPhi();
  if (p.op === "true") return "⊤";
  return "(phi)";
}

/**
 * M4：对象 spread 经 kernel（右侧覆盖，保留字面量）。
 * 返回 undefined 表示走旧 Object.assign 路径。
 */
export function tryKernelObjectSpread(
  base: TypeValue,
  over: TypeValue,
): TypeValue | undefined {
  if (!kernelEnabled("object") && !kernelEnabled("arith")) return undefined;
  if (base.kind !== "object" && base.kind !== "union") return undefined;
  if (over.kind !== "object" && over.kind !== "union") return undefined;
  try {
    const ba = toAbsWithTerms(base);
    const oa = toAbsWithTerms(over);
    const r = kSpread(ba, oa);
    return absToTypeValue(r);
  } catch {
    return undefined;
  }
}

/**
 * M4：对象 join（异 key 保持 sum，不折 optional）。
 */
export function tryKernelJoinObjects(
  a: TypeValue,
  b: TypeValue,
): TypeValue | undefined {
  if (!kernelEnabled("object") && !kernelEnabled("arith")) return undefined;
  if (a.kind !== "object" || b.kind !== "object") return undefined;
  try {
    const r = kJoinAbs(toAbsWithTerms(a), toAbsWithTerms(b));
    return absToTypeValue(r);
  } catch {
    return undefined;
  }
}
