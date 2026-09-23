/**
 * 文档符号 + 跨文件导航（definition / references / rename）。
 * 本文件只做 AST 静态扫描；fs 解析走 service 的相对路径规则。
 */
import type { Node, File } from "@babel/types";
import traverse from "@babel/traverse";
import { parse } from "@nudojs/parser";
import type { SymbolInfo, ReferenceInfo, SymbolTable, SourceLocation } from "@nudojs/service";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sidecarPathOf } from "@nudojs/core";

function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

function traverseFn(): typeof traverse {
  return (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
}

/**
 * 绑定标识符判定：rename/references 只动**绑定**，不动属性名。
 * 金标语义（refactor-gold）：
 * - `obj.x` 非 computed 的 `x` 不是绑定
 * - `{ x: 1 }` 非 shorthand 的 key 不是绑定；`{ x }` shorthand 是绑定
 * - class/object method/property 非 computed 的 key 不是绑定
 * - label 不是绑定
 * - import local 是定义；`import { a as b }` 的 `a`（imported）不是
 * - export `{ a as b }` 的 `b`（exported）不是本地绑定
 */
export function isBindingIdentifier(path: {
  node: Node;
  parent: Node | null;
  parentPath?: unknown;
  key?: string | number | null;
}): boolean {
  const node = path.node as { type: string; name?: string };
  if (node.type !== "Identifier") return false;
  const parent = path.parent as
    | (Node & {
        type: string;
        key?: Node;
        value?: Node;
        property?: Node;
        computed?: boolean;
        shorthand?: boolean;
        local?: Node;
        imported?: Node;
        exported?: Node;
        label?: Node;
      })
    | null;
  if (!parent) return true;

  const isSelf = (n?: Node | null): boolean => n === path.node;

  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      // obj.x — property 非 computed 不是绑定；obj[x] 的 x 是
      if (isSelf(parent.property) && parent.computed !== true) return false;
      return true;
    case "ObjectProperty":
    case "ObjectMethod":
    case "ClassMethod":
    case "ClassProperty":
    case "ClassPrivateProperty":
    case "ClassPrivateMethod":
    case "TSDeclareMethod":
      if (isSelf(parent.key) && parent.computed !== true) {
        // shorthand `{ x }`：key 与 value 同名绑定，可改名
        return parent.type === "ObjectProperty" && parent.shorthand === true;
      }
      return true;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return false;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      // 仅 local 是绑定定义
      return isSelf((parent as { local?: Node }).local);
    case "ExportSpecifier":
      // export { local as exported } — 只有 local 是引用
      return isSelf((parent as { local?: Node }).local);
    case "ExportDefaultDeclaration":
      return true;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      // id / params 在下层作为定义登记；这里放行进 references 由调用方去重
      return true;
    default:
      return true;
  }
}

function registerParam(
  definitions: Map<string, SymbolInfo>,
  param: Node | null | undefined,
  uri: string,
  kind: SymbolInfo["kind"] = "variable",
): void {
  if (!param) return;
  const p = param as {
    type: string;
    name?: string;
    id?: Node;
    left?: Node;
    properties?: Array<{ key?: Node; value?: Node; computed?: boolean; shorthand?: boolean }>;
    elements?: Array<Node | null>;
  };
  if (p.type === "Identifier" && p.name) {
    // 不覆盖已登记的同名顶层定义（遮蔽时保留外层 + 语义上以 scope 绑定为准）
    if (!definitions.has(p.name)) {
      definitions.set(p.name, { name: p.name, kind, loc: locFromNode(param), uri });
    }
  } else if (p.type === "AssignmentPattern") {
    registerParam(definitions, p.left, uri, kind);
  } else if (p.type === "RestElement") {
    registerParam(definitions, (p as { argument?: Node }).argument, uri, kind);
  } else if (p.type === "ObjectPattern") {
    for (const prop of p.properties ?? []) {
      registerParam(definitions, prop.value ?? prop.key, uri, kind);
    }
  } else if (p.type === "ArrayPattern") {
    for (const el of p.elements ?? []) {
      registerParam(definitions, el, uri, kind);
    }
  }
}

