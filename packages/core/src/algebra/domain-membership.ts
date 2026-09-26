/**
 * 字面量域隶属判定（Phase 1）。
 *
 * 手写契约（*.nudo.js）与调用点域证据对账用：判断字面量值是否落在
 * NudoConstraint 表达的域内。只覆盖可判定的标量子集：
 *
 *   - prim 门（prim 缺失或不匹配字面量类型 → false）
 *   - eq(self, lit v) 字面量等值（number/string/boolean/null）
 *   - gt/ge/lt/le 数值常数界（self op n）
 *   - 字符串长度界（length(self) op n，即 min/max/length 链）
 *   - int（整数性）
 *   - members（union）：任一成员满足即满足
 *
 * 对象 / 数组 / 函数域与不可判定的 pred 形态一律 false——保守不满足，
 * 对账侧宁可多报 domain-exceeds 也不放过。
 */

import type { NudoConstraint } from "./constraint.ts";
import { SELF, isIntFlag } from "./constraint.ts";
import type { Pred, TypeofName } from "./pred.ts";
import type { LiteralValue, Term } from "./term.ts";

/**
 * members / fn 是 Phase 1 constraint 扩展形态（union()/fn() 构建器）。
 * 经交叉视图读取，本模块不依赖扩展类型声明落地的时序。
 */
type ExtendedConstraint = NudoConstraint & {
  members?: NudoConstraint[];
  fn?: unknown;
};

/** 字面量 lv 是否落在约束 c 表达的域内（保守：判不了 → false）。 */
export function literalMeetsConstraint(
  lv: number | string | boolean | null,
  c: NudoConstraint,
): boolean {
  const ext = c as ExtendedConstraint;
  // 对象 / 数组 / 函数域：Phase 1 不做隶属判定
  if (c.fields || c.element) return false;
  if (ext.fn) return false;
  // union：任一成员满足即可
  if (Array.isArray(ext.members) && ext.members.length > 0) {
    return ext.members.some((m) => literalMeetsConstraint(lv, m));
  }
  // prim 门：缺失时（lit(null)/any() 等）只按 preds 判定——eq(self,null)
  // 能满足 null；any()（无 pred）接受一切字面量。有 prim 则必须类型匹配。
  if (c.prim === undefined) {
    return c.preds.every((p) => predHolds(lv, p));
  }
  if (!primMatches(c.prim, lv)) return false;
  // int：整数性（number 字面量）。int 是 number 链概念（.int() 强制
  // prim="number"），仅在 number prim 上执法；非 number prim 上的 int 位
  // 视为无意义不执法（builder 归一化可能给非数值约束带上杂散 int 位，
  // 此处不受其污染）。isIntFlag 统一读 builder/纯数据两种形态。
  if (
    isIntFlag(c) &&
    c.prim === "number" &&
    !(typeof lv === "number" && Number.isInteger(lv))
  ) {
    return false;
  }
  // preds 合取：全部满足
  return c.preds.every((p) => predHolds(lv, p));
}

/**
 * typeof 标签与字面量证据的匹配（JS typeof）。
 * 证据域只有 number|string|boolean|null：object 仅匹配 null
 * （typeof null === "object"）；function/undefined/bigint/symbol 无字面量证据。
 */
function primMatches(
  prim: TypeofName,
  lv: number | string | boolean | null,
): boolean {
  switch (prim) {
    case "number":
      return typeof lv === "number";
    case "string":
      return typeof lv === "string";
    case "boolean":
      return typeof lv === "boolean";
    case "object":
      return lv === null;
    default:
      return false;
  }
}

function predHolds(lv: number | string | boolean | null, p: Pred): boolean {
  switch (p.op) {
    case "eq": {
      const v = selfEqLiteral(p);
      return v !== undefined && lv === v;
    }
    case "gt":
    case "ge":
    case "lt":
    case "le":
      return boundHolds(lv, p);
    case "typeof":
      return p.t.op === "var" && p.t.id === SELF && primMatches(p.type, lv);
    // and 是合取：逐参数按同一规则判定（string().length(n) 的 preds 是
    // and 包裹的两个长度界，叶子仍是 gt/ge/lt/le，无假阳性风险）
    case "and":
      return p.args.every((x) => predHolds(lv, x));
    // ne / or / not / true / false 等其余形态：保守不满足
    default:
      return false;
  }
}

/** eq(self, lit v) / eq(lit v, self) 取字面量端；其余形态 undefined。 */
function selfEqLiteral(p: { a: Term; b: Term }): LiteralValue | undefined {
  if (isSelfVar(p.a) && p.b.op === "lit") return p.b.value;
  if (isSelfVar(p.b) && p.a.op === "lit") return p.a.value;
  return undefined;
}

type Cmp = "gt" | "ge" | "lt" | "le";

function cmpHolds(x: number, op: Cmp, n: number): boolean {
  switch (op) {
    case "gt":
      return x > n;
    case "ge":
      return x >= n;
    case "lt":
      return x < n;
    case "le":
      return x <= n;
  }
}

/** 数值界（self op n）与长度界（length(self) op n）；右端必须是数字 lit。 */
function boundHolds(
  lv: number | string | boolean | null,
  p: { op: Cmp; a: Term; b: Term },
): boolean {
  if (p.b.op !== "lit" || typeof p.b.value !== "number") return false;
  const n = p.b.value;
  // 长度界：仅 string 字面量按 length 比较
  if (isLengthSelf(p.a)) {
    return typeof lv === "string" && cmpHolds(lv.length, p.op, n);
  }
  // 数值界：仅 number 字面量
  if (isSelfVar(p.a)) {
    return typeof lv === "number" && cmpHolds(lv, p.op, n);
  }
  return false;
}

function isSelfVar(t: Term): boolean {
  return t.op === "var" && t.id === SELF;
}

function isLengthSelf(t: Term): boolean {
  return (
    t.op === "app" &&
    t.fn === "length" &&
    t.args.length === 1 &&
    isSelfVar(t.args[0]!)
  );
}
