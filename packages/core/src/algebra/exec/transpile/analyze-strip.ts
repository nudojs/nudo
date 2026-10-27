/**
 * analyze 模式（`TranspileOptions.mode === "analyze"`）的**顶层效应语句剥离**。
 *
 * 历史：run.ts 先在 `transpileModule` 拿到产物，再 Babel 解析产物、按生成
 * 语句整条切除（stripEffectfulTopLevel）。结构化切除已修掉行级正则的三类
 * 语义破坏，但仍要付一次生成码解析，且判定面与源形态隔了一层——发射器是否
 * 把 `if` 包进 block（快照/join 需要）会改变生成语句的顶层类型，剥除结论
 * 因此不稳定。现在剥离在**发射期**完成：`transpileFile` 的语句循环按源 AST
 * 过滤（见 `analyzeTopLevelStatements`），调用方不再二次解析生成产物。
 *
 * 判定口径与旧生成形态 `isEffectfulTopLevelStmt` / `isEffectfulTopLevelExpr`
 * 一一对应（**按发射形态等价**，不是按源语句类型一刀切）：
 * - 顶层 `if`：发射形态取决于臂内是否有自由绑定写——有 ⇒ BlockStatement
 *   包装 `$fork`（旧 post-pass 保留整块 ⇒ if 执行）；无 ⇒ 裸 `$fork`
 *   表达式语句（旧 post-pass 整条剥）。判定与 `emitIfStatement` 的
 *   `recvSet` **同源**（`collectForkBindingNames`，同一 helper）。
 * - 剥：顶层 `for` / `while`（发射为顶层 `$for` / `$whileSeq` 调用，旧
 *   post-pass 剥）。`for-in`（`$forOf($forInKeys(...))`）、`for-of`
 *   （`$forOf`）、`do-while`（block 包装的 `$whileSeq`）在旧 post-pass 里
 *   都保留 ⇒ 源口径保留。
 * - 保留：`try` / `switch` / `throw` / 赋值 / 成员调用 / 本地调用 / 声明；
 * - 剥：表达式语句的直接调用 callee 为裸 `fetch` / `setTimeout` /
 *   `setInterval`、未声明标识符（生成形态是 `$callNamed("未知名", …)`）、
 *   未插桩 `$callNamed("X")`（X 未声明）、插桩控制流名 `$for` / `$fork` /
 *   `$whileSeq`；
 * - 保留：簿记调用（`__nudo*`）、`$` 前缀运算符（生成形态的
 *   `$invoke` / `$new` / `$assign` 等——旧谓词按「`$` 前缀 = 保留」）、
 *   成员调用（含 `console.*`：生成形态是 `$invoke(console, …)`，旧谓词
 *   保留）、其它非调用表达式。
 *
 * 已声明集合按源顶层绑定收集（声明 / 解构 / import 本地名）并**并入 var
 * 提升名**——块内 `var` 在发射期被提升为模块顶的 `let <名> = $lit(void 0)`
 * （生成形态下是顶层声明，旧谓词按「已声明」保留其顶层调用）。提升名本身
 * 由 `transpileFile` 从**原始** body 计算，剥离不改变提升行。
 */
import type {
  Expression,
  ExpressionStatement,
  ForStatement,
  Statement,
} from "@babel/types";

import {
  collectForkBindingNames,
  collectPatternNames,
  collectVarHoistNames,
} from "./helpers.ts";

/** 簿记调用（host 发射产物；非副作用，保留——live import 注册剥离会让
 *  analyze 模式丢失绑定刷新）。 */
const BOOKKEEPING_CALLS: ReadonlySet<string> = new Set([
  "__nudoExport",
  "__nudoExportLazy",
  "__nudoExportStar",
  "__nudoRecordBinding",
  "__nudoRecordAssign",
  "__nudoRegisterImportRefresh",
]);

/** 源形态危险全局裸调用（生成形态同样是未声明名的 `$callNamed`）。 */
const DANGEROUS_GLOBAL_CALLS: ReadonlySet<string> = new Set([
  "fetch",
  "setTimeout",
  "setInterval",
]);

/**
 * analyze 模式的发射语句表：源序保留未剥离语句（**对象身份不变**，发射面
 * 与 exec 模式逐字节一致——剥离只减少语句，不重写）。
 *
 * 例外：被剥顶层 `for` 的 **init** 在旧生成形态里位于 `$for` 调用**之前**
 * （旧 post-pass 只切循环调用 ⇒ init 的副作用保留）——`var` 声明与表达式
 * init 按原语句形态就地补发（见 `preservedLoopInitOf`）。
 */
export function analyzeTopLevelStatements(
  body: readonly Statement[],
): Statement[] {
  const declared = collectAnalyzeDeclared(body);
  const out: Statement[] = [];
  for (const stmt of body) {
    if (!shouldStripAnalyzeStatement(stmt, declared)) {
      out.push(stmt);
      continue;
    }
    const init = preservedLoopInitOf(stmt);
    if (init) out.push(init);
  }
  return out;
}

