/**
 * 语句控制流谓词（leaf）：与 transpile 主递归解耦，便于单测与拆文件。
 */
import type { Statement, Node } from "@babel/types";
import { indent } from "./helpers.ts";

export function stmtCompletesControl(stmt: Statement | undefined | null): boolean {
  if (!stmt) return false;
  switch (stmt.type) {
    case "BreakStatement":
    case "ReturnStatement":
    case "ThrowStatement":
    case "ContinueStatement":
      return true;
    case "BlockStatement":
      return stmtCompletesControl(stmt.body[stmt.body.length - 1] as Statement);
    case "IfStatement":
      return (
        stmt.alternate != null &&
        stmtCompletesControl(stmt.consequent as Statement) &&
        stmtCompletesControl(stmt.alternate as Statement)
      );
    default:
      return false;
  }
}

/** 语句或块内是否出现 return/throw（决定 if 是否提升为 return $fork） */
export function stmtReturns(stmt: Statement): boolean {
  if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") return true;
  if (stmt.type === "BlockStatement") return stmt.body.some(stmtReturns);
  if (stmt.type === "IfStatement") {
    return stmtReturns(stmt.consequent) && stmt.alternate != null && stmtReturns(stmt.alternate);
  }
  // switch：所有可达臂均 return/throw 且 **存在 default** 才视为终止
  // （无 default 时 no-match 会 fall-through，不得当终止 — P0-1）
  if (stmt.type === "SwitchStatement") {
    type Arm = { stmts: Statement[]; isDefault: boolean };
    const arms: Arm[] = [];
    for (const c of stmt.cases) {
      const testIsDefault = c.test === null || c.test === undefined;
      const last = arms[arms.length - 1];
      if (last && !last.isDefault && last.stmts.length === 0 && !testIsDefault) {
        last.stmts = c.consequent;
        continue;
      }
      if (
        last &&
        !last.isDefault &&
        !testIsDefault &&
        last.stmts.length > 0 &&
        c.consequent.length === 0
      ) {
        continue; // fall-through 空臂并入前一有体臂
      }
      arms.push({ stmts: c.consequent, isDefault: testIsDefault });
    }
    const armOk = (a: Arm): boolean => a.stmts.length > 0 && a.stmts.every(stmtReturns);
    const nonDefault = arms.filter((a) => !a.isDefault);
    const dflt = arms.find((a) => a.isDefault);
    if (dflt === undefined) return false; // 无 default：必然 fall-through
    return nonDefault.length > 0 && nonDefault.every(armOk) && armOk(dflt);
  }
  return false;
}

/** 终止语句：return / throw */
export function isTerminalStmt(s: Statement): boolean {
  return s.type === "ReturnStatement" || s.type === "ThrowStatement";
}

/**
 * 把 if/else-if 后的终止尾句收进缺失的最终 else：
 *   if (A) return 1; else if (B) return 2; return 0;
 * → if (A) return 1; else if (B) return 2; else return 0;
 * 否则 return $fork 优化不触发，臂内 JS return 被 thunk 吞掉后
 * 尾部 return 覆盖早退值（ms 的 else-if 数字分支即此形态）。
 */
export function completeElseChain(ifStmt: Statement, tail: Statement[]): Statement | null {
  if (ifStmt.type !== "IfStatement") return null;
  if (!tail.every(isTerminalStmt)) return null;
  const asBlock = (body: Statement): Statement =>
    body.type === "BlockStatement"
      ? body
      : ({ type: "BlockStatement", body: [body] } as unknown as Statement);
  if (ifStmt.alternate == null) {
    return {
      ...ifStmt,
      alternate: {
        type: "BlockStatement",
        body: [...tail],
      } as unknown as Statement,
    } as unknown as Statement;
  }
  if (ifStmt.alternate.type === "IfStatement") {
    const inner = completeElseChain(ifStmt.alternate, tail);
    if (!inner) return null;
    return { ...ifStmt, alternate: asBlock(inner) } as unknown as Statement;
  }
  return null;
}

export function completeElseChains(stmts: Statement[]): Statement[] {
  const out = stmts.map((s) => ({ ...s }) as unknown as Statement);
  for (let i = 0; i < out.length; i++) {
    const stmt = out[i]!;
    if (stmt.type !== "IfStatement") continue;
    // 仅早退 if：consequent 含 return/throw 时，尾句才是「未走 then」的续体
    if (!stmtReturns(stmt.consequent)) continue;
    const tail = out.slice(i + 1);
    if (tail.length === 0) continue;
    const fixed = completeElseChain(stmt, tail);
    if (!fixed) continue;
    out[i] = fixed;
    out.length = i + 1;
    break;
  }
  return out;
}

/** 块体无确定 return 时补隐式 return $lit(void 0) */
export function withImplicitReturn(body: Node, bodyStmts: string, depth: number): string {
  if (stmtReturns(body as unknown as Statement)) return bodyStmts;
  return `${bodyStmts}\n${indent(depth)}return $lit(void 0);`;
}