export function buildSymbolTable(ast: Node, uri: string): SymbolTable {
  const definitions = new Map<string, SymbolInfo>();
  const references: ReferenceInfo[] = [];

  try {
    traverseFn()(ast, {
      FunctionDeclaration(path) {
        if (path.node.id) {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "function",
            loc: locFromNode(path.node.id),
            uri,
          });
        }
        for (const param of path.node.params ?? []) registerParam(definitions, param, uri);
      },
      FunctionExpression(path) {
        if (path.node.id) {
          if (!definitions.has(path.node.id.name)) {
            definitions.set(path.node.id.name, {
              name: path.node.id.name,
              kind: "function",
              loc: locFromNode(path.node.id),
              uri,
            });
          }
        }
        for (const param of path.node.params ?? []) registerParam(definitions, param, uri);
      },
      ArrowFunctionExpression(path) {
        for (const param of path.node.params ?? []) registerParam(definitions, param, uri);
      },
      VariableDeclarator(path) {
        if (path.node.id.type === "Identifier") {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "variable",
            loc: locFromNode(path.node.id),
            uri,
          });
        } else {
          registerParam(definitions, path.node.id, uri);
        }
      },
      ClassDeclaration(path) {
        if (path.node.id) {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "class",
            loc: locFromNode(path.node.id),
            uri,
          });
        }
      },
      ClassExpression(path) {
        if (path.node.id && !definitions.has(path.node.id.name)) {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "class",
            loc: locFromNode(path.node.id),
            uri,
          });
        }
      },
      ImportDeclaration(path) {
        for (const spec of path.node.specifiers ?? []) {
          definitions.set(spec.local.name, {
            name: spec.local.name,
            kind: "variable",
            loc: locFromNode(spec.local),
            uri,
          });
        }
      },
      Identifier(path) {
        // 定义位点不进 references（decl 由 resolveReferences/includeDeclaration 负责）
        if (path.parentPath?.node.type === "FunctionDeclaration" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "FunctionExpression" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "VariableDeclarator" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "ClassDeclaration" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "ClassExpression" && path.parentPath.node.id === path.node) return;

        if (!isBindingIdentifier(path)) return;

        references.push({
          name: path.node.name,
          loc: locFromNode(path.node),
          uri,
        });
      },
    });
  } catch {
    // traverse may fail on partial ASTs
  }

  return { definitions, references };
}

/**
 * 作用域感知的同绑定引用（重构金标核心）：
 * 从 (line, column) 处的标识符解析 babel binding，只收集**同一绑定**的
 * 引用与声明。属性名/成员属性/遮蔽的同名绑定不会被带入。
 */
