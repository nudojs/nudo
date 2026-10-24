/**
 * Extract Function（refactor.extract）——纯函数，可测。
 *
 * MVP 语义（对齐 IDE 常用路径，金标钉住）：
 * - 选区 = 连续完整语句，或单个表达式
 * - 自由变量（选区内引用、声明在选区外）→ 形参
 * - 选区内声明且选区外仍使用的变量 → 返回值（MVP 单值）
 * - 新函数插在**当前所在函数之前**（或顶层选区时插在选区语句前）
 * - 选区替换为调用；表达式选区替换为 `name(args)`
 *
 * 结构约束（族 23 片 C）：
 * - 插入点必须是**语句位置**：用最近祖先的「语句起点」而不是 `function` 关键字列
 *   （Bug 732：`export` 关键字不被新函数认领），也不插进表达式内部
 *   （Bug 736：箭头初始化式 / 对象字面量方法 / class 方法）。
 * - 顶层选区的插入点跳过文件前导区（hashbang / 指令 / 前导注释）（Bug 742）。
 * - 选区含 `break` / `continue` / 非末尾 `return` ⇒ 拒绝（控制流不可搬）（Bug 740）。
 * - 新函数名做**占用检查**：撞名时自动改名（`extracted` → `extracted1`…）（Bug 971）。
 * - 产物必须仍可解析（自检），否则不出 edit。
 */
import { parse } from "@nudojs/parser";
import type { Node, File, Statement, Expression } from "@babel/types";
import { traverseEsm } from "./traverse-esm.ts";

export type LspPosition = { line: number; character: number };
export type LspRange = { start: LspPosition; end: LspPosition };

export type ExtractOk = {
  ok: true;
  functionName: string;
  params: string[];
  returns: string | null;
  /** 整文件新源码 */
  newText: string;
  /** 被替换的选区（LSP 0-based） */
  replaceRange: LspRange;
  /** 插入新函数的 LSP 位置 */
  insertAt: LspPosition;
  /** 新函数源码块 */
  functionText: string;
  /** 调用替换文本 */
  callText: string;
};

export type ExtractFail = { ok: false; reason: string };

export type ExtractResult = ExtractOk | ExtractFail;

function babelLocToLsp(loc: { start: { line: number; column: number }; end: { line: number; column: number } }): LspRange {
  return {
    start: { line: loc.start.line - 1, character: loc.start.column },
    end: { line: loc.end.line - 1, character: loc.end.column },
  };
}

function lspRangeToBabel(range: LspRange): { start: { line: number; column: number }; end: { line: number; column: number } } {
  return {
    start: { line: range.start.line + 1, column: range.start.character },
    end: { line: range.end.line + 1, column: range.end.character },
  };
}

function locCovers(
  outer: { start: { line: number; column: number }; end: { line: number; column: number } },
  inner: { start: { line: number; column: number }; end: { line: number; column: number } },
): boolean {
  const o = outer;
  const i = inner;
  const startsBefore =
    o.start.line < i.start.line ||
    (o.start.line === i.start.line && o.start.column <= i.start.column);
  const endsAfter =
    o.end.line > i.end.line ||
    (o.end.line === i.end.line && o.end.column >= i.end.column);
  return startsBefore && endsAfter;
}

function locIntersects(
  a: { start: { line: number; column: number }; end: { line: number; column: number } },
  b: { start: { line: number; column: number }; end: { line: number; column: number } },
): boolean {
  const aBeforeB =
    a.end.line < b.start.line ||
    (a.end.line === b.start.line && a.end.column <= b.start.column);
  const evalBeforeA =
    b.end.line < a.start.line ||
    (b.end.line === a.start.line && b.end.column <= a.start.column);
  return !(aBeforeB || evalBeforeA);
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !/^(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|let|static|enum|await|implements|package|protected|interface|private|public|null|true|false)$/.test(name);
}