// --- nullish / typeof 守卫识别（issue #97 / Bug 2/3/23） ---------------------

export type NullishGuard = {
  /** 被守卫的标识符 */
  name: string;
  /** 该标识符可证非 nullish（指定粒度）的臂 */
  arm: "cons" | "alt";
  /**
   * 剪除粒度（Bug 3）：nullish = null+undefined（`p == null`、`!p`、复合
   * `p === null || p === undefined` 的否定臂）；null = 仅 null（严格
   * `p === null` 的假值臂——`null === undefined` 为 false，臂内 p 仍可能
   * undefined）；undefined = 仅 undefined（`typeof u === "undefined"` /
   * 严格 `u === undefined` 的假值臂——`typeof null === "object"`，臂内
   * u 仍可能 null）。
   */
  grain?: "nullish" | "null" | "undefined";
};

const TYPEOF_NAMES = new Set([
  "undefined", "object", "boolean", "number", "string", "function", "symbol", "bigint",
]);

const isStrLitNode = (n: unknown): n is { value: string } => {
  const t = n as { type?: string; value?: unknown };
  return t?.type === "StringLiteral" && typeof t.value === "string";
};

/** UnaryExpression `typeof x` 且 x 是 Identifier */
const typeofArgName = (n: unknown): string | undefined => {
  const t = n as { type?: string; operator?: string; argument?: { type?: string; name?: string } };
  if (t?.type === "UnaryExpression" && t.operator === "typeof" && t.argument?.type === "Identifier") {
    return t.argument.name;
  }
  return undefined;
};

/** 粒度合并（复合守卫否定臂的合取事实）：覆盖两粒度 → nullish */
function mergeGrain(a: "null" | "undefined", b: "null" | "undefined"): "nullish" | "null" | "undefined" {
  if (a !== b) return "nullish";
  return a;
}

/**
 * 测试表达式是否是「标识符的 nullish 守卫」，返回非 nullish 事实所属臂：
 * - `p === null` / `p === undefined`（严格）→ else（alt）臂剪对应粒度
 *   （严格等价只排除该字面量：`p === null` 假值臂仍可能 undefined）
 * - `p == null` / `p == undefined`（宽松）→ else 臂剪 nullish（宽松等价
 *   `null == undefined` 同真，假值臂两者皆非）
 * - `p !== null` / `p != null` … → then（cons）臂同粒度剪除
 * - `!p` → else 臂（¬!p ⇒ p 真值 ⇒ 非 nullish）
 * - 裸 `p` → then 臂（p 真值 ⇒ 非 nullish）
 * - `typeof u === "undefined"` → else 臂仅剪 undefined（`typeof null ===
 *   "object"`，臂内 u 仍可能 null）；`!==` → then 臂
 * - `p === null || p === undefined` → else 臂剪 nullish（两比较同假 ⇒
 *   p 既非 null 也非 undefined）；`p !== null && p !== undefined` → then
 *   臂剪 nullish（同标识符两侧 nullish 比较的确定复合形态）
 * 守卫变量在该臂内以 $removeNullish/$removeNull/$removeUndefined 影子重绑，
 * 成员读写不再记 may-throw（issue #97：`if (p === null) return -1; p.major`）。
 */
export function nullishGuardOf(test: unknown): NullishGuard | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: unknown;
    right?: unknown;
    argument?: { type?: string; name?: string };
    name?: string;
  };
  if (t?.type === "LogicalExpression") return compositeNullishGuardOf(t);
  if (t?.type === "UnaryExpression" && t.operator === "!" && t.argument?.type === "Identifier" && t.argument.name) {
    return { name: t.argument.name, arm: "alt", grain: "nullish" };
  }
  if (t?.type === "Identifier" && t.name) {
    return { name: t.name, arm: "cons", grain: "nullish" };
  }
  if (t?.type !== "BinaryExpression") return undefined;
  const op = t.operator;
  if (op !== "===" && op !== "!==" && op !== "==" && op !== "!=") return undefined;
  const truthyArm = op === "===" || op === "==" ? "alt" : "cons";
  // `typeof u === "undefined"`：真值臂 u 是 undefined；假值臂仅证非 undefined
  const lTo = typeofArgName(t.left);
  const rTo = typeofArgName(t.right);
  if (lTo !== undefined && isStrLitNode(t.right)) {
    if (t.right.value === "undefined") return { name: lTo, arm: truthyArm, grain: "undefined" };
    return undefined;
  }
  if (rTo !== undefined && isStrLitNode(t.left)) {
    if (t.left.value === "undefined") return { name: rTo, arm: truthyArm, grain: "undefined" };
    return undefined;
  }
  const litGrain = (lit: unknown): "null" | "undefined" | "nullish" | undefined => {
    const ln = lit as { type?: string; name?: string };
    const isNull = ln?.type === "NullLiteral";
    if (!isNull && ln?.name !== "undefined") return undefined;
    // 宽松等价：null/undefined 互通（`null == undefined` 为真）→ 假值臂全剪
    if (op === "==" || op === "!=") return "nullish";
    return isNull ? "null" : "undefined";
  };
  const l = t.left as { type?: string; name?: string };
  const r = t.right as { type?: string; name?: string };
  if (l?.type === "Identifier" && l.name) {
    const grain = litGrain(r);
    if (grain !== undefined) return { name: l.name, arm: truthyArm, grain };
  }
  if (r?.type === "Identifier" && r.name) {
    const grain = litGrain(l);
    if (grain !== undefined) return { name: r.name, arm: truthyArm, grain };
  }
  return undefined;
}