/** 被剥顶层循环中旧生成形态留在 `$for` 之前的 init（无则 null）。 */
function preservedLoopInitOf(stmt: Statement): Statement | null {
  if (stmt.type === "ForStatement") return preservedForInitOf(stmt.init);
  if (stmt.type === "LabeledStatement" && stmt.body.type === "ForStatement") {
    return preservedForInitOf(stmt.body.init);
  }
  return null;
}

function preservedForInitOf(init: ForStatement["init"]): Statement | null {
  if (!init) return null;
  if (init.type === "VariableDeclaration") {
    // 只保留 `var`：var 提升到模块顶（发射形态是赋值 + $recordBinding），
    // 旧 post-pass 保留了这些 init 语句；`let` / `const` 是循环块作用域，
    // 单 init 折进 `$for` 状态参数、多 init 的模块顶声明是发射 quirk——
    // 源口径一律丢弃（不逃出循环）。
    return init.kind === "var" ? init : null;
  }
  // 表达式 init（赋值 / 序列）：旧 fallback 在 `$for` 之前就地求值
  //（副作用写真实绑定）——包成语句复用同一发射路径（位置沿用表达式）。
  return {
    type: "ExpressionStatement",
    expression: init,
    start: init.start ?? null,
    end: init.end ?? null,
    loc: init.loc ?? null,
  } as unknown as ExpressionStatement;
}

/** 源顶层绑定名（声明 / 解构 / import 本地名）＋ var 提升名。 */
function collectAnalyzeDeclared(body: readonly Statement[]): Set<string> {
  const out = new Set<string>();
  for (const stmt of body) addStatementDeclared(stmt, out);
  // 块内 `var` 提升到模块顶（`let <名> = $lit(void 0)`）——生成形态下是
  // 顶层声明，旧谓词因此把同名顶层调用当本地调用保留。保持同口径。
  for (const name of collectVarHoistNames(body)) out.add(name);
  return out;
}

function addStatementDeclared(stmt: Statement, out: Set<string>): void {
  if (stmt.type === "ImportDeclaration") {
    for (const spec of stmt.specifiers) out.add(spec.local.name);
    return;
  }
  const decl =
    stmt.type === "ExportNamedDeclaration" ||
    stmt.type === "ExportDefaultDeclaration"
      ? stmt.declaration
      : stmt;
  if (!decl) return;
  if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
    if (decl.id) out.add(decl.id.name);
    return;
  }
  if (decl.type === "VariableDeclaration") {
    for (const d of decl.declarations) collectPatternNames(d.id, out);
  }
}

function shouldStripAnalyzeStatement(
  stmt: Statement,
  declared: ReadonlySet<string>,
): boolean {
  switch (stmt.type) {
    case "ExpressionStatement":
      return shouldStripAnalyzeExpression(stmt.expression, declared);
    case "ForStatement":
    case "WhileStatement":
      return true;
    case "IfStatement":
      // 与 emitIfStatement 的块包装判据同源：臂内有自由绑定写 ⇒ 生成
      // BlockStatement（旧 post-pass 保留整块）；无 ⇒ 生成裸 `$fork(...)`
      // 表达式语句（旧 post-pass 剥）。
      return (
        collectForkBindingNames(stmt.consequent).length === 0 &&
        collectForkBindingNames(stmt.alternate).length === 0
      );
    case "LabeledStatement":
      // 标签循环在发射期标签并入内层（无包装语句）：`for` / `while` 直接
      // 生成顶层 `$for` / `$whileSeq`（旧谓词剥）；`for-in` / `for-of` →
      // `$forOf` 保留；标签 do-while 走 block 包装，标签块 / 标签 if 也走
      // block 路径 ⇒ 保留。
      return (
        stmt.body.type === "ForStatement" ||
        stmt.body.type === "WhileStatement"
      );
    default:
      return false;
  }
}

function shouldStripAnalyzeExpression(
  expr: Expression,
  declared: ReadonlySet<string>,
): boolean {
  if (expr.type !== "CallExpression") return false;
  const callee = expr.callee;
  // 成员调用（含 console.*）外层不是裸全局名：生成形态是 $invoke / 方法
  // 链调用（旧谓词保留）
  if (callee.type !== "Identifier") return false;
  const name = callee.name;
  // 源形态危险全局：裸 fetch / setTimeout / setInterval
  if (DANGEROUS_GLOBAL_CALLS.has(name)) return true;
  // 未插桩形态的命名调用：`$callNamed("X", …)` 仅当 X 已声明时保留
  if (name === "$callNamed") {
    const first = expr.arguments[0];
    return first?.type === "StringLiteral" && !declared.has(first.value);
  }
  // 插桩控制流（`$while` 前缀匹配 `$whileSeq`；历史名 `$while` 已删除）
  if (name === "$for" || name === "$fork" || name.startsWith("$while")) {
    return true;
  }
  // 簿记调用（__nudo*）与 `$` 前缀运算符保留（旧谓词 `!name.startsWith("$")`
  // 口径：生成形态的 $invoke / $new / $assign 等不是效应剥离对象）
  if (BOOKKEEPING_CALLS.has(name) || name.startsWith("$")) return false;
  // 其它未声明标识符 = 未知全局裸调用（生成形态会落到
  // `$callNamed("未知名", …)` 的同一分支，源形态直接按名判定）
  return !declared.has(name);
}