export function collectBindingReferences(
  ast: Node,
  name: string,
  at: { line: number; column: number },
  uri: string,
): ReferenceInfo[] {
  const out: ReferenceInfo[] = [];
  const seen = new Set<string>();
  const push = (node: Node): void => {
    const loc = locFromNode(node);
    const key = `${loc.start.line}:${loc.start.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, loc, uri });
  };

  try {
    traverseFn()(ast, {
      Program(path) {
        // 定位触点 → binding
        let target: { node: Node; scope: { getBinding(n: string): { identifier: Node; referencePaths: unknown[] } | undefined } } | null =
          null;
        path.traverse({
          Identifier(p) {
            const loc = p.node.loc;
            if (!loc) return;
            if (
              loc.start.line === at.line &&
              loc.start.column <= at.column &&
              loc.end.column >= at.column &&
              p.node.name === name
            ) {
              if (isBindingIdentifier(p)) {
                target = { node: p.node, scope: p.scope };
              }
              p.stop();
            }
          },
        });
        if (!target) {
          path.stop();
          return;
        }
        const binding = (target as { scope: { getBinding(n: string): { identifier: Node; referencePaths: unknown[] } | undefined } })
          .scope.getBinding(name);
        if (!binding) {
          // 未解析绑定（global / 部分语法）：退回名称匹配但已过滤属性键
          path.traverse({
            Identifier(p) {
              if (p.node.name === name && isBindingIdentifier(p)) push(p.node);
            },
          });
          path.stop();
          return;
        }
        push(binding.identifier);
        for (const ref of binding.referencePaths as Array<{ node: Node }>) {
          if (ref?.node) push(ref.node);
        }
        // assignment / constant violation 也改名
        const pv = binding as unknown as {
          constantViolations?: Array<{ node: Node }>;
        };
        for (const v of pv.constantViolations ?? []) {
          if (v?.node?.type === "Identifier") push(v.node);
          else if (v?.node) {
            // AssignmentExpression left
            const left = (v.node as { left?: Node }).left;
            if (left?.type === "Identifier") push(left);
          }
        }
        path.stop();
      },
    });
  } catch {
    /* partial AST */
  }
  return out;
}

/** prepareRename：仅绑定标识符可改名（属性键/成员属性拒绝）。 */
export function renameTargetAt(
  source: string,
  line: number,
  column: number,
): { name: string; loc: SourceLocation } | { error: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return { error: "parse error" };
  }
  let hit: { name: string; loc: SourceLocation; ok: boolean } | null = null;
  try {
    traverseFn()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === line &&
          loc.start.column <= column &&
          loc.end.column >= column
        ) {
          hit = {
            name: path.node.name,
            loc: locFromNode(path.node),
            ok: isBindingIdentifier(path),
          };
          path.stop();
        }
      },
    });
  } catch {
    return { error: "parse error" };
  }
  if (!hit) return null;
  const h = hit as { name: string; loc: SourceLocation; ok: boolean };
  if (!h.ok) {
    return { error: `cannot rename '${h.name}' (property / non-binding identifier)` };
  }
  return { name: h.name, loc: h.loc };
}

export type RenameEdit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

/** 纯函数：把 def+refs 转成 LSP WorkspaceEdit.changes（去重）。 */
export function buildRenameEdits(
  newName: string,
  locations: Array<{ uri: string; loc: SourceLocation }>,
): Record<string, RenameEdit[]> {
  const changes: Record<string, RenameEdit[]> = {};
  for (const { uri, loc } of locations) {
    const list = (changes[uri] ??= []);
    list.push({
      range: {
        start: { line: loc.start.line - 1, character: loc.start.column },
        end: { line: loc.end.line - 1, character: loc.end.column },
      },
      newText: newName,
    });
  }
  for (const uri of Object.keys(changes)) {
    const seen = new Set<string>();
    changes[uri] = changes[uri]!.filter((e) => {
      const key = `${e.range.start.line}:${e.range.start.character}:${e.range.end.line}:${e.range.end.character}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return changes;
}

export function findDefinition(
  symbolTable: SymbolTable,
  name: string,
): SymbolInfo | null {
  return symbolTable.definitions.get(name) ?? null;
}

export function findReferences(
  symbolTable: SymbolTable,
  name: string,
): ReferenceInfo[] {
  return symbolTable.references.filter((r) => r.name === name);
}

export function findIdentifierAtPosition(ast: Node, line: number, column: number): string | null {
  let found: string | null = null;
  try {
    traverseFn()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === line &&
          loc.start.column <= column &&
          loc.end.column >= column
        ) {
          found = path.node.name;
          path.stop();
        }
      },
    });
  } catch {
    // ignore
  }
  return found;
}

// ---------------------------------------------------------------------------
// documentSymbol
// ---------------------------------------------------------------------------

export type DocumentSymbolItem = {
  name: string;
  detail?: string;
  kind: number; // SymbolKind
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
  children?: DocumentSymbolItem[];
};

/** vscode SymbolKind */
export const SymbolKind = {
  Function: 12,
  Variable: 13,
  Class: 5,
  Method: 6,
  Property: 7,
  Constant: 14,
} as const;

