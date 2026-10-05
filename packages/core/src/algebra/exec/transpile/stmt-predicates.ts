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

// --- nullish 守卫识别（issue #97） -----------------------------------------

export type NullishGuard = {
  /** 被守卫的标识符 */
  name: string;
  /** 该标识符可证非 nullish 的臂 */
  arm: "cons" | "alt";
};

const isNullishLitNode = (n: unknown): boolean => {
  const t = n as { type?: string; name?: string };
  return t?.type === "NullLiteral" || (t?.type === "Identifier" && t.name === "undefined");
};

/**
 * 测试表达式是否是「标识符的 nullish 守卫」，返回非 nullish 事实所属臂：
 * - `p === null` / `p === undefined` / `p == null` / `p == undefined`
 *   （及字面量在左的对称形态）→ else（alt）臂 p 非 nullish
 * - `p !== null` / `p != null` … → then（cons）臂 p 非 nullish
 * - `!p` → else 臂（¬!p ⇒ p 真值 ⇒ 非 nullish）
 * - 裸 `p` → then 臂（p 真值 ⇒ 非 nullish）
 * 守卫变量在该臂内以 $removeNullish 影子重绑（null/undefined 臂剪除），
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
  if (t?.type === "UnaryExpression" && t.operator === "!" && t.argument?.type === "Identifier" && t.argument.name) {
    return { name: t.argument.name, arm: "alt" };
  }
  if (t?.type === "Identifier" && t.name) {
    return { name: t.name, arm: "cons" };
  }
  if (t?.type !== "BinaryExpression") return undefined;
  const op = t.operator;
  if (op !== "===" && op !== "!==" && op !== "==" && op !== "!=") return undefined;
  const l = t.left as { type?: string; name?: string };
  const r = t.right as { type?: string; name?: string };
  if (l?.type === "Identifier" && l.name && isNullishLitNode(r)) {
    return { name: l.name, arm: op === "===" || op === "==" ? "alt" : "cons" };
  }
  if (r?.type === "Identifier" && r.name && isNullishLitNode(l)) {
    return { name: r.name, arm: op === "===" || op === "==" ? "alt" : "cons" };
  }
  return undefined;
}

/** 守卫臂 thunk 的 nullish 剪影包装：`((p) => THUNK)($removeNullish(p))`。
 *  仅当守卫名不在 fork 绑定集（臂内无写/快照重绑）时应用——否则影子参数
 *  会吞掉臂内写，破坏 forkJoin 的绑定 join。 */
export function narrowNullishArmThunk(thunk: string, guard: NullishGuard | undefined, arm: "cons" | "alt", forkBindingNames: ReadonlySet<string> | readonly string[]): string {
  if (!guard || guard.arm !== arm) return thunk;
  const names =
    forkBindingNames instanceof Set ? (forkBindingNames as Set<string>) : new Set(forkBindingNames);
  if (names.has(guard.name)) return thunk;
  return `((${guard.name}) => ${thunk})($removeNullish(${guard.name}))`;
}
