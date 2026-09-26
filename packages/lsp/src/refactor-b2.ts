/**
 * B2 — refactor.inline（内联纯局部绑定）+ refactor.changeSignature
 * （参数改可选 = 默认 undefined）。纯函数，金标可测。
 */
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";
import traverse from "@babel/traverse";

function traverseFn(): typeof traverse {
  return (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
}

export type TextEdit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

function locRange(node: Node): TextEdit["range"] | null {
  if (!node.loc) return null;
  return {
    start: { line: node.loc.start.line - 1, character: node.loc.start.column },
    end: { line: node.loc.end.line - 1, character: node.loc.end.column },
  };
}

/** 纯表达式：内联不重复副作用 */
function isPureExpr(node: Node): boolean {
  const t = node.type;
  if (
    t === "Identifier" ||
    t === "StringLiteral" ||
    t === "NumericLiteral" ||
    t === "BooleanLiteral" ||
    t === "NullLiteral"
  ) {
    return true;
  }
  if (t === "MemberExpression") {
    const m = node as unknown as { object: Node; property: Node; computed?: boolean };
    return isPureExpr(m.object) && (m.computed !== true || isPureExpr(m.property));
  }
  if (t === "BinaryExpression" || t === "LogicalExpression") {
    const b = node as unknown as { left: Node; right: Node };
    return isPureExpr(b.left) && isPureExpr(b.right);
  }
  if (t === "UnaryExpression") {
    const u = node as unknown as { argument: Node; operator: string };
    return u.operator !== "delete" && u.operator !== "throw" && isPureExpr(u.argument);
  }
  return false;
}

/** 原子表达式无需加括号；复合表达式内联时加括号保优先级 */
function needsParens(node: Node): boolean {
  return !(
    node.type === "Identifier" ||
    node.type === "StringLiteral" ||
    node.type === "NumericLiteral" ||
    node.type === "BooleanLiteral" ||
    node.type === "NullLiteral" ||
    node.type === "MemberExpression"
  );
}

/**
 * 内联变量：`const x = <pure>;` 后所有 x 的引用换成 <pure>，并删掉声明。
 * 仅当 init 是纯表达式且至少有一个引用（或 0 引用也可删，title 提示 unused）。
 */
export function inlineVariableAt(
  source: string,
  line: number,
  column: number,
): { title: string; edits: TextEdit[] } | { error: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return { error: "parse error" };
  }
  type Hit = {
    declStart: number;
    declEnd: number;
    name: string;
    initSrc: string;
    initRange: TextEdit["range"];
    declRange: TextEdit["range"];
    refs: Array<{ range: TextEdit["range"]; name: string }>;
  };
  let hit: Hit | null = null;

  try {
    traverseFn()(ast, {
      VariableDeclarator(path) {
        const d = path.node;
        if (d.id.type !== "Identifier" || !d.init) return;
        const declLoc = path.parent?.loc ?? d.loc;
        if (!declLoc) return;
        if (
          declLoc.start.line !== line &&
          d.id.loc?.start.line !== line
        ) {
          return;
        }
        // 光标落在声明标识符或 init 上
        const idLoc = d.id.loc;
        const initLoc = d.init.loc;
        const onId =
          idLoc &&
          idLoc.start.line === line &&
          idLoc.start.column <= column &&
          idLoc.end.column >= column;
        const onInit =
          initLoc &&
          initLoc.start.line === line &&
          initLoc.start.column <= column &&
          initLoc.end.column >= column;
        if (!onId && !onInit) return;
        if (!isPureExpr(d.init)) return;

        const binding = path.scope.getBinding(d.id.name);
        const refs: Hit["refs"] = [];
        for (const r of binding?.referencePaths ?? []) {
          const range = locRange(r.node);
          if (range) refs.push({ range, name: d.id.name });
        }
        if (binding?.constantViolations?.length) return; // 有再赋值不内联

        const declRange = locRange(path.parent as unknown as Node) ?? locRange(d as unknown as Node);
        const initRange = locRange(d.init);
        if (!declRange || !initRange) return;
        const initStart = source.slice(
          (initRange.start.line) * 0, // keep shape
        );
        void initStart;
        // 抽 init 源文
        const absInit = initRange;
        const lines = source.split("\n");
        let initSrc: string;
        if (absInit.start.line === absInit.end.line) {
          const l = lines[absInit.start.line] ?? "";
          initSrc = l.slice(absInit.start.character, absInit.end.character);
        } else {
          const parts: string[] = [];
          for (let i = absInit.start.line; i <= absInit.end.line; i++) {
            const l = lines[i] ?? "";
            if (i === absInit.start.line) parts.push(l.slice(absInit.start.character));
            else if (i === absInit.end.line) parts.push(l.slice(0, absInit.end.character));
            else parts.push(l);
          }
          initSrc = parts.join("\n");
        }

        hit = {
          declStart: declRange.start.line,
          declEnd: declRange.end.line,
          name: d.id.name,
          initSrc: needsParens(d.init) ? `(${initSrc})` : initSrc,
          initRange,
          declRange,
          refs,
        };
        path.stop();
      },
    });
  } catch {
    return { error: "parse error" };
  }

  if (!hit) return null;
  const h = hit as Hit;
  const edits: TextEdit[] = [];
  for (const r of h.refs) {
    edits.push({ range: r.range, newText: h.initSrc });
  }
  // 删掉整条声明语句（含尾随换行）
  const del = { ...h.declRange };
  // 扩到行首/行尾清掉整行
  del.start.character = 0;
  const lines = source.split("\n");
  const declLine = lines[del.end.line] ?? "";
  del.end.character = declLine.length;
  if (del.end.line < lines.length - 1) {
    del.end = { line: del.end.line + 1, character: 0 };
    edits.push({ range: del, newText: "" });
  } else {
    edits.push({ range: del, newText: "" });
  }

  return {
    title:
      h.refs.length === 0
        ? `Remove unused '${h.name}'`
        : `Inline variable '${h.name}' (${h.refs.length} use${h.refs.length === 1 ? "" : "s"})`,
    edits,
  };
}

/**
 * 签名修改：把形参改成可选（`x` → `x = undefined`）。
 * JS 侧调用点不必改；契约侧仍可 refine。
 */
export function makeParamOptionalAt(
  source: string,
  line: number,
  column: number,
): { title: string; edits: TextEdit[] } | { error: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return { error: "parse error" };
  }
  type Hit = { name: string; range: TextEdit["range"] };
  let hit: Hit | null = null;
  try {
    traverseFn()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (loc.start.line !== line || loc.start.column > column || loc.end.column < column) {
          return;
        }
        const parent = path.parent;
        if (!parent) return;
        const isParam =
          (parent.type === "FunctionDeclaration" ||
            parent.type === "FunctionExpression" ||
            parent.type === "ArrowFunctionExpression") &&
          (parent as unknown as { params: Node[] }).params?.includes(path.node);
        if (!isParam) return;
        // 已是 AssignmentPattern 的 left 则已可选
        const gp = (path as unknown as { parentPath?: { node?: Node } }).parentPath?.node;
        if (gp && gp.type === "AssignmentPattern") return;
        const range = locRange(path.node);
        if (!range) return;
        hit = { name: path.node.name, range };
        path.stop();
      },
    });
  } catch {
    return { error: "parse error" };
  }
  if (!hit) return null;
  const h = hit as Hit;
  return {
    title: `Change signature: make '${h.name}' optional`,
    edits: [{ range: h.range, newText: `${h.name} = undefined` }],
  };
}