// ---------------------------------------------------------------------------
// 私有内部模块：插入点计算 / 语句切分 / 取名。
// 三块职责都只服务 `extractFunction` 一个导出函数 ⇒ **零新增导出**。
// ---------------------------------------------------------------------------

/** 语句列表宿主：其直接子节点处于「语句位置」，可以在其前面插一条声明。 */
const STATEMENT_LIST_HOSTS = new Set(["Program", "BlockStatement", "SwitchCase", "StaticBlock"]);

/** 最小路径结构：只要 node + parentPath 链 + scope。 */
type AnchorPath = {
  node: Node;
  parentPath: AnchorPath | null;
  scope: ScopeLike;
};

/** 最小作用域结构：只要 bindings + 父作用域链。 */
type ScopeLike = {
  bindings: Record<string, unknown>;
  parent?: ScopeLike | undefined;
};

/**
 * 向上找最近的「语句位置」祖先节点（新函数的插入锚点）。
 *
 * - `export function f(){}` ⇒ ExportNamedDeclaration（起点 = `export` 的列）
 *   ⇒ 新函数插在 `export` **之前**，`export` 关键字不会被新函数认领（Bug 732）。
 * - `export const f = () => {}` / 对象字面量方法 / class 方法 ⇒ 整条声明之前
 *   ⇒ 新函数不会被插进表达式内部（Bug 736）。
 */
function statementAnchor(path: AnchorPath): AnchorPath | null {
  let cur: AnchorPath | null = path;
  while (cur && cur.parentPath) {
    const parentType = cur.parentPath.node.type;
    if (STATEMENT_LIST_HOSTS.has(parentType)) return cur;
    cur = cur.parentPath;
  }
  return null;
}

/** 节点起点（LSP 0-based）；无 loc 时返回 null。 */
function nodeStartPos(node: Node): LspPosition | null {
  const loc = node.loc;
  if (!loc) return null;
  return { line: loc.start.line - 1, character: loc.start.column };
}