function rangeOfLoc(loc: SourceLocation) {
  return {
    start: { line: loc.start.line - 1, character: loc.start.column },
    end: { line: loc.end.line - 1, character: loc.end.column },
  };
}

function rangeOfNode(node: Node): DocumentSymbolItem["range"] {
  return rangeOfLoc(locFromNode(node));
}

/** 顶层函数 / 类 / 变量 → DocumentSymbol（方法作为 children） */
export function documentSymbols(ast: Node): DocumentSymbolItem[] {
  const out: DocumentSymbolItem[] = [];
  const program = (ast as File).program ?? (ast as any);
  const body: Node[] = program.body ?? [];

  const pushFn = (fnNode: any, idNode: any, exported: boolean): void => {
    if (!idNode?.name) return;
    const range = rangeOfNode(fnNode);
    const selection = rangeOfNode(idNode);
    const children: DocumentSymbolItem[] = [];
    const params: string[] = (fnNode.params ?? [])
      .map((p: any) => (p?.name ?? (p?.type === "RestElement" ? `...${p.argument?.name}` : "_")))
      .filter(Boolean);
    out.push({
      name: idNode.name,
      detail: `(${params.join(", ")})${exported ? " export" : ""}`,
      kind: SymbolKind.Function,
      range,
      selectionRange: selection,
      children: children.length ? children : undefined,
    });
  };

  for (const stmt of body) {
    let decl: any = stmt;
    let exported = false;
    if ((stmt as any).type === "ExportNamedDeclaration" && (stmt as any).declaration) {
      decl = (stmt as any).declaration;
      exported = true;
    } else if ((stmt as any).type === "ExportDefaultDeclaration") {
      decl = (stmt as any).declaration;
      exported = true;
    }

    if (decl?.type === "FunctionDeclaration") {
      pushFn(decl, decl.id, exported);
      continue;
    }
    if (decl?.type === "ClassDeclaration" && decl.id) {
      out.push({
        name: decl.id.name,
        detail: exported ? "export class" : "class",
        kind: SymbolKind.Class,
        range: rangeOfNode(decl),
        selectionRange: rangeOfNode(decl.id),
        children: (decl.body?.body ?? []).flatMap((m: any) => {
          const key = m.key?.name ?? m.key?.value;
          if (!key || m.type !== "ClassMethod" && m.type !== "ClassProperty") return [];
          return [{
            name: String(key),
            kind: m.type === "ClassMethod" ? SymbolKind.Method : SymbolKind.Property,
            range: rangeOfNode(m),
            selectionRange: rangeOfNode(m.key),
          }];
        }),
      });
      continue;
    }
    if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations ?? []) {
        if (d.id?.type !== "Identifier") continue;
        const init = d.init;
        const isFn =
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression");
        out.push({
          name: d.id.name,
          detail: exported ? "export const" : "const",
          kind: isFn ? SymbolKind.Function : SymbolKind.Variable,
          range: rangeOfNode(d),
          selectionRange: rangeOfNode(d.id),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross-file import resolution
// ---------------------------------------------------------------------------

export type ImportBinding = {
  /** 导入说明符原文 */
  spec: string;
  /** 目标模块里的导出名（default / 具名） */
  importedName: string;
  /** 解析后的绝对路径（相对 specifier 成功时） */
  resolvedPath?: string;
};

/** 收集 `import { a as b } from "./x"` / `import def from` 的本地绑定 */
export function collectImportBindings(
  ast: Node,
  fromFile: string,
): Map<string, ImportBinding> {
  const map = new Map<string, ImportBinding>();
  const program = (ast as File).program ?? (ast as any);
  for (const stmt of program.body ?? []) {
    if (stmt.type !== "ImportDeclaration") continue;
    const spec = stmt.source.value as string;
    const resolvedPath = resolveRelativeModule(spec, fromFile);
    for (const specNode of stmt.specifiers ?? []) {
      if (specNode.type === "ImportSpecifier") {
        const imported = specNode.imported.type === "Identifier" ? specNode.imported.name : String(specNode.imported.value);
        map.set(specNode.local.name, { spec, importedName: imported, resolvedPath });
      } else if (specNode.type === "ImportDefaultSpecifier") {
        map.set(specNode.local.name, { spec, importedName: "default", resolvedPath });
      } else if (specNode.type === "ImportNamespaceSpecifier") {
        // namespace：不支持精确跳转到单个导出
        map.set(specNode.local.name, { spec, importedName: "*", resolvedPath });
      }
    }
  }
  return map;
}

/** 相对说明符 → 绝对文件路径（扩展名规则与 service 一致） */
export function resolveRelativeModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [
    base,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, "index.js"),
    join(base, "index.mjs"),
    join(base, "index.ts"),
  ]) {
    try {
      if (existsSync(cand) && statSync(cand).isFile()) return cand;
    } catch {
      /* next */
    }
  }
  return undefined;
}

export function readSourceIfExists(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

/** 在目标文件里找具名/default 导出的定义位置 */
export function findExportDefinition(
  targetSource: string,
  exportName: string,
): { name: string; kind: SymbolInfo["kind"]; loc: SourceLocation } | null {
  let ast: Node;
  try {
    ast = parse(targetSource);
  } catch {
    return null;
  }
  const program = (ast as File).program ?? (ast as any);
  for (const stmt of program.body ?? []) {
    let decl: any = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    } else if (stmt.type === "ExportDefaultDeclaration") {
      decl = stmt.declaration;
      // export default function foo / class foo / identifier
      if (exportName === "default") {
        if (decl?.type === "FunctionDeclaration" && decl.id) {
          return { name: decl.id.name, kind: "function", loc: locFromNode(decl.id) };
        }
        if (decl?.type === "ClassDeclaration" && decl.id) {
          return { name: decl.id.name, kind: "class", loc: locFromNode(decl.id) };
        }
        if (decl?.type === "Identifier") {
          return { name: decl.name, kind: "variable", loc: locFromNode(decl) };
        }
        return null;
      }
      continue;
    }
    if (decl?.type === "FunctionDeclaration" && decl.id?.name === exportName) {
      return { name: decl.id.name, kind: "function", loc: locFromNode(decl.id) };
    }
    if (decl?.type === "ClassDeclaration" && decl.id?.name === exportName) {
      return { name: decl.id.name, kind: "class", loc: locFromNode(decl.id) };
    }
    if (decl?.type === "VariableDeclaration") {
      for (const d of decl.declarations ?? []) {
        if (d.id?.type === "Identifier" && d.id.name === exportName) {
          return { name: d.id.name, kind: "variable", loc: locFromNode(d.id) };
        }
      }
    }
    // export { a, b as c }
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration && stmt.specifiers) {
      for (const s of stmt.specifiers) {
        if (s.type !== "ExportSpecifier") continue;
        const exported = s.exported.type === "Identifier" ? s.exported.name : String(s.exported.value);
        if (exported !== exportName) continue;
        const local = s.local.type === "Identifier" ? s.local.name : String((s.local as any).value);
        const table = buildSymbolTable(ast, "");
        const def = table.definitions.get(local);
        if (def) return { name: local, kind: def.kind, loc: def.loc };
      }
    }
  }
  return null;
}

