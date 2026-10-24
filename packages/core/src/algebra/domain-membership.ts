/**
 * 字面量域隶属判定（Phase 1）。
 *
 * 手写契约（*.nudo.js）与调用点域证据对账用：判断字面量值是否落在
 * NudoConstraint 表达的域内。只覆盖可判定的标量子集：
 *
 *   - prim 门（prim 缺失或不匹配字面量类型 → false）
 *   - eq(self, lit v) 字面量等值（`===` + NaN 特例；见 literalSame）
 *   - gt/ge/lt/le 数值常数界（self op n）
 *   - 字符串长度界（length(self) op n，即 min/max/length 链）
 *   - int（整数性）
 *   - members（union）：任一成员满足即满足
 *
 * **bigint**（族 11 片 S7 / Bug 915 延伸）：`lit(1n)` 这类 bigint 字面量契约
 * 此前在本通道**判不了**（值域只放行 number / string / boolean / null /
 * undefined）⇒ 字段位 / 元素位对 bigint 字面量实参**零诊断**（假绿），
 * 而**标量实参位**（S6 修好）报违例 ⇒ 同一份契约两个位置两种裁决。
 * 现在字面量值域含 bigint ⇒ 域隶属通道对 bigint 与其余标量同口径。
 *
 * 对象 / 数组 / 函数域与不可判定的 pred 形态一律 false——保守不满足，
 * 对账侧宁可多报 domain-exceeds 也不放过。
 */

import type { NudoConstraint } from "./constraint.ts";
import { SELF, derefConstraint, isIntFlag } from "./constraint.ts";
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

/** 字面量 lv 是否落在约束 c 表达的域内（保守：判不了 → false）。
 *
 *  值域 = `LiteralValue`（含 **bigint**；族 11 片 S7 / Bug 915 延伸）——
 *  bigint 字面量实参此前不在值域内 ⇒ 域隶属通道对 bigint 恒不满足，
 *  而调用点的守卫又不放行 bigint ⇒ 字段位 / 元素位对 bigint **零诊断**。 */
export function literalMeetsConstraint(
  lv: LiteralValue,
  c: NudoConstraint,
  seen?: Set<object>,
): boolean {
  // lazy 包装（issue #120）：值驱动下降逐层解一层；环经 thunk 身份 seen
  // 终止——字面量对递归结构的域判定在有限位置收敛
  if (c.lazy) {
    const s = seen ?? new Set<object>();
    if (s.has(c.lazy)) return false;
    s.add(c.lazy);
    return literalMeetsConstraint(lv, derefConstraint(c), s);
  }
  const ext = c as ExtendedConstraint;
  // 对象 / 数组 / 函数域：Phase 1 不做隶属判定
  if (c.fields || c.element) return false;
  if (ext.fn) return false;
  // union：任一成员满足即可
  if (Array.isArray(ext.members) && ext.members.length > 0) {
    return ext.members.some((m) => literalMeetsConstraint(lv, m, seen));
  }
  // prim 门：缺失时（lit(null)/lit(undefined)/any() 等）只按 preds 判定——
  // eq(self,null) 能满足 null；any()（无 pred）接受一切字面量。有 prim 则必须类型匹配。
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
 * 证据域含 undefined/null：object 仅匹配 null（typeof null === "object"），
 * undefined 匹配 "undefined"；function/symbol 无字面量证据。
 *
 * **bigint**（族 11 片 S7 / Bug 915 延伸）：此前 bigint 落 `default` ⇒ 恒
 * false ⇒ `typeof(x, "bigint")` 原子与 `prim: "bigint"` 的约束**永远不满足**
 * ⇒ 同一条契约在 bigint 实参上恒判违例。现在 bigint 与其余标量同口径。
 */
function primMatches(prim: TypeofName, lv: LiteralValue): boolean {
  switch (prim) {
    case "number":
      return typeof lv === "number";
    case "string":
      return typeof lv === "string";
    case "boolean":
      return typeof lv === "boolean";
    case "bigint":
      return typeof lv === "bigint";
    case "object":
      return lv === null;
    case "undefined":
      return lv === undefined;
    default:
      return false;
  }
}

/**
 * 字面量同一性（Bug 915）：`===` + NaN 特例。
 *
 * - `===` ⇒ `-0` 与 `0` 同值（与 JS 语义一致：原生 `(-0) === 0` 为 true）
 * - NaN 特例 ⇒ `NaN` 与自身同值（`===` 对 NaN 为 false，而字面量同一性
 *   必须覆盖 NaN：契约写 `lit(NaN)` 时传 NaN 应当满足）
 *
 * 口径与 `term.ts` 的 `termEquals` 一致（`===` + NaN 特例）。
 *
 * 背景：本文件（**域隶属面**：对象字段位 / 数组元素位）此前用
 * `Object.is`（SameValue），而同一条执法路径的**标量实参位**用 `===`
 * ⇒ 同一份 `lit(0)` 契约，`-0` 在标量位放行、在字段位报错（两种裁决）。
 * ⚠ `leq.ts` 的 `leqAbs` 用的是 SameValue（`Object.is`）——那是**赋值面**
 * 的独立裁决（Bug 398），与本文件不是同一口径，**不要再互相引用为「同口径」**。
 *
 * **bigint**（族 11 片 S7 / Bug 915 延伸）：`===` 对 bigint 天然成立
 * （`1n === 1n` 为 true，且 `1n !== 1` ⇒ number 与 bigint 不混同）⇒
 * `lit(1n)` 契约对 `1n` 满足、对 `2n` / `1` 不满足。
 */
function literalSame(lv: LiteralValue, lit: LiteralValue): boolean {
  if (lv === lit) return true;
  return (
    typeof lv === "number" &&
    typeof lit === "number" &&
    Number.isNaN(lv) &&
    Number.isNaN(lit)
  );
}

function predHolds(lv: LiteralValue, p: Pred): boolean {
  switch (p.op) {
    case "eq": {
      // eq(self, lit v)：lit(undefined)/lit(NaN) 的 litValue 哨兵 + === 都会漏；
      // 直接看 term（字面量同一性见 literalSame）。
      const litT = isSelfVar(p.a) && p.b.op === "lit" ? p.b
        : isSelfVar(p.b) && p.a.op === "lit" ? p.a
        : undefined;
      if (!litT) return false;
      return literalSame(lv, litT.value);
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
  lv: LiteralValue,
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