/** 名字在给定作用域链上是否已被占用（顶层 function/const/class/import 共用命名空间）。 */
function isNameTaken(scope: ScopeLike | null | undefined, name: string): boolean {
  let cur = scope;
  while (cur) {
    if (cur.bindings[name]) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * 取一个未被占用的新函数名（Bug 971）。
 * 占用检查做在**本体**里 ⇒ 调用方（`server-code-actions.ts`）零改动。
 */
function uniqueFunctionName(base: string, scope: ScopeLike | null | undefined): string {
  if (!isNameTaken(scope, base)) return base;
  for (let i = 1; i <= 999; i++) {
    const candidate = `${base}${i}`;
    if (!isNameTaken(scope, candidate)) return candidate;
  }
  return base;
}

/** 控制流语句类别：`break` / `continue` 在新函数里没有循环/开关可跳 ⇒ 不可搬。 */
function controlFlowKind(stmt: Node): "break" | "continue" | "return" | null {
  const t = stmt.type;
  if (t === "BreakStatement") return "break";
  if (t === "ContinueStatement") return "continue";
  if (t === "ReturnStatement") return "return";
  return null;
}

/**
 * 文件前导区（hashbang / 指令 / 前导注释）之后的第一个合法插入位置。
 * Node 只认**第一行**的 `#!` 为 shebang ⇒ 声明插到它之前会让整个文件不可解析
 * （Bug 742）。
 */
function leadingSafeInsertPos(source: string, ast: File): LspPosition {
  const program = ast.program as unknown as {
    interpreter?: { loc?: { start: { line: number }; end: { line: number } } | null } | null;
    directives?: Array<{ loc?: { start: { line: number }; end: { line: number } } | null }>;
    body?: Array<{ loc?: { start: { line: number } } | null }>;
  };
  // Babel 的 loc.line 是 1-based；`end.line` 正好等于「下一行」的 0-based 行号。
  let line = 0;
  const interpreter = program.interpreter;
  if (interpreter?.loc) line = Math.max(line, interpreter.loc.end.line);
  for (const d of program.directives ?? []) {
    if (d.loc) line = Math.max(line, d.loc.end.line);
  }
  const firstBodyStart = program.body?.[0]?.loc?.start.line ?? Number.MAX_SAFE_INTEGER;
  const comments = (ast as unknown as {
    comments?: Array<{ loc?: { start: { line: number }; end: { line: number } } | null }>;
  }).comments ?? [];
  for (const c of comments) {
    if (!c.loc) continue;
    if (c.loc.start.line < firstBodyStart) line = Math.max(line, c.loc.end.line);
  }
  const maxLine = source.split("\n").length - 1;
  return { line: Math.min(line, maxLine), character: 0 };
}

/** 插入点：锚点节点的起点；没有锚点时退到文件前导区之后（Bug 742）。 */
function resolveInsertAt(anchor: AnchorPath | null, source: string, ast: File): LspPosition {
  if (anchor) {
    const pos = nodeStartPos(anchor.node);
    if (pos) return pos;
  }
  return leadingSafeInsertPos(source, ast);
}

/** 抽取产物必须仍是可解析的源码（自检：坏产物一律不出 edit）。 */
function parsesCleanly(text: string): boolean {
  try {
    parse(text);
    return true;
  } catch {
    return false;
  }
}

/** 打印语句/表达式：用 babel generator 会引入依赖；MVP 用源码切片 + 简单缩进。 */
function sliceSource(source: string, loc: { start: { line: number; column: number }; end: { line: number; column: number } }): string {
  const lines = source.split("\n");
  if (loc.start.line === loc.end.line) {
    return (lines[loc.start.line - 1] ?? "").slice(loc.start.column, loc.end.column);
  }
  const out: string[] = [];
  out.push((lines[loc.start.line - 1] ?? "").slice(loc.start.column));
  for (let ln = loc.start.line; ln < loc.end.line - 1; ln++) {
    out.push(lines[ln] ?? "");
  }
  out.push((lines[loc.end.line - 1] ?? "").slice(0, loc.end.column));
  return out.join("\n");
}

function indentBlock(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? l : pad + l))
    .join("\n");
}

/**
 * 被抽出的「写」：区分**原本是声明**与**原本是赋值**（Bug 734）。
 * - assign：选区内是 `x = …`（对外部变量的赋值）⇒ 调用点必须用**赋值表达式**，
 *   不得引入新的 `const`（会与外层 `let x` 重复声明）。
 * - declare：选区内是 `const/let/var x = …`（声明，且选区外仍被引用）⇒
 *   调用点还原**同种声明**。
 */
type CapturedWrite = {
  name: string;
  kind: "assign" | "declare";
  /** declare 型：原声明关键字（let/const/var） */
  declKind?: "var" | "let" | "const";
};

type BindingInfo = {
  /** 选区内自由引用（外部绑定） */
  freeReads: string[];
  /** 选区内声明、选区外仍可能读写 */
  capturedWrites: CapturedWrite[];
};

