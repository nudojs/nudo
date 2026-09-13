/**
 * B 路径静态诊断（AST，不执行）：
 * - unreachable：同块 return/throw 之后的语句
 * - builtin-unknown：未声明的全局调用（非 import / 局部 / $runtime）
 */

import { parseSource } from "@nudojs/core";
import type { File, Node, Statement, Identifier } from "@babel/types";

export type BPathLoc = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

export type BPathUnreachable = { range: BPathLoc };
export type BPathBuiltinUnknown = { name: string; range: BPathLoc };

export type BPathDiagnostics = {
  unreachable: BPathUnreachable[];
  builtinUnknown: BPathBuiltinUnknown[];
};

function locOf(node: Node): BPathLoc | null {
  if (!node.loc) return null;
  return {
    start: { line: node.loc.start.line, column: node.loc.start.column },
    end: { line: node.loc.end.line, column: node.loc.end.column },
  };
}

function isExit(stmt: Statement): boolean {
  return stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement";
}

function walkUnreachable(node: Node, out: BPathUnreachable[]): void {
  const n = node as {
    type: string;
    body?: unknown;
    consequent?: Node;
    alternate?: Node | null | undefined;
    block?: Node;
    handler?: { body?: Node } | null;
    finalizer?: Node | null;
    [k: string]: unknown;
  };

  const checkBlock = (block: unknown) => {
    if (!block) return;
    const body =
      (block as { body?: Statement[] }).body ??
      (Array.isArray(block) ? (block as Statement[]) : null);
    if (!Array.isArray(body)) return;
    for (let i = 0; i < body.length; i++) {
      walkUnreachable(body[i]!, out);
      if (isExit(body[i]!)) {
        for (let j = i + 1; j < body.length; j++) {
          const r = locOf(body[j]!);
          if (r) out.push({ range: r });
        }
        break;
      }
    }
  };

  switch (n.type) {
    case "Program":
    case "BlockStatement":
      checkBlock(n.body);
      break;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      if (n.body) walkUnreachable(n.body as Node, out);
      break;
    case "IfStatement":
      if (n.consequent) walkUnreachable(n.consequent, out);
      if (n.alternate) walkUnreachable(n.alternate, out);
      break;
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      if (n.body) walkUnreachable(n.body as Node, out);
      break;
    case "TryStatement":
      if (n.block) walkUnreachable(n.block as Node, out);
      if (n.handler?.body) walkUnreachable(n.handler.body, out);
      if (n.finalizer) walkUnreachable(n.finalizer as Node, out);
      break;
    case "SwitchStatement":
      for (const c of (n as { cases?: Array<{ consequent?: Statement[] }> }).cases ?? []) {
        checkBlock(c.consequent);
      }
      break;
    case "ExportNamedDeclaration":
    case "ExportDefaultDeclaration": {
      const decl = (n as { declaration?: Node }).declaration;
      if (decl) walkUnreachable(decl, out);
      break;
    }
    default:
      break;
  }
}

/** 文件内声明的名字（函数/类/变量/参数/import） */
function collectDeclared(file: File): Set<string> {
  const names = new Set<string>();
  const addId = (id: Node | null | undefined) => {
    if (!id) return;
    if (id.type === "Identifier") names.add((id as Identifier).name);
    if (id.type === "ObjectPattern") {
      for (const p of (id as { properties: Array<{ value?: Node }> }).properties) {
        addId(p.value);
      }
    }
    if (id.type === "ArrayPattern") {
      for (const el of (id as { elements: Array<Node | null> }).elements) addId(el);
    }
  };
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const o = node as { type?: string; [k: string]: unknown };
    switch (o.type) {
      case "FunctionDeclaration":
      case "ClassDeclaration":
        addId((o as { id?: Node }).id);
        break;
      case "VariableDeclarator":
        addId((o as { id?: Node }).id);
        break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        addId((o as { local?: Node }).local);
        break;
      default:
        break;
    }
    // params
    if (o.params && Array.isArray(o.params)) {
      for (const p of o.params) addId(p as Node);
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = o[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  visit(file);
  return names;
}

/** 已知可接受的全局（不报 builtin-unknown）——不含 WeakRef 等未覆盖 API */
const KNOWN_GLOBALS = new Set([
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Symbol",
  "Math",
  "JSON",
  "Promise",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "RegExp",
  "Date",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "console",
  "undefined",
  "NaN",
  "Infinity",
  "globalThis",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
]);

function isFreeUnknown(
  name: string,
  declared: Set<string>,
  seen: Set<string>,
  known: Set<string>,
): boolean {
  return (
    !declared.has(name) &&
    !known.has(name) &&
    !name.startsWith("$") &&
    !seen.has(name)
  );
}

function walkBuiltinUnknown(
  node: Node,
  declared: Set<string>,
  out: BPathBuiltinUnknown[],
  seen: Set<string>,
  known: Set<string>,
  parentKey?: string,
): void {
  const n = node as {
    type?: string;
    callee?: Node;
    name?: string;
    [k: string]: unknown;
  };
  const flag = (idNode: Node, name: string) => {
    if (!isFreeUnknown(name, declared, seen, known)) return;
    const range = locOf(idNode) ?? locOf(node);
    if (range) {
      out.push({ name, range });
      seen.add(name);
    }
  };

  if (n.type === "CallExpression" && n.callee?.type === "Identifier") {
    flag(n.callee, (n.callee as Identifier).name);
  } else if (
    n.type === "Identifier" &&
    typeof n.name === "string" &&
    parentKey !== "key" &&
    parentKey !== "property" &&
    parentKey !== "local" &&
    parentKey !== "id"
  ) {
    // 裸标识符引用（如 return WeakRef）
    flag(node as Node, n.name);
  }

  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const v = n[key];
    if (Array.isArray(v)) {
      v.forEach((x) => {
        if (x && typeof x === "object" && "type" in (x as object)) {
          walkBuiltinUnknown(x as Node, declared, out, seen, known, key);
        }
      });
    } else if (v && typeof v === "object" && "type" in (v as object)) {
      walkBuiltinUnknown(v as Node, declared, out, seen, known, key);
    }
  }
}

/**
 * 静态收集 B 路径诊断。
 * extraKnown：@nudo:mock / @nudo:env 已覆盖的全局名（B 注入后不再是裸原生
 * 调用，不得误报 builtin-unknown——收集器只吃 AST，看不到指令）。
 */
export function collectBPathDiagnostics(
  source: string,
  extraKnown?: Iterable<string>,
): BPathDiagnostics {
  let file: File;
  try {
    file = parseSource(source);
  } catch {
    return { unreachable: [], builtinUnknown: [] };
  }
  const unreachable: BPathUnreachable[] = [];
  // File → program
  const root = (file as unknown as { type: string; program?: Node }).program ?? file;
  walkUnreachable(root as Node, unreachable);

  const declared = collectDeclared(file);
  const known = new Set(KNOWN_GLOBALS);
  if (extraKnown) {
    for (const n of extraKnown) known.add(n);
  }
  const builtinUnknown: BPathBuiltinUnknown[] = [];
  walkBuiltinUnknown(file, declared, builtinUnknown, new Set(), known);

  return { unreachable, builtinUnknown };
}
