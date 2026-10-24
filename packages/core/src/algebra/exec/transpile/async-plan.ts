/**
 * async 体的**挂起可行性**判定（Bug 201）。
 *
 * 背景：async 体的真挂起靠**宿主生成器**（`function*(){…}` + `await` 发射
 * `yield`）实现 ⇒ `yield` 必须落在**生成器体内联位置**。引擎的分支/循环
 * 体是**宿主 thunk**（`() => {…}`）——`yield` 落在 thunk 里是 SyntaxError
 * ⇒ 整模块编译失败（fail-closed unknown ⇒ **L2 闸门假绿**：模块导出全部
 * 丢失 ⇒ 闸门零诊断 ⇒ exit 0）。
 *
 * 本模块按转译侧的结构把 async 体里的每个 `await` 定位到两个级别之一：
 * - **gen**（生成器级）：语句/表达式**内联**在生成器体里 ⇒ 可发射 `yield`；
 * - **thunk**（宿主 thunk 级）：落在分支臂 / 循环体 / 短路表达式右臂 /
 *   **成员调用实参** / **成员赋值右值与计算键** / **循环判别式** /
 *   **switch case 测试** / **早退守卫之后的后续语句** 里 ⇒ **不可**发射 `yield`。
 *
 * ⚠ **本表必须与转译侧逐项对齐**（转译产物里的箭头函数边界）。历史上两者
 * 脱节过一轮（Bug 1139）：`await` 出现在**成员调用实参**、**成员赋值**、
 * **循环判别式**、**case 测试**、**早退守卫之后** 时，转译侧把它们包进宿主
 * thunk，而本表仍判 gen ⇒ `yield` 落进嵌套箭头 ⇒ `new Function` SyntaxError
 * ⇒ **整个模块编译失败** ⇒ 全部导出丢失 ⇒ L2 闸门**假绿**（exit 0）。
 *
 * 判定口径与转译侧一一对应（**保守**：判不准就判 thunk）：
 * - `if` 的**测试**内联 ⇒ gen；**臂**是 thunk ⇒ thunk。
 * - 循环的 **test / update** 是 thunk（`$whileSeq(() => cond, …)` /
 *   `$for(…, () => test, () => update, …)`）；**体**是 thunk ⇒ thunk；
 *   循环 **init** 内联 ⇒ gen；`for-of` / `for-in` 的**右值**内联 ⇒ gen。
 * - `switch` 的判别式内联 ⇒ gen；**case 测试**是 thunk；**臂**是 thunk。
 * - `try` 的块 / catch 体 / finally 体**内联** ⇒ gen。
 * - 嵌套块 `{ … }` 内联 ⇒ gen。
 * - `&&` / `||` / `??` 的**左**内联 ⇒ gen；**右**是 fork 臂 ⇒ thunk。
 * - `?:` 的**测试**内联 ⇒ gen；**两臂**是 fork 臂 ⇒ thunk。
 * - **成员调用**（`o.m(x)`）的**实参**是 thunk（成员读先于实参求值 ⇒ 实参
 *   被推迟到 `$invoke` 内部的 thunk 里）；**标识符调用**（`k(x)`）的实参
 *   内联在数组字面量里 ⇒ gen。
 * - **成员赋值**（`o.x = v` / `o[k] = v` / `o.x += v`）的**接收者、计算键、
 *   右值**全在 member-path 的 IIFE **体**内 ⇒ thunk；**标识符赋值**
 *   （`x = v` / `x += v`）的右值在 IIFE **实参**位 ⇒ 内联 ⇒ gen。
 * - **逻辑赋值**（`x ||= v` / `x &&= v` / `x ??= v`）的右值在 `$fork` 臂 ⇒ thunk。
 * - **成员自增/自减**（`o[k]++`）的接收者与计算键在 IIFE 体 ⇒ thunk。
 * - **早退守卫**（无 else 的 `if` + consequent 确定 return/throw）之后的
 *   **同块后续语句**被搬进 `$fork` 的 alt 臂（宿主 thunk）⇒ thunk。
 * - 嵌套函数 / 方法 / 类体 = **独立边界**（各自的 async 体各自判定）。
 *
 * 产出：
 * - `hasAwait`：体内是否有 await（决定走生成器路径还是既有同步路径）；
 * - `allSafe`：所有 await 是否都在 gen 级（决定生成器路径是否**整体**可用）；
 * - `forAwaitGates`：需要在**生成器级**发挂起门的 `for await` 语句节点
 *   （按节点身份判定——只有 gen 级的 for await 才能发门）。
 */
