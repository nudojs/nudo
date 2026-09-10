/**
 * Host 侧多文件解析（非 kernel）。
 *
 * 分层：
 *   kernel  = 纯抽象解释：吃 AST / source string，不碰 fs/path
 *   host    = 读文件、解析相对 import、把 source 喂给 kernel
 *   Node/打包器 = 真正的模块加载与执行
 *
 * 引擎不做 bundler；这里只为「跨文件类型事实」做最薄的静态 import 扫描。
 */

import { parse } from "@nudojs/parser";
import type { File, Node } from "@babel/types";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { generalizeFromAst, type PolyFn } from "@nudojs/kernel";

export type ModuleExports = {
  path: string;
  named: Map<string, string>;
  defaultExport?: string;
  source: string;
  poly: Map<string, PolyFn>;
};

function resolveRelative(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, base + ".js", base + ".mjs", join(base, "index.js")]) {
    if (existsSync(cand)) return cand;
  }
  return undefined;
}

/** 分析单文件导出 + 内涵签名（source 由 host 提供） */
export function analyzeExportsFromSource(
  filePath: string,
  source: string,
): ModuleExports {
  const file = parse(source);
  const named = new Map<string, string>();
  let defaultExport: string | undefined;
  const poly = new Map<string, PolyFn>();

  for (const stmt of file.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (decl.type === "FunctionDeclaration" && decl.id) {
      named.set(decl.id.name, decl.id.name);
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier") named.set(d.id.name, d.id.name);
      }
    }
    if (decl.type === "ClassDeclaration" && decl.id) {
      named.set(decl.id.name, decl.id.name);
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" && d.id) defaultExport = d.id.name;
      if (d.type === "Identifier") defaultExport = d.name;
    }
    if (stmt.type === "ExpressionStatement") {
      const e = stmt.expression;
      if (
        e.type === "AssignmentExpression" &&
        e.left.type === "MemberExpression" &&
        e.left.object.type === "Identifier" &&
        e.left.object.name === "exports" &&
        e.left.property.type === "Identifier"
      ) {
        named.set(e.left.property.name, e.left.property.name);
      }
    }
  }

  for (const name of named.values()) {
    const g = generalizeFromAst(name, source);
    if (g) poly.set(name, g);
  }
  if (defaultExport) {
    const g = generalizeFromAst(defaultExport, source);
    if (g) poly.set("default", g);
  }

  return { path: filePath, named, defaultExport, source, poly };
}

/**
 * 从入口文件沿静态相对 import 收集（仅用于类型事实，不是运行时加载器）。
 * bare specifier（npm 包）跳过——交给 harvest / env，不在此解析。
 */
export function collectStaticImports(
  entryFile: string,
  maxDepth = 8,
): Map<string, ModuleExports> {
  const graph = new Map<string, ModuleExports>();
  const queue: Array<{ file: string; depth: number }> = [
    { file: resolve(entryFile), depth: 0 },
  ];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;
    if (seen.has(file) || depth > maxDepth) continue;
    seen.add(file);
    if (!existsSync(file)) continue;

    const source = readFileSync(file, "utf8");
    const mod = analyzeExportsFromSource(file, source);
    graph.set(file, mod);

    const ast: File = parse(source);
    for (const stmt of ast.program.body) {
      const spec =
        stmt.type === "ImportDeclaration"
          ? stmt.source.value
          : stmt.type === "ExportNamedDeclaration" && stmt.source
            ? stmt.source.value
            : undefined;
      if (!spec) continue;
      const resolved = resolveRelative(file, spec);
      if (resolved) queue.push({ file: resolved, depth: depth + 1 });
    }
  }
  return graph;
}
