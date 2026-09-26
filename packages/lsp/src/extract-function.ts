/**
 * Extract Function（refactor.extract）——纯函数，可测。
 *
 * MVP 语义（对齐 IDE 常用路径，金标钉住）：
 * - 选区 = 连续完整语句，或单个表达式
 * - 自由变量（选区内引用、声明在选区外）→ 形参
 * - 选区内声明且选区外仍使用的变量 → 返回值（MVP 单值）
 * - 新函数插在**当前所在函数之前**（或顶层选区时插在选区语句前）
 * - 选区替换为调用；表达式选区替换为 `name(args)`
 */
import { parse } from "@nudojs/parser";
import type { Node, File, Statement, Expression } from "@babel/types";
import traverseFnDefault from "@babel/traverse";

type Traverse = typeof traverseFnDefault;
function traverse(): Traverse {
  return (typeof traverseFnDefault === "function"
    ? traverseFnDefault
    : (traverseFnDefault as unknown as { default: Traverse }).default) as Traverse;
}

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
  const bBeforeA =
    b.end.line < a.start.line ||
    (b.end.line === a.start.line && b.end.column <= a.start.column);
  return !(aBeforeB || bBeforeA);
}

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !/^(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|function|if|import|in|instanceof|new|return|super|switch|this|throw|try|typeof|var|void|while|with|yield|let|static|enum|await|implements|package|protected|interface|private|public|null|true|false)$/.test(name);
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

type BindingInfo = {
  /** 选区内自由引用（外部绑定） */
  freeReads: string[];
  /** 选区内声明、选区外仍可能读写 */
  capturedWrites: string[];
};