function analyzeSelectionBindings(
  ast: Node,
  selectedNodes: Node[],
  selLoc: { start: { line: number; column: number }; end: { line: number; column: number } },
): BindingInfo {
  const freeReads = new Set<string>();
  const declaredInSel = new Set<string>();
  const writtenInSel = new Set<string>();
  /** 选区内声明的名字 → 原声明关键字（调用点还原同种声明） */
  const declKindByName = new Map<string, "var" | "let" | "const">();

  // 先扫选区节点声明
  const visitDecl = (n: Node | null | undefined, kind?: "var" | "let" | "const"): void => {
    if (!n) return;
    const node = n as { type: string; name?: string; id?: Node; left?: Node; right?: Node; properties?: Array<{ value?: Node }>; elements?: Array<Node | null>; argument?: Node };
    if (node.type === "Identifier" && node.name) {
      declaredInSel.add(node.name);
      if (kind) declKindByName.set(node.name, kind);
      return;
    }
    if (node.type === "ObjectPattern") {
      for (const p of node.properties ?? []) visitDecl(p.value, kind);
      return;
    }
    if (node.type === "ArrayPattern") {
      for (const el of node.elements ?? []) visitDecl(el, kind);
      return;
    }
    if (node.type === "AssignmentPattern") {
      visitDecl(node.left, kind);
      return;
    }
    if (node.type === "RestElement") {
      visitDecl(node.argument, kind);
      return;
    }
  };

  for (const n of selectedNodes) {
    const stmt = n as {
      type: string;
      kind?: string;
      declarations?: Array<{ id: Node; init?: Node }>;
      id?: Node;
      params?: Node[];
      expression?: Node;
    };
    if (stmt.type === "VariableDeclaration") {
      const kind =
        stmt.kind === "var" || stmt.kind === "let" || stmt.kind === "const" ? stmt.kind : undefined;
      for (const d of stmt.declarations ?? []) visitDecl(d.id, kind);
    } else if (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") {
      visitDecl(stmt.id);
    }
  }

  try {
    traverseEsm()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc || !locIntersects(loc, selLoc)) return;
        const name = path.node.name;
        // 定义位点
        const parent = path.parent as { type: string; id?: Node; key?: Node; property?: Node; computed?: boolean; left?: Node };
        const isDef =
          (parent.type === "VariableDeclarator" && parent.id === path.node) ||
          (parent.type === "FunctionDeclaration" && parent.id === path.node) ||
          (parent.type === "ClassDeclaration" && parent.id === path.node) ||
          (parent.type === "FunctionDeclaration" && (path.listKey === "params" || path.key === "params")) ||
          (parent.type === "FunctionExpression" && (path.listKey === "params" || path.key === "params")) ||
          (parent.type === "ArrowFunctionExpression" && (path.listKey === "params" || path.key === "params"));
        if (isDef) {
          declaredInSel.add(name);
          return;
        }
        // 属性名跳过
        if (
          (parent.type === "MemberExpression" && parent.property === path.node && parent.computed !== true) ||
          (parent.type === "ObjectProperty" && parent.key === path.node && parent.computed !== true)
        ) {
          return;
        }
        // 赋值写
        if (parent.type === "AssignmentExpression" && parent.left === path.node) {
          writtenInSel.add(name);
          return;
        }
        if (parent.type === "UpdateExpression") {
          writtenInSel.add(name);
          freeReads.add(name);
          return;
        }
        // 绑定解析：声明在选区外 → free
        const binding = path.scope.getBinding(name);
        if (!binding) {
          // 全局 / 未解析（console、Math…）不当形参
          return;
        }
        const evalLoc = (binding.identifier as Node).loc;
        const declInSel = evalLoc && locIntersects(evalLoc, selLoc);
        if (!declInSel) {
          freeReads.add(name);
        }
      },
    });
  } catch {
    /* partial */
  }

  // 选区内声明、选区外仍被引用 → 返回值候选（按声明序，MVP 取第一个）
  // 选区内对外部绑定的赋值写 → 也返回
  const capturedWrites: CapturedWrite[] = [];
  const usedOutside = (name: string): boolean => {
    let hit = false;
    try {
      traverseEsm()(ast, {
        Identifier(p) {
          if (hit) return;
          const loc = p.node.loc;
          if (!loc || locIntersects(loc, selLoc)) return;
          if (p.node.name !== name) return;
          hit = true;
        },
      });
    } catch {
      /* ignore */
    }
    return hit;
  };

  // 赋值写（选区内 `x = …`，x 声明在选区外）⇒ kind = "assign"（Bug 734）
  for (const w of writtenInSel) {
    if (!declaredInSel.has(w) && isValidIdent(w)) {
      capturedWrites.push({ name: w, kind: "assign" });
    }
  }
  // 选区内的声明（且选区外仍被引用）⇒ kind = "declare"
  for (const d of declaredInSel) {
    if (isValidIdent(d) && usedOutside(d) && !capturedWrites.some((c) => c.name === d)) {
      capturedWrites.push({ name: d, kind: "declare", declKind: declKindByName.get(d) });
    }
  }
  capturedWrites.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    freeReads: [...freeReads].filter((n) => isValidIdent(n)).sort(),
    capturedWrites: capturedWrites.filter((c) => isValidIdent(c.name)),
  };
}