/**
 * 跨文件 definition：ident 是当前文件的 import 绑定时，跳到目标模块的导出定义。
 */
export function findCrossFileDefinition(
  fromFile: string,
  source: string,
  ident: string,
): { filePath: string; loc: SourceLocation; name: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return null;
  }
  const bindings = collectImportBindings(ast, fromFile);
  const binding = bindings.get(ident);
  if (!binding?.resolvedPath) return null;
  if (binding.importedName === "*") return null;
  const targetSource = readSourceIfExists(binding.resolvedPath);
  if (targetSource === undefined) return null;
  const def = findExportDefinition(targetSource, binding.importedName);
  if (!def) return null;
  return { filePath: binding.resolvedPath, loc: def.loc, name: def.name };
}

/**
 * 跨文件 references：在 candidateFiles（默认 = 当前文件目录树 + 已知文件）里
 * 找 import 了 definingFile 的文件，并收集对 localName 的引用。
 */
export function findCrossFileReferences(
  definingFile: string,
  exportName: string,
  options: {
    /** 额外扫描的文件路径（open documents / knownFiles） */
    extraFiles?: string[];
    /** 扫描根目录（默认 definingFile 所在目录） */
    rootDir?: string;
    maxFiles?: number;
  } = {},
): ReferenceInfo[] {
  const out: ReferenceInfo[] = [];
  const root = options.rootDir ?? dirname(definingFile);
  const maxFiles = options.maxFiles ?? 200;
  const candidates = new Set<string>(options.extraFiles ?? []);

  // 目录树里相对导入 definingFile 的候选
  try {
    collectJsFiles(root, candidates, maxFiles, 0);
  } catch {
    /* ignore */
  }

  const definingNorm = resolve(definingFile);
  for (const cand of candidates) {
    if (resolve(cand) === definingNorm) continue;
    const src = readSourceIfExists(cand);
    if (src === undefined) continue;
    let ast: Node;
    try {
      ast = parse(src);
    } catch {
      continue;
    }
    // 找 import { exportName as local } from definingFile
    const bindings = collectImportBindings(ast, cand);
    for (const [local, b] of bindings) {
      if (!b.resolvedPath || resolve(b.resolvedPath) !== definingNorm) continue;
      if (b.importedName !== exportName && b.importedName !== "*") continue;
      const table = buildSymbolTable(ast, cand);
      // 本地引用（跳过 import specifier 的 Identifier —— buildSymbolTable 已把它们记为 reference）
      for (const ref of table.references) {
        if (ref.name !== local) continue;
        out.push({ name: local, loc: ref.loc, uri: cand });
      }
    }
  }
  return out;
}

