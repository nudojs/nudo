/**
 * 语句控制流谓词：break/return/throw/continue 是否终止、else 链补全、
 * 隐式 return。与 nullish / 类型守卫识别解耦，便于单测与拆文件。
 */
import type { Statement, Node } from "@babel/types";
import { indent } from "../helpers.ts";

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
    case "TryStatement":
      return tryCompletesControl(stmt as unknown as TryShape);
    default:
      return false;
  }
}

/** try 语句的最小形态（Babel TryStatement 的结构投影） */
type TryShape = {
  block: Statement;
  handler: { body: Statement } | null;
  finalizer: Statement | null;
};

/** finalizer 内的 break/continue 是否可能跳出 finalizer——取消 try 的
 *  return/throw abrupt completion（原生：finally 里的 break/continue 覆盖
 *  try/catch 的退出，控制流落在 try 语句之后）。无标签信号只跳最近的
 *  循环/switch（迭代深度 >0 时留在 finalizer 体内）；带标签信号仅当标签
 *  未在 finalizer 内声明（祖先标签集之外）时外逃。嵌套函数体不参与
 *  （调用不转移控制权）。 */
function finalizerJumpsOut(node: Node): boolean {
  const LOOP_OR_SWITCH = new Set([
    "ForStatement",
    "ForOfStatement",
    "ForInStatement",
    "WhileStatement",
    "DoWhileStatement",
    "SwitchStatement",
  ]);
  const FN_BODY = new Set([
    "FunctionExpression",
    "ArrowFunctionExpression",
    "FunctionDeclaration",
    "ObjectMethod",
    "ClassMethod",
    "ClassPrivateMethod",
    "StaticBlock",
  ]);
  const walk = (n: unknown, iterDepth: number, labels: ReadonlySet<string>): boolean => {
    if (!n || typeof n !== "object") return false;
    const t = n as Record<string, unknown> & { type?: string };
    if (typeof t.type === "string" && FN_BODY.has(t.type)) return false;
    if (t.type === "BreakStatement" || t.type === "ContinueStatement") {
      const lbl = (t.label as { name?: string } | undefined)?.name;
      return lbl !== undefined ? !labels.has(lbl) : iterDepth === 0;
    }
    let nextIter = iterDepth;
    let nextLabels: ReadonlySet<string> = labels;
    if (t.type === "LabeledStatement") {
      nextLabels = new Set(labels).add((t.label as { name: string }).name);
    }
    if (typeof t.type === "string" && LOOP_OR_SWITCH.has(t.type)) nextIter = iterDepth + 1;
    for (const key of Object.keys(t)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const child = t[key] as unknown;
      if (Array.isArray(child)) {
        for (const c of child) if (walk(c, nextIter, nextLabels)) return true;
      } else if (child && typeof child === "object") {
        if (walk(child, nextIter, nextLabels)) return true;
      }
    }
    return false;
  };
  return walk(node, 0, new Set<string>());
}

/** try 是否绝不正常完成（return/throw/break/continue 任一控制转移）：
 *  - finalizer 自身确定退出 → 覆盖一切出口；
 *  - finalizer 可跳出 → break/continue 取消 try 的退出 → 正常完成；
 *  - 否则 block 与（有 catch 时）handler 体都绝不正常完成才成立。 */
function tryCompletesControl(stmt: TryShape): boolean {
  if (stmt.finalizer) {
    if (stmtCompletesControl(stmt.finalizer)) return true;
    if (finalizerJumpsOut(stmt.finalizer)) return true;
  }
  if (stmt.handler) {
    return (
      stmtCompletesControl(stmt.block) && stmtCompletesControl(stmt.handler.body)
    );
  }
  return stmtCompletesControl(stmt.block);
}

/** 语句或块内是否出现 return/throw（决定 if 是否提升为 return $fork） */
export function stmtReturns(stmt: Statement): boolean {
  if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") return true;
  if (stmt.type === "BlockStatement") return stmt.body.some(stmtReturns);
  if (stmt.type === "IfStatement") {
    return stmtReturns(stmt.consequent) && stmt.alternate != null && stmtReturns(stmt.alternate);
  }
  if (stmt.type === "TryStatement") {
    const t = stmt as unknown as TryShape;
    // finalizer 自身确定 return/throw：一切出口被覆盖，整体终止
    if (t.finalizer && stmtReturns(t.finalizer)) return true;
    // finalizer 可 break/continue 外逃：取消 try/catch 的 return/throw，
    // try 可能正常完成——不得视为终止（提升会丢 fall-through 路径）
    if (t.finalizer && finalizerJumpsOut(t.finalizer)) return false;
    if (t.handler) {
      // block 必终止（return 直出 / throw 入 catch）且 handler 必终止
      return stmtReturns(t.block) && stmtReturns(t.handler.body);
    }
    return stmtReturns(t.block);
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