/**
 * 提取函数。range 为 LSP 0-based。
 * name 缺省 `extracted`（占用时自动改名为 `extracted1`…）。
 */
export function extractFunction(
  source: string,
  range: LspRange,
  options: { name?: string } = {},
): ExtractResult {
  const requestedName = options.name && isValidIdent(options.name) ? options.name : "extracted";
  let ast: File;
  try {
    ast = parse(source) as File;
  } catch {
    return { ok: false, reason: "parse error" };
  }

  const sel = lspRangeToBabel(range);
  // 空选区拒绝
  if (
    sel.start.line > sel.end.line ||
    (sel.start.line === sel.end.line && sel.start.column >= sel.end.column)
  ) {
    return { ok: false, reason: "empty selection" };
  }

  // 收集与选区相交的顶层/函数体语句
  type SelectedStatement = { node: Statement; path: AnchorPath };
  const statements: SelectedStatement[] = [];
  type FnCtx = {
    node: Node;
    loc: { start: { line: number; column: number }; end: { line: number; column: number } };
    bodyStart: { line: number; column: number };
    /** 插入锚点：所在函数的最近「语句位置」祖先（Bug 732 / 736） */
    anchor: AnchorPath | null;
  };
  let containingFnBox: { fn: FnCtx | null } = { fn: null };
  const exprBox: { node: Expression | null; path: AnchorPath | null } = { node: null, path: null };

  try {
    traverseEsm()(ast, {
      Function(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (!locCovers(loc, sel)) return;
        const body = path.node.body as { loc?: { start: { line: number; column: number } }; type: string };
        const bodyStart =
          body.type === "BlockStatement"
            ? { line: (body as { loc?: { start: { line: number; column: number } } }).loc?.start.line ?? loc.start.line, column: (body as { loc?: { start: { line: number; column: number } } }).loc?.start.column ?? 0 }
            : { line: loc.start.line, column: loc.start.column };
        // 最内层函数
        const prev = containingFnBox.fn;
        if (!prev || loc.start.line > prev.loc.start.line) {
          containingFnBox.fn = {
            node: path.node as Node,
            loc,
            bodyStart,
            anchor: statementAnchor(path as unknown as AnchorPath),
          };
        }
      },
      // 表达式选区：最小 Expression 与选区匹配
      Expression(path) {
        const loc = path.node.loc;
        if (!loc) return;
        const isExprWrapper =
          path.parent?.type === "ExpressionStatement" ||
          path.parent?.type === "ReturnStatement" ||
          path.parent?.type === "VariableDeclarator";
        if (!isExprWrapper) return;
        if (!locIntersects(loc, sel)) return;
        // 覆盖选区的最小表达式（选区 ⊆ expr）
        if (locCovers(loc, sel)) {
          if (!exprBox.node) {
            exprBox.node = path.node as Expression;
            exprBox.path = path as unknown as AnchorPath;
          } else {
            const cur = exprBox.node.loc!;
            // 更小的赢
            if (locCovers(cur, loc)) {
              exprBox.node = path.node as Expression;
              exprBox.path = path as unknown as AnchorPath;
            }
          }
        }
      },
      Statement(path) {
        // 只要函数体/程序体里的语句
        const loc = path.node.loc;
        if (!loc) return;
        if (!locIntersects(loc, sel)) return;
        // 整语句被选区覆盖
        if (locCovers(sel, loc)) {
          statements.push({ node: path.node as Statement, path: path as unknown as AnchorPath });
        }
      },
    });
  } catch {
    return { ok: false, reason: "AST walk failed" };
  }

  // 优先：完整语句序列
  if (statements.length === 0 && exprBox.node) {
    // 表达式提取
    const expr = exprBox.node;
    const exprLoc = expr.loc!;
    const exprSrc = sliceSource(source, exprLoc);
    const bindings = analyzeSelectionBindings(ast, [expr], sel);
    // 表达式自由变量 = freeReads（不含声明）
    const uniqueParams = [...new Set(bindings.freeReads)];

    // 插入点：所在函数之前的**语句位置**（Bug 732：语句起始列，不是 `function`
    // 关键字列 ⇒ `export` 不会被新函数认领；Bug 736：表达式宿主回退到整条声明之前）
    const anchor = containingFnBox.fn?.anchor ?? (exprBox.path ? statementAnchor(exprBox.path) : null);
    const insertAt = resolveInsertAt(anchor, source, ast);
    // 取名：占用检查在本体（Bug 971）⇒ 调用方零改动
    const fnName = uniqueFunctionName(requestedName, anchor?.scope);

    const paramList = uniqueParams.join(", ");
    const functionText = `function ${fnName}(${paramList}) {\n  return ${indentBlock(exprSrc, "  ").trimStart()};\n}\n`;
    const callText = `${fnName}(${paramList})`;
    const replaceRange = babelLocToLsp(exprLoc);

    // 生成新源码：先插函数，再替换表达式（按偏移从后往前）
    const newText = applyEdits(source, [
      { range: replaceRange, newText: callText },
      { range: { start: insertAt, end: insertAt }, newText: functionText + (insertAt.line === 0 ? "" : "\n") },
    ]);

    // 自检：产物必须仍可解析（坏产物一律不出 edit）
    if (!parsesCleanly(newText)) {
      return { ok: false, reason: "extraction would produce an unparsable file" };
    }

    return {
      ok: true,
      functionName: fnName,
      params: uniqueParams,
      returns: "value",
      newText,
      replaceRange,
      insertAt,
      functionText,
      callText,
    };
  }

  if (statements.length === 0) {
    return { ok: false, reason: "selection does not cover complete statements or a single expression" };
  }

  // 语句序列必须连续
  const sorted = [...statements].sort(
    (a, b) =>
      (a.node.loc!.start.line - b.node.loc!.start.line) ||
      (a.node.loc!.start.column - b.node.loc!.start.column),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.node.loc!;
    const cur = sorted[i]!.node.loc!;
    if (cur.start.line < prev.end.line || (cur.start.line === prev.end.line && cur.start.column < prev.end.column)) {
      return { ok: false, reason: "selection is not a contiguous statement list" };
    }
  }

  const first = sorted[0]!.node;
  const last = sorted[sorted.length - 1]!.node;

  // 控制流感知（Bug 740）：`break` / `continue` 在新函数里没有循环/开关可跳 ⇒ 不可搬。
  for (const s of sorted) {
    const kind = controlFlowKind(s.node);
    if (kind === "break" || kind === "continue") {
      return { ok: false, reason: `selection contains a ${kind} statement that cannot be extracted` };
    }
  }
  // `return` 只允许出现在选区**末尾**：否则外层的控制流/返回值被改写。
  const lastStmt = last as { type: string; argument?: Node | null; expression?: Node };
  const returnCount = sorted.filter((s) => (s.node as { type: string }).type === "ReturnStatement").length;
  const isReturnInSel = returnCount > 0;
  if (isReturnInSel && (returnCount > 1 || lastStmt.type !== "ReturnStatement")) {
    return { ok: false, reason: "selection contains a return statement that is not the last statement" };
  }

  const blockLoc = {
    start: first.loc!.start,
    end: last.loc!.end,
  };
  const blockSrc = sliceSource(source, blockLoc);
  const bindings = analyzeSelectionBindings(ast, sorted.map((s) => s.node), sel);

  // 插入点：所在函数之前的**语句位置**（Bug 732 / 736）；顶层选区时插在选区语句前
  // （Bug 742：跳过 hashbang / 指令 / 前导注释）。
  const anchor = containingFnBox.fn?.anchor ?? statementAnchor(sorted[0]!.path);
  const insertAt = resolveInsertAt(anchor, source, ast);
  // 取名：占用检查在本体（Bug 971）⇒ 调用方零改动
  const fnName = uniqueFunctionName(requestedName, anchor?.scope);

  // 返回值：最后一个语句是 ExpressionStatement 且表达式结果被使用——MVP：
  // - 若最后是 `return`，返回值必须**接回调用点**（否则外层返回值被静默丢掉）
  // - 若 capturedWrites 非空，返回第一个
  // - 否则 void
  let returns: string | null = null;
  let bodyStatements = blockSrc;
  let callText: string;

  if (bindings.capturedWrites.length > 0) {
    if (isReturnInSel) {
      // 末尾 return + capturedWrites：调用点既要写回外部变量、又要回传返回值 ⇒ 拒绝
      return { ok: false, reason: "selection combines a trailing return with captured writes" };
    }
    const w = bindings.capturedWrites[0]!;
    returns = w.name;
    bodyStatements = `${blockSrc}\n  return ${w.name};`;
    // 原本是声明 ⇒ 还原同种声明；原本是赋值 ⇒ 用赋值表达式（**不得**引入新的 const，
    // 否则与外层 `let x` 重复声明 ⇒ 文件不再可解析）（Bug 734）。
    callText =
      w.kind === "declare"
        ? `${w.declKind ?? "const"} ${w.name} = ${fnName}(${bindings.freeReads.join(", ")});`
        : `${w.name} = ${fnName}(${bindings.freeReads.join(", ")});`;
  } else if (isReturnInSel) {
    // 末尾是 return ⇒ 函数返回该值，调用点必须接住（Bug 740 第二形态）
    bodyStatements = blockSrc;
    returns = lastStmt.argument ? "value" : null;
    callText = `return ${fnName}(${bindings.freeReads.join(", ")});`;
  } else {
    callText = `${fnName}(${bindings.freeReads.join(", ")});`;
  }

  const paramList = bindings.freeReads.join(", ");
  const functionText = `function ${fnName}(${paramList}) {\n${indentBlock(bodyStatements, "  ")}\n}\n`;

  const replaceRange = babelLocToLsp(blockLoc);
  const newText = applyEdits(source, [
    { range: replaceRange, newText: callText },
    {
      range: { start: insertAt, end: insertAt },
      newText: functionText + (insertAt.line === 0 && !source.startsWith("\n") ? "" : "\n"),
    },
  ]);

  // 自检：产物必须仍可解析（坏产物一律不出 edit）
  if (!parsesCleanly(newText)) {
    return { ok: false, reason: "extraction would produce an unparsable file" };
  }

  return {
    ok: true,
    functionName: fnName,
    params: bindings.freeReads,
    returns,
    newText,
    replaceRange,
    insertAt,
    functionText,
    callText,
  };
}