function collectJsFiles(
  dir: string,
  out: Set<string>,
  max: number,
  depth: number,
): void {
  if (out.size >= max || depth > 6) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        collectJsFiles(full, out, max, depth + 1);
      } else if (/\.(js|mjs|cjs|ts|mts)$/.test(name) && !/\.d\.ts$/.test(name)) {
        out.add(full);
      }
    } catch {
      /* skip */
    }
  }
}

/**
 * 同名导出兜底定义查找：ident 在当前文件既无本地定义也无 import 绑定时
 * （典型：依赖注入风格的函数参数 `computeScorecard` 的调用点），在候选
 * 文件集（同目录树 + 会话已知文件）里查找名为 ident 的导出定义。
 * 仅用于 definition 跳转；rename/references 不走此路径（改名语义必须
 * 绑定到真实绑定点，不能按名字跨文件外推）。
 */
export function findWorkspaceExportDefinition(
  fromFile: string,
  ident: string,
  options: { extraFiles?: string[]; rootDir?: string; maxFiles?: number } = {},
): { filePath: string; loc: SourceLocation; name: string } | null {
  const root = options.rootDir ?? dirname(fromFile);
  const candidates = new Set<string>(options.extraFiles ?? []);
  try {
    collectJsFiles(root, candidates, options.maxFiles ?? 200, 0);
  } catch {
    /* ignore unreadable roots */
  }
  candidates.delete(fromFile);
  for (const cand of candidates) {
    const src = readSourceIfExists(cand);
    if (src === undefined) continue;
    const def = findExportDefinition(src, ident);
    if (def) return { filePath: cand, loc: def.loc, name: def.name };
  }
  return null;
}