import type { Node } from "@babel/types";
import { stmtReturns } from "./stmt-predicates.ts";

/** 嵌套函数/方法/类体 = 独立边界（不下沉） */
const FUNC_LIKE = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "ClassProperty",
  "ClassPrivateProperty",
  "StaticBlock",
]);

/** 位置级别：gen = 生成器体内联；thunk = 宿主 thunk（不可发 yield） */
type Level = "gen" | "thunk";

export type AsyncBodyPlan = {
  /** 体内（含嵌套边界之外）是否有 await */
  hasAwait: boolean;
  /** 所有 await 是否都在 gen 级（生成器路径可整体启用） */
  allSafe: boolean;
  /** 需在**生成器级**发挂起门的 `for await` 语句（键 = 源偏移量字符串） */
  forAwaitGates: Set<string>;
};

const EMPTY_PLAN = (): AsyncBodyPlan => ({
  hasAwait: false,
  allSafe: true,
  forAwaitGates: new Set(),
});

/** 成员表达式（可选链同款） */
function isMemberLike(n: Node | null | undefined): boolean {
  return n?.type === "MemberExpression" || n?.type === "OptionalMemberExpression";
}

/**
 * 早退/早抛守卫（与转译侧 `fn-body.ts` 的「早退提升」路径同口径）：
 * 无 else 的 `if` + consequent 确定 return/throw ⇒ 触发提升 ⇒ 其**后续语句**
 * 被搬进 `$fork` 的 alt 臂（宿主 thunk）。
 *
 * 复用转译侧的 `stmtReturns`（**单一事实源**）——本表与转译侧脱节过一次。
 */
function isEarlyGuard(s: Node): boolean {
  if (s.type !== "IfStatement") return false;
  const i = s as unknown as { alternate?: Node | null; consequent?: Node };
  if (i.alternate != null) return false;
  if (i.consequent == null) return false;
  return stmtReturns(i.consequent as Parameters<typeof stmtReturns>[0]);
}

/**
 * async 体的挂起可行性判定。
 *
 * @param body async 体的 AST（块体 / 表达式体皆可）
 * @param disableAsyncGen **安全网**：强制关闭生成器路径（`$async` 同步路径）。
 *   用于「生成器模式编译失败时重试」——`await` 的位置表与转译侧一旦脱节，
 *   `yield` 会落进嵌套箭头 ⇒ `new Function` SyntaxError ⇒ **整个模块**编译
 *   失败 ⇒ 全部导出丢失 ⇒ L2 闸门**假绿**（exit 0）。重试关闭生成器路径后
 *   `await` 退化为 `$await`（同步近似）⇒ 模块至少**编译得出来** ⇒ 导出可见
 *   ⇒ 闸门照常判定（宁可少精确，不可整模块消失）。
 */