type TextEdit = { range: LspRange; newText: string };

function posToOffset(source: string, pos: LspPosition): number {
  const lines = source.split("\n");
  let off = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) {
    off += lines[i]!.length + 1;
  }
  return off + pos.character;
}

/** edit 在**原 source** 上的绝对偏移（统一坐标口径，Bug 450）。 */
type OffsetEdit = { start: number; end: number; newText: string };

/**
 * 多 edit 合成新源码（Bug 450）。
 *
 * **坐标口径**：全部 edit 的偏移都在**原 source** 上算好，再**从后往前**
 * （起点倒序）应用到结果串 ⇒ 靠前 edit 的原坐标不会被靠后 edit 改写后的
 * 文本带偏。
 *
 * 改前是「**排序**用原 source、**应用**用已改写的 `out`」——区间嵌套时
 * （插入点落在替换范围内部）后应用的 edit 落点按陈旧坐标漂移 ⇒ 源文件被
 * 搅成垃圾（`"AAAA BBBB CCCC"` + 替换 [5,9) + 插入 @6 ⇒ `"AAAA REPLBBB
 * CCCC"`，插入文本被吞进替换文本里）。
 *
 * **区间嵌套的合成口径**：LSP 规范下「插入点落在替换范围内部」属于**非法
 * 重叠** edit；这里给出**确定性**合成——插入文本并入该替换范围、紧贴
 * 替换文本**之前**（插入内容不丢、源码不被搅乱；`"AAAA INSREPL CCCC"`）。
 *
 * **替换范围之间真的重叠**（部分重叠 / 交叉）无法确定性合成 ⇒ 抛
 * `RangeError`（fail-closed：调用方 `server-code-actions.ts` 的
 * `refactor.extract` 是 best-effort，抛错即「不出 action」）。
 */