/** LogicalExpression 复合 nullish 守卫：同一 Identifier 两侧 nullish 比较的确定形态 */
function compositeNullishGuardOf(test: unknown): NullishGuard | undefined {
  const t = test as { type?: string; operator?: string; left?: unknown; right?: unknown };
  if (t?.type !== "LogicalExpression" || (t.operator !== "||" && t.operator !== "&&")) return undefined;
  const l = nullishGuardOf(t.left);
  const r = nullishGuardOf(t.right);
  if (!l || !r || l.name !== r.name) return undefined;
  const wantArm = t.operator === "||" ? "alt" : "cons";
  if (l.arm !== wantArm || r.arm !== wantArm) return undefined;
  const g1 = l.grain === "null" || l.grain === "undefined" ? l.grain : null;
  const g2 = r.grain === "null" || r.grain === "undefined" ? r.grain : null;
  const grain =
    g1 === null || g2 === null
      ? "nullish"
      : mergeGrain(g1, g2);
  return { name: l.name, arm: wantArm, grain };
}

/**
 * typeof 类型守卫（Bug 23）：`typeof v === "string"` / `"string" === typeof v`
 * （`===`/`!==`/`==`/`!=`）→ arm 臂内 v 的 typeof 恒为 typeOf（`===` → cons，
 * `!==` → alt）。"undefined" 交由 nullishGuardOf 的 grain 通道处理（同一
 * 表达式不得双守卫），此处不认。
 */
export type TypeGuard = {
  /** 被守卫的标识符 */
  name: string;
  /** typeof 结果字面量 */
  typeOf: string;
  /** 该 typeof 事实成立的臂 */
  arm: "cons" | "alt";
};

export function typeGuardOf(test: unknown): TypeGuard | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: unknown;
    right?: unknown;
  };
  if (t?.type !== "BinaryExpression") return undefined;
  const op = t.operator;
  if (op !== "===" && op !== "!==" && op !== "==" && op !== "!=") return undefined;
  const lTo = typeofArgName(t.left);
  const rTo = typeofArgName(t.right);
  const litSide = lTo !== undefined ? t.right : rTo !== undefined ? t.left : null;
  const name = lTo ?? rTo;
  if (name === undefined || !isStrLitNode(litSide)) return undefined;
  if (litSide.value === "undefined" || !TYPEOF_NAMES.has(litSide.value)) return undefined;
  return { name, typeOf: litSide.value, arm: op === "===" || op === "==" ? "cons" : "alt" };
}

/** nullish 守卫的臂 thunk 剪影运行时助手（按粒度分发） */
function removeCallOf(grain: "nullish" | "null" | "undefined" | undefined): string {
  if (grain === "undefined") return "$removeUndefined";
  if (grain === "null") return "$removeNull";
  return "$removeNullish";
}

/** 守卫臂 thunk 的 nullish 剪影包装：`((p) => THUNK)($removeNullish(p))`。
 *  仅当守卫名不在 fork 绑定集（臂内无写/快照重绑）时应用——否则影子参数
 *  会吞掉臂内写，破坏 forkJoin 的绑定 join。 */
export function narrowNullishArmThunk(thunk: string, guard: NullishGuard | undefined, arm: "cons" | "alt", forkBindingNames: ReadonlySet<string> | readonly string[]): string {
  if (!guard || guard.arm !== arm) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (names.has(guard.name)) return thunk;
  return `((${guard.name}) => ${thunk})(${removeCallOf(guard.grain)}(${guard.name}))`;
}

/** typeof 类型守卫臂 thunk 的剪影包装：`((v) => THUNK)($narrowTypeOf(v, T, keep))`。
 *  事实臂（arm）保留匹配成员，对侧臂绑补集；守卫名在 fork 绑定集时跳过
 *  （与 nullish 剪影同规则）。 */
export function narrowTypeArmThunk(thunk: string, guard: TypeGuard | undefined, arm: "cons" | "alt", forkBindingNames: ReadonlySet<string> | readonly string[]): string {
  if (!guard) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (names.has(guard.name)) return thunk;
  const keep = arm === guard.arm;
  return `((${guard.name}) => ${thunk})($narrowTypeOf(${guard.name}, ${JSON.stringify(guard.typeOf)}, ${keep}))`;
}