/** A5：侧车契约绑定（同名 export）位置 */
function findSidecarContractDefinition(
  fromFile: string,
  ident: string,
  options: { extraFiles?: string[] } = {},
): { filePath: string; loc: SourceLocation; name: string } | null {
  try {
    const sidecar = sidecarPathOf(fromFile);
    const candidates = [sidecar, ... (options.extraFiles ?? []).filter((f) => f.endsWith(".nudo.js") || f.endsWith(".nudo.ts"))];
    for (const path of candidates) {
      if (!path || !existsSync(path)) continue;
      const src = readFileSync(path, "utf8");
      const table = buildSymbolTable(parse(src), path);
      const d = findDefinition(table, ident);
      if (d) return { filePath: path, loc: d.loc, name: d.name };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * A5：可能的定义位（本地定义优先，其次跨文件，再次侧车契约）。
 * onDefinition 返回 Location[]，便于 F12 跳本地声明，Peek Definition 见侧车。
 */
export function resolveDefinitionLocations(
  fromFile: string,
  source: string,
  ident: string,
  options: { extraFiles?: string[]; workspaceFallback?: boolean } = {},
): Array<{ filePath: string; loc: SourceLocation; name: string }> {
  const out: Array<{ filePath: string; loc: SourceLocation; name: string }> = [];
  const ast = parse(source);
  const table = buildSymbolTable(ast, fromFile);
  const local = findDefinition(table, ident);
  const cross = findCrossFileDefinition(fromFile, source, ident);
  // import 绑定：真实定义在目标导出；本地 import 说明符作次要位点（Peek）
  if (cross) {
    out.push(cross);
    if (local) {
      out.push({ filePath: fromFile, loc: local.loc, name: local.name });
    }
  } else if (local) {
    out.push({ filePath: fromFile, loc: local.loc, name: local.name });
  }
  const sidecar = findSidecarContractDefinition(fromFile, ident, options);
  if (sidecar && !out.some((d) => d.filePath === sidecar.filePath)) {
    out.push(sidecar);
  }
  if (out.length === 0 && options.workspaceFallback) {
    const ws = findWorkspaceExportDefinition(fromFile, ident, { extraFiles: options.extraFiles });
    if (ws) out.push(ws);
  }
  return out;
}

/**
 * 统一导航入口：
 * - 本地定义命中 → 当前文件
 * - 否则若是 import 绑定 → 跨文件
 * - 否则侧车同名契约（A5）
 * - 否则（workspaceFallback，仅 definition）→ 同名导出兜底
 */
export function resolveDefinition(
  fromFile: string,
  source: string,
  ident: string,
  options: { extraFiles?: string[]; workspaceFallback?: boolean } = {},
): { filePath: string; loc: SourceLocation; name: string } | null {
  const all = resolveDefinitionLocations(fromFile, source, ident, options);
  return all[0] ?? null;
}

/**
 * 统一 references：本地（作用域绑定）+ 跨文件（import 了定义文件的调用方）。
 * includeDeclaration=true 时把定义位置也计入（LSP context.includeDeclaration）。
 * `at` 提供时走 collectBindingReferences——同绑定、抗遮蔽、不碰属性名。
 */
export function resolveReferences(
  fromFile: string,
  source: string,
  ident: string,
  options: {
    extraFiles?: string[];
    includeDeclaration?: boolean;
    at?: { line: number; column: number };
  } = {},
): ReferenceInfo[] {
  const includeDecl = options.includeDeclaration !== false;
  const ast = parse(source);
  const table = buildSymbolTable(ast, fromFile);
  const localRefs = options.at
    ? collectBindingReferences(ast, ident, options.at, fromFile)
    : findReferences(table, ident);
  const localDef = findDefinition(table, ident);

  // import 绑定优先：localDef 可能是 import local（也是定义），必须走跨文件
  const crossDefEarly = findCrossFileDefinition(fromFile, source, ident);
  if (crossDefEarly) {
    const defSource = readSourceIfExists(crossDefEarly.filePath) ?? "";
    let defAst: Node | null = null;
    try {
      defAst = parse(defSource);
    } catch {
      defAst = null;
    }
    const defLocalRefs: ReferenceInfo[] = [];
    let defDecl: ReferenceInfo[] = [];
    if (defAst) {
      if (options.at) {
        // 目标文件：从定义位点收集同绑定
        defLocalRefs.push(
          ...collectBindingReferences(
            defAst,
            crossDefEarly.name,
            {
              line: crossDefEarly.loc.start.line,
              column: crossDefEarly.loc.start.column,
            },
            crossDefEarly.filePath,
          ),
        );
      } else {
        const defTable = buildSymbolTable(defAst, crossDefEarly.filePath);
        defLocalRefs.push(...findReferences(defTable, crossDefEarly.name));
      }
      const defTable = buildSymbolTable(defAst, crossDefEarly.filePath);
      const d = findDefinition(defTable, crossDefEarly.name);
      if (d && includeDecl) {
        defDecl = [{ name: d.name, loc: d.loc, uri: crossDefEarly.filePath }];
      }
    }

    const cross = findCrossFileReferences(crossDefEarly.filePath, crossDefEarly.name, {
      extraFiles: [...(options.extraFiles ?? []), fromFile],
    });
    const seen = new Set<string>();
    const all: ReferenceInfo[] = [];
    for (const r of [...defDecl, ...defLocalRefs, ...localRefs, ...cross]) {
      const key = `${r.uri ?? ""}:${r.loc.start.line}:${r.loc.start.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
    }
    return all;
  }

  // 本地定义：扫描 import 本文件的其它文件
  if (localDef) {
    const exportName = localDef.name;
    const isExported = isExportedName(ast, exportName);
    const cross = isExported
      ? findCrossFileReferences(fromFile, exportName, { extraFiles: options.extraFiles })
      : [];
    const decl: ReferenceInfo[] = includeDecl
      ? [{ name: localDef.name, loc: localDef.loc, uri: fromFile }]
      : [];
    return [...decl, ...localRefs, ...cross];
  }

  // import 绑定：跳到定义文件，再收集定义文件 + 其它 importer 的引用
  const crossDef = findCrossFileDefinition(fromFile, source, ident);
  if (!crossDef) return localRefs;

  const defSource = readSourceIfExists(crossDef.filePath) ?? "";
  let defAst: Node | null = null;
  try {
    defAst = parse(defSource);
  } catch {
    defAst = null;
  }
  const defLocalRefs: ReferenceInfo[] = [];
  let defDecl: ReferenceInfo[] = [];
  if (defAst) {
    const defTable = buildSymbolTable(defAst, crossDef.filePath);
    defLocalRefs.push(...findReferences(defTable, crossDef.name));
    const d = findDefinition(defTable, crossDef.name);
    if (d && includeDecl) {
      defDecl = [{ name: d.name, loc: d.loc, uri: crossDef.filePath }];
    }
  }

  const cross = findCrossFileReferences(crossDef.filePath, crossDef.name, {
    extraFiles: [...(options.extraFiles ?? []), fromFile],
  });
  const seen = new Set<string>();
  const all: ReferenceInfo[] = [];
  for (const r of [...defDecl, ...defLocalRefs, ...localRefs, ...cross]) {
    const key = `${r.uri ?? ""}:${r.loc.start.line}:${r.loc.start.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(r);
  }
  return all;
}

function isExportedName(ast: Node, name: string): boolean {
  const program = (ast as File).program ?? (ast as any);
  for (const stmt of program.body ?? []) {
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) {
        const d: any = stmt.declaration;
        if (d.type === "FunctionDeclaration" && d.id?.name === name) return true;
        if (d.type === "ClassDeclaration" && d.id?.name === name) return true;
        if (d.type === "VariableDeclaration") {
          for (const dec of d.declarations ?? []) {
            if (dec.id?.type === "Identifier" && dec.id.name === name) return true;
          }
        }
      }
      for (const s of stmt.specifiers ?? []) {
        if (s.type !== "ExportSpecifier") continue;
        const exported = s.exported.type === "Identifier" ? s.exported.name : String(s.exported.value);
        if (exported === name) return true;
      }
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d: any = stmt.declaration;
      if (d?.id?.name === name) return true;
      if (d?.type === "Identifier" && d.name === name) return true;
    }
  }
  return false;
}