export function applyEdits(source: string, edits: TextEdit[]): string {
  const prepared: OffsetEdit[] = edits.map((e) => ({
    start: posToOffset(source, e.range.start),
    end: posToOffset(source, e.range.end),
    newText: e.newText,
  }));
  const replacements = prepared.filter((e) => e.end > e.start);
  const insertions = prepared.filter((e) => e.end === e.start);

  // 1) 区间嵌套消解：插入点落在某个替换范围 [s,e) 内（含 s）⇒ 并入该范围。
  //    插入文本按偏移升序**前置**到替换文本之前（⇒ 同起点时也是「替换之前」，
  //    与改前的既有口径一致）。
  const prefixByRange = new Map<OffsetEdit, string>();
  const absorbed = new Set<OffsetEdit>();
  for (const ins of [...insertions].sort((a, b) => a.start - b.start)) {
    // 命中最内层（起点最靠后）的那个替换范围
    let host: OffsetEdit | null = null;
    for (const r of replacements) {
      if (r.start <= ins.start && ins.start < r.end) {
        if (!host || r.start > host.start) host = r;
      }
    }
    if (!host) continue;
    prefixByRange.set(host, (prefixByRange.get(host) ?? "") + ins.newText);
    absorbed.add(ins);
  }
  for (const r of replacements) {
    const prefix = prefixByRange.get(r);
    if (prefix) r.newText = prefix + r.newText;
  }

  // 2) 替换范围之间重叠（部分重叠 / 交叉）⇒ 无法确定性合成 ⇒ fail-closed。
  for (let i = 0; i < replacements.length; i++) {
    for (let j = i + 1; j < replacements.length; j++) {
      const a = replacements[i]!;
      const b = replacements[j]!;
      if (Math.max(a.start, b.start) < Math.min(a.end, b.end)) {
        throw new RangeError(
          `applyEdits: overlapping edit ranges [${a.start},${a.end}) and [${b.start},${b.end})`,
        );
      }
    }
  }

  // 3) 从后往前应用（起点倒序；同起点时先应用范围更大的那个）。
  //    偏移全部来自**原 source** ⇒ 靠前的 edit 落点不会被前面的改写带偏。
  const rest = [...replacements, ...insertions.filter((e) => !absorbed.has(e))];
  rest.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  for (const e of rest) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }
  return out;
}

/**
 * 把 extract 结果转成 LSP WorkspaceEdit.changes 单文件替换
 * （整文件 replace，最稳）。
 */
export function extractToWorkspaceEdit(
  source: string,
  range: LspRange,
  options: { name?: string } = {},
): { ok: true; title: string; newText: string; functionName: string } | ExtractFail {
  const r = extractFunction(source, range, options);
  if (!r.ok) return r;
  return {
    ok: true,
    title: `Extract to function '${r.functionName}'`,
    newText: r.newText,
    functionName: r.functionName,
  };
}

export function fullDocumentRange(source: string): LspRange {
  const lines = source.split("\n");
  const last = lines[lines.length - 1] ?? "";
  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: last.length },
  };
}
