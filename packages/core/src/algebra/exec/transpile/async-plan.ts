/**
 * async 体的**挂起可行性**判定（Bug 201）。
 *
 * 背景：async 体的真挂起靠**宿主生成器**（`function*(){…}` + `await` 发射
 * `yield`）实现 ⇒ `yield` 必须落在**生成器体内联位置**。引擎的分支/循环
 * 体是**宿主 thunk**（`() => {…}`）——`yield` 落在 thunk 里是 SyntaxError
 * ⇒ 整模块编译失败（fail-closed unknown）。
 *
 * 本模块按转译侧的结构把 async 体里的每个 `await` 定位到两个级别之一：
 * - **gen**（生成器级）：语句/表达式**内联**在生成器体里 ⇒ 可发射 `yield`；
 * - **thunk**（宿主 thunk 级）：落在分支臂 / 循环体 / switch 臂 / 短路表达式
 *   右臂里 ⇒ **不可**发射 `yield`。
 *
 * 判定口径与转译侧一一对应（**保守**：判不准就判 thunk）：
 * - `if` 的**测试**内联 ⇒ gen；**臂**是 thunk ⇒ thunk。
 * - 循环的 test/init/update 内联 ⇒ gen；**体**是 thunk ⇒ thunk。
 * - `switch` 的判别式内联 ⇒ gen；**臂**是 thunk ⇒ thunk。
 * - `try` 的块 / catch 体 / finally 体**内联** ⇒ gen。
 * - 嵌套块 `{ … }` 内联 ⇒ gen。
 * - `&&` / `||` / `??` 的**左**内联 ⇒ gen；**右**是 fork 臂 ⇒ thunk。
 * - `?:` 的**测试**内联 ⇒ gen；**两臂**是 fork 臂 ⇒ thunk。
 * - 嵌套函数 / 方法 / 类体 = **独立边界**（各自的 async 体各自判定）。
 *
 * 产出：
 * - `hasAwait`：体内是否有 await（决定走生成器路径还是既有同步路径）；
 * - `allSafe`：所有 await 是否都在 gen 级（决定生成器路径是否**整体**可用）；
 * - `forAwaitGates`：需要在**生成器级**发挂起门的 `for await` 语句节点
 *   （按节点身份判定——只有 gen 级的 for await 才能发门）。
 */
import type { Node } from "@babel/types";

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
  /** 需在生成器级发挂起门的 `for await` 语句（键 = 源偏移量字符串） */
  forAwaitGates: Set<string>;
};

const EMPTY_PLAN = (): AsyncBodyPlan => ({
  hasAwait: false,
  allSafe: true,
  forAwaitGates: new Set<string>(),
});

/**
 * async 体的挂起可行性判定。
 *
 * @param body async 体的 AST（块体 / 表达式体皆可）
 */
export function asyncBodyPlan(body: Node | null | undefined): AsyncBodyPlan {
  const plan = EMPTY_PLAN();
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
    for (const s of stmts) scanStmt(s, level);
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
        if (f.test) scanExpr(f.test, level);
        if (f.update) scanExpr(f.update, level);
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
        scanExpr(w.test, level);
        scanStmt(w.body, "thunk");
        return;
      }
      case "DoWhileStatement": {
        const d = s as unknown as { body?: Node; test?: Node };
        scanStmt(d.body, "thunk");
        scanExpr(d.test, level);
        return;
      }
      case "SwitchStatement": {
        const sw = s as unknown as {
          discriminant?: Node;
          cases?: Array<{ test?: Node | null; consequent?: Node[] }>;
        };
        scanExpr(sw.discriminant, level);
        for (const c of sw.cases ?? []) {
          if (c.test) scanExpr(c.test, level);
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