function analyzeSelectionBindings(
  ast: Node,
  selectedNodes: Node[],
  selLoc: { start: { line: number; column: number }; end: { line: number; column: number } },
): BindingInfo {
  const freeReads = new Set<string>();
  const declaredInSel = new Set<string>();
  const writtenInSel = new Set<string>();

  // 先扫选区节点声明
  const visitDecl = (n: Node | null | undefined): void => {
    if (!n) return;
    const node = n as { type: string; name?: string; id?: Node; left?: Node; right?: Node; properties?: Array<{ value?: Node }>; elements?: Array<Node | null>; argument?: Node };
    if (node.type === "Identifier" && node.name) {
      declaredInSel.add(node.name);
      return;
    }
    if (node.type === "ObjectPattern") {
      for (const p of node.properties ?? []) visitDecl(p.value);
      return;
    }
    if (node.type === "ArrayPattern") {
      for (const el of node.elements ?? []) visitDecl(el);
      return;
    }
    if (node.type === "AssignmentPattern") {
      visitDecl(node.left);
      return;
    }
    if (node.type === "RestElement") {
      visitDecl(node.argument);
      return;
    }
  };

  for (const n of selectedNodes) {
    const stmt = n as {
      type: string;
      declarations?: Array<{ id: Node; init?: Node }>;
      id?: Node;
      params?: Node[];
      expression?: Node;
    };
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations ?? []) visitDecl(d.id);
    } else if (stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") {
      visitDecl(stmt.id);
    }
  }

  try {
    traverse()(ast, {
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
        const bLoc = (binding.identifier as Node).loc;
        const declInSel = bLoc && locIntersects(bLoc, selLoc);
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
  const capturedWrites: string[] = [];
  const usedOutside = (name: string): boolean => {
    let hit = false;
    try {
      traverse()(ast, {
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

  for (const w of writtenInSel) {
    if (!declaredInSel.has(w) && isValidIdent(w)) {
      capturedWrites.push(w);
    }
  }
  for (const d of declaredInSel) {
    if (isValidIdent(d) && usedOutside(d) && !capturedWrites.includes(d)) {
      capturedWrites.push(d);
    }
  }

  return {
    freeReads: [...freeReads].filter((n) => isValidIdent(n)).sort(),
    capturedWrites: capturedWrites.filter((n) => isValidIdent(n)).sort(),
  };
}

/**
 * 提取函数。range 为 LSP 0-based。
 * name 缺省 `extracted`。
 */
export function extractFunction(
  source: string,
  range: LspRange,
  options: { name?: string } = {},
): ExtractResult {
  const fnName = options.name && isValidIdent(options.name) ? options.name : "extracted";
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
  const statements: Statement[] = [];
  type FnCtx = {
    node: Node;
    loc: { start: { line: number; column: number }; end: { line: number; column: number } };
    bodyStart: { line: number; column: number };
  };
  let containingFnBox: { fn: FnCtx | null } = { fn: null };
  const exprBox: { node: Expression | null } = { node: null };

  try {
    traverse()(ast, {
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
          containingFnBox.fn = { node: path.node as Node, loc, bodyStart };
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
          } else {
            const cur = exprBox.node.loc!;
            // 更小的赢
            if (locCovers(cur, loc)) exprBox.node = path.node as Expression;
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
          statements.push(path.node as Statement);
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
    const params = bindings.freeReads.filter((p) => !bindings.capturedWrites.includes(p) || true);
    const uniqueParams = [...new Set(bindings.freeReads)];
    const paramList = uniqueParams.join(", ");
    const functionText = `function ${fnName}(${paramList}) {\n  return ${indentBlock(exprSrc, "  ").trimStart()};\n}\n`;
    const callText = `${fnName}(${paramList})`;
    const replaceRange = babelLocToLsp(exprLoc);

    // 插入点：所在函数前，或文件顶
    let insertAt: LspPosition = { line: 0, character: 0 };
    if (containingFnBox.fn) {
      const fnLoc = containingFnBox.fn.loc;
      insertAt = babelLocToLsp({ start: fnLoc.start, end: fnLoc.start }).start;
    }

    // 生成新源码：先插函数，再替换表达式（按偏移从后往前）
    const newText = applyEdits(source, [
      { range: replaceRange, newText: callText },
      { range: { start: insertAt, end: insertAt }, newText: functionText + (insertAt.line === 0 ? "" : "\n") },
    ]);

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
    (a, b) => (a.loc!.start.line - b.loc!.start.line) || (a.loc!.start.column - b.loc!.start.column),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.loc!;
    const cur = sorted[i]!.loc!;
    if (cur.start.line < prev.end.line || (cur.start.line === prev.end.line && cur.start.column < prev.end.column)) {
      return { ok: false, reason: "selection is not a contiguous statement list" };
    }
  }

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const blockLoc = {
    start: first.loc!.start,
    end: last.loc!.end,
  };
  const blockSrc = sliceSource(source, blockLoc);
  const bindings = analyzeSelectionBindings(ast, sorted, sel);

  // 返回值：最后一个语句是 ExpressionStatement 且表达式结果被使用——MVP：
  // - 若最后是 `return`，提取体为原语句（去掉外层 return 逻辑保持）
  // - 若 capturedWrites 非空，返回第一个
  // - 否则 void
  let returns: string | null = null;
  let bodyStatements = blockSrc;
  let callText: string;

  const lastStmt = last as { type: string; argument?: Node | null; expression?: Node };
  const isReturnInSel = lastStmt.type === "ReturnStatement" && sorted.length >= 1 && lastStmt.argument;

  if (bindings.capturedWrites.length > 0) {
    returns = bindings.capturedWrites[0]!;
    bodyStatements = `${blockSrc}\n  return ${returns};`;
    callText = `const ${returns} = ${fnName}(${bindings.freeReads.join(", ")});`;
  } else if (isReturnInSel && sorted.length === 1) {
    // 单条 return → 函数就是它
    bodyStatements = blockSrc;
    returns = "value";
    callText = `return ${fnName}(${bindings.freeReads.join(", ")});`;
  } else {
    callText = `${fnName}(${bindings.freeReads.join(", ")});`;
  }

  const paramList = bindings.freeReads.join(", ");
  const functionText = `function ${fnName}(${paramList}) {\n${indentBlock(bodyStatements, "  ")}\n}\n`;

  let insertAt: LspPosition = { line: 0, character: 0 };
  if (containingFnBox.fn) {
    const fnLoc = containingFnBox.fn.loc;
    insertAt = { line: fnLoc.start.line - 1, character: fnLoc.start.column };
  }

  const replaceRange = babelLocToLsp(blockLoc);
  const newText = applyEdits(source, [
    { range: replaceRange, newText: callText },
    {
      range: { start: insertAt, end: insertAt },
      newText: functionText + (insertAt.line === 0 && !source.startsWith("\n") ? "" : "\n"),
    },
  ]);

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

/** 多 edit 合成新源码（从后往前应用，避免偏移漂移）。 */
export function applyEdits(source: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort(
    (a, b) => posToOffset(source, b.range.start) - posToOffset(source, a.range.start),
  );
  let out = source;
  for (const e of sorted) {
    const start = posToOffset(out, e.range.start);
    const end = posToOffset(out, e.range.end);
    // applyEdits 用原 source 算 offset；对 insertAt 同点多次时后写的先应用
    out = out.slice(0, start) + e.newText + out.slice(end);
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
