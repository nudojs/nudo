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

function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

function traverseFn(): typeof traverse {
  return (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
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
      },
      VariableDeclarator(path) {
        if (path.node.id.type === "Identifier") {
          definitions.set(path.node.id.name, {
            name: path.node.id.name,
            kind: "variable",
            loc: locFromNode(path.node.id),
            uri,
          });
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
      Identifier(path) {
        if (path.parentPath?.node.type === "FunctionDeclaration" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "VariableDeclarator" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "ClassDeclaration" && path.parentPath.node.id === path.node) return;

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
 * 统一导航入口：
 * - 本地定义命中 → 当前文件
 * - 否则若是 import 绑定 → 跨文件
 */
export function resolveDefinition(
  fromFile: string,
  source: string,
  ident: string,
): { filePath: string; loc: SourceLocation; name: string } | null {
  const ast = parse(source);
  const table = buildSymbolTable(ast, fromFile);
  const local = findDefinition(table, ident);
  if (local) return { filePath: fromFile, loc: local.loc, name: local.name };
  return findCrossFileDefinition(fromFile, source, ident);
}

/**
 * 统一 references：本地 + 跨文件（import 了定义文件的调用方）。
 * includeDeclaration=true 时把定义位置也计入（LSP context.includeDeclaration）。
 */
export function resolveReferences(
  fromFile: string,
  source: string,
  ident: string,
  options: { extraFiles?: string[]; includeDeclaration?: boolean } = {},
): ReferenceInfo[] {
  const includeDecl = options.includeDeclaration !== false;
  const ast = parse(source);
  const table = buildSymbolTable(ast, fromFile);
  const localRefs = findReferences(table, ident);
  const localDef = findDefinition(table, ident);

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