export function asyncBodyPlan(
  body: Node | null | undefined,
  disableAsyncGen = false,
): AsyncBodyPlan {
  const plan = EMPTY_PLAN();
  if (disableAsyncGen) plan.allSafe = false;
  if (!body) return plan;
  const seen = new Set<Node>();

  /** 表达式子树扫描：记 await 位置；短路/三元的右臂降级到 thunk */
  const scanExpr = (n: Node | null | undefined, level: Level): void => {
    if (!n || typeof n !== "object") return;
    if (FUNC_LIKE.has(n.type)) return; // 嵌套边界
    if (n.type === "AwaitExpression") {
      plan.hasAwait = true;
      if (level !== "gen") plan.allSafe = false;
      return;
    }
    if (n.type === "LogicalExpression") {
      const l = n as unknown as { left?: Node; right?: Node };
      scanExpr(l.left, level);
      scanExpr(l.right, "thunk");
      return;
    }
    if (n.type === "ConditionalExpression") {
      const c = n as unknown as { test?: Node; consequent?: Node; alternate?: Node };
      scanExpr(c.test, level);
      scanExpr(c.consequent, "thunk");
      scanExpr(c.alternate, "thunk");
      return;
    }
    // Bug 1139：**调用**——成员调用的实参被包进宿主 thunk（Bug 152：成员读
    // 先于实参求值 ⇒ 实参推迟到 `$invoke` 内部的 `() => [args]` 里）⇒ 实参
    // 里的 await 会落进嵌套箭头 ⇒ yield 是语法错误。
    // 标识符调用走 `$callNamed(name, ref, [args])`——实参内联在数组字面量里
    // ⇒ 仍是 gen 级（Bug 201 的 `k(await g())` 走这条，不得降级）。
    if (n.type === "CallExpression" || n.type === "OptionalCallExpression") {
      const c = n as unknown as { callee?: Node; arguments?: Node[] };
      scanExpr(c.callee, level);
      const argLevel: Level = isMemberLike(c.callee) ? "thunk" : level;
      for (const a of c.arguments ?? []) scanExpr(a, argLevel);
      return;
    }
    // Bug 1139：**赋值**——成员赋值的接收者 / 计算键 / 右值全在 member-path
    // 的 IIFE **体**内 ⇒ thunk；标识符赋值的右值在 IIFE **实参**位 ⇒ gen。
    // 逻辑赋值（`||=` / `&&=` / `??=`）的右值在 `$fork` 臂 ⇒ thunk。
    if (n.type === "AssignmentExpression") {
      const a = n as unknown as { left?: Node; right?: Node; operator?: string };
      const logicalOp =
        a.operator === "||=" || a.operator === "&&=" || a.operator === "??=";
      if (isMemberLike(a.left)) {
        // 整个成员赋值（接收者 + 计算键 + 右值）都在 IIFE 体 ⇒ thunk
        scanExpr(a.left, "thunk");
        scanExpr(a.right, "thunk");
        return;
      }
      scanExpr(a.left, level);
      scanExpr(a.right, logicalOp ? "thunk" : level);
      return;
    }
    // Bug 1139：**自增/自减**——成员目标走 member-path 的读改写 IIFE ⇒
    // 接收者与计算键在 IIFE 体 ⇒ thunk（`o[await k]++` 曾整模块编译失败）。
    if (n.type === "UpdateExpression") {
      const u = n as unknown as { argument?: Node };
      if (isMemberLike(u.argument)) {
        scanExpr(u.argument, "thunk");
        return;
      }
      scanExpr(u.argument, level);
      return;
    }
    if (n.type === "ClassExpression") {
      // 类体另行编译——保守判不可用
      plan.allSafe = false;
      return;
    }
    if (seen.has(n)) return;
    seen.add(n);
    for (const [k, v] of Object.entries(n)) {
      if (
        k === "loc" ||
        k === "start" ||
        k === "end" ||
        k === "leadingComments" ||
        k === "trailingComments"
      ) {
        continue;
      }
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            scanExpr(item as Node, level);
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        scanExpr(v as Node, level);
      }
    }
  };

  const scanStmts = (stmts: Node[] | null | undefined, level: Level): void => {
    if (!stmts) return;
    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i]!;
      scanStmt(s, level);
      // Bug 1139：**早退守卫之后的后续语句**——转译侧把它们搬进 `$fork` 的
      // alt 臂（宿主 thunk）⇒ 其中的 await 落进嵌套箭头 ⇒ yield 语法错误。
      // ⇒ 同块的后续语句整段降级为 thunk 级。
      if (isEarlyGuard(s) && i + 1 < stmts.length) {
        scanStmts(stmts.slice(i + 1), "thunk");
        return;
      }
    }
  };

  const scanStmt = (s: Node | null | undefined, level: Level): void => {
    if (!s || typeof s !== "object") return;
    if (FUNC_LIKE.has(s.type)) return; // 嵌套边界
    switch (s.type) {
      case "BlockStatement": {
        scanStmts((s as unknown as { body?: Node[] }).body, level);
        return;
      }
      case "TryStatement": {
        const t = s as unknown as {
          block?: Node;
          handler?: { body?: Node } | null;
          finalizer?: Node | null;
        };
        scanStmt(t.block, level);
        if (t.handler) scanStmt(t.handler.body, level);
        if (t.finalizer) scanStmt(t.finalizer, level);
        return;
      }
      case "IfStatement": {
        const i = s as unknown as { test?: Node; consequent?: Node; alternate?: Node | null };
        scanExpr(i.test, level);
        scanStmt(i.consequent, "thunk");
        if (i.alternate) scanStmt(i.alternate, "thunk");
        return;
      }
      case "ForStatement": {
        const f = s as unknown as {
          init?: Node | null;
          test?: Node | null;
          update?: Node | null;
          body?: Node;
        };
        if (f.init) scanStmt(f.init, level);
        // Bug 1139：判别式与步进式都是宿主 thunk（`$for(…, () => test,
        // () => update, …)`）⇒ thunk 级。
        if (f.test) scanExpr(f.test, "thunk");
        if (f.update) scanExpr(f.update, "thunk");
        scanStmt(f.body, "thunk");
        return;
      }
      case "ForOfStatement":
      case "ForInStatement": {
        const f = s as unknown as {
          left?: Node;
          right?: Node;
          body?: Node;
          await?: boolean;
        };
        if (f.await === true) {
          // for await：原生每轮一个 await；引擎既有建模是同步驱动 ⇒
          // 生成器级发**整循环一个**挂起门（口径偏差，已登记）。
          //
          // for await 本身即**挂起点**（体内无 await 表达式时也须走生成器
          // 路径——否则循环在调用点同步跑完，原生在微任务里跑）。
          plan.hasAwait = true;
          if (level === "gen") {
            // 键 = 源偏移量（转译侧浅拷贝语句 ⇒ 节点身份不稳定）
            if (typeof s.start === "number") plan.forAwaitGates.add(String(s.start));
          } else {
            plan.allSafe = false;
          }
        }
        scanStmt(f.left, level);
        scanExpr(f.right, level);
        scanStmt(f.body, "thunk");
        return;
      }
      case "WhileStatement": {
        const w = s as unknown as { test?: Node; body?: Node };
        // Bug 1139：判别式是 thunk（`$whileSeq(() => cond, () => body)`）
        scanExpr(w.test, "thunk");
        scanStmt(w.body, "thunk");
        return;
      }
      case "DoWhileStatement": {
        const d = s as unknown as { body?: Node; test?: Node };
        scanStmt(d.body, "thunk");
        scanExpr(d.test, "thunk");
        return;
      }
      case "SwitchStatement": {
        const sw = s as unknown as {
          discriminant?: Node;
          cases?: Array<{ test?: Node | null; consequent?: Node[] }>;
        };
        scanExpr(sw.discriminant, level);
        for (const c of sw.cases ?? []) {
          // Bug 1139：case 测试是 thunk（`const __swT = [() => test]`）
          if (c.test) scanExpr(c.test, "thunk");
          scanStmts(c.consequent, "thunk");
        }
        return;
      }
      case "LabeledStatement": {
        scanStmt((s as unknown as { body?: Node }).body, level);
        return;
      }
      case "ExpressionStatement": {
        scanExpr((s as unknown as { expression?: Node }).expression, level);
        return;
      }
      case "VariableDeclaration": {
        for (const d of (s as unknown as { declarations?: Array<{ init?: Node | null }> })
          .declarations ?? []) {
          scanExpr(d.init, level);
        }
        return;
      }
      case "ReturnStatement": {
        scanExpr((s as unknown as { argument?: Node | null }).argument, level);
        return;
      }
      case "ThrowStatement": {
        scanExpr((s as unknown as { argument?: Node }).argument, level);
        return;
      }
      default: {
        // 其余语句：只扫表达式子节点（嵌套语句子节点不在此列）
        for (const [k, v] of Object.entries(s)) {
          if (
            k === "loc" ||
            k === "start" ||
            k === "end" ||
            k === "leadingComments" ||
            k === "trailingComments"
          ) {
            continue;
          }
          if (
            k === "body" ||
            k === "consequent" ||
            k === "alternate" ||
            k === "block" ||
            k === "finalizer" ||
            k === "handler"
          ) {
            continue;
          }
          if (Array.isArray(v)) {
            for (const item of v) {
              if (item && typeof item === "object" && "type" in (item as object)) {
                scanExpr(item as Node, level);
              }
            }
          } else if (v && typeof v === "object" && "type" in (v as object)) {
            scanExpr(v as Node, level);
          }
        }
        return;
      }
    }
  };

  if (body.type === "BlockStatement") {
    scanStmts((body as unknown as { body?: Node[] }).body, "gen");
  } else {
    scanExpr(body, "gen");
  }
  return plan;
}
