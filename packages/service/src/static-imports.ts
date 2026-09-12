/**
 * Host 侧多文件解析（非代数层）。
 *
 * 分层：
 *   algebra = 纯抽象解释：吃 AST / source string，不碰 fs/path
 *   host   = 读文件、解析相对 import/require、把 source 喂给代数
 *   Node/打包器 = 真正的模块加载与执行
 *
 * 引擎不做 bundler；这里只为「跨文件类型事实」做最薄的静态扫描。
 */

import { parse } from "@nudojs/parser";
import type { File, Node } from "@babel/types";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { generalizeFromAst, type PolyFn } from "@nudojs/core";

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
  for (const cand of [
    base,
    base + ".js",
    base + ".cjs",
    base + ".mjs",
    base + ".ts",
    base + ".mts",
    base + ".cts",
    join(base, "index.js"),
    join(base, "index.cjs"),
    join(base, "index.mjs"),
    join(base, "index.ts"),
  ]) {
    if (existsSync(cand)) return cand;
  }
  return undefined;
}

/** 从 AST 收集静态相对依赖（ESM import + CJS require） */
export function collectDependencySpecs(ast: File): string[] {
  const specs: string[] = [];
  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") {
      specs.push(stmt.source.value);
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.source) {
      specs.push(stmt.source.value);
    }
    if (stmt.type === "ExportAllDeclaration" && stmt.source) {
      specs.push(stmt.source.value);
    }
    // require("...") / require.resolve
    collectRequires(stmt, specs);
  }
  return specs;
}

function collectRequires(node: Node, out: string[]): void {
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as {
      type?: string;
      callee?: { type?: string; name?: string };
      arguments?: Array<{ type?: string; value?: unknown }>;
      [k: string]: unknown;
    };
    if (
      obj.type === "CallExpression" &&
      obj.callee?.type === "Identifier" &&
      obj.callee.name === "require" &&
      obj.arguments?.[0]?.type === "StringLiteral"
    ) {
      const spec = obj.arguments[0].value;
      if (typeof spec === "string") out.push(spec);
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = obj[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  visit(node);
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
    // CJS: exports.foo = fn / module.exports = fn / module.exports = { a, b }
    collectCjsExports(stmt, named, (n) => {
      defaultExport = n;
    });
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

function collectCjsExports(
  stmt: Node,
  named: Map<string, string>,
  setDefault: (name: string) => void,
): void {
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type !== "AssignmentExpression") {
      for (const key of Object.keys(obj)) {
        if (key === "loc" || key === "start" || key === "end") continue;
        const v = obj[key];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") visit(v);
      }
      return;
    }
    const left = obj.left as {
      type?: string;
      object?: { type?: string; name?: string };
      property?: { type?: string; name?: string; value?: string };
    };
    const right = obj.right as Record<string, unknown> & { type?: string };

    // exports.foo = ...
    if (
      left?.type === "MemberExpression" &&
      left.object?.type === "Identifier" &&
      left.object.name === "exports" &&
      left.property?.type === "Identifier" &&
      left.property.name
    ) {
      named.set(left.property.name, left.property.name);
    }
    // module.exports = fnName
    if (
      left?.type === "MemberExpression" &&
      left.object?.type === "Identifier" &&
      left.object.name === "module" &&
      left.property?.type === "Identifier" &&
      left.property.name === "exports"
    ) {
      if (right?.type === "Identifier" && typeof right.name === "string") {
        named.set(right.name, right.name);
        setDefault(right.name);
      }
      // module.exports = { foo, bar: baz }
      if (right?.type === "ObjectExpression") {
        const props = right.properties as Array<Record<string, unknown>>;
        for (const p of props) {
          if (p.type !== "ObjectProperty") continue;
          const key = p.key as { type?: string; name?: string; value?: string };
          const val = p.value as { type?: string; name?: string };
          const exportName =
            key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? key.value : undefined;
          if (exportName) named.set(exportName, exportName);
          if (val?.type === "Identifier" && val.name && exportName) {
            // exported binding may differ from local name — generalize uses local
            // keep exportName as key; generalizeFromAst(exportName) may fail if local differs
          }
        }
      }
    }
  };
  visit(stmt);
}

/**
 * 从入口文件沿静态相对 import/require 收集（仅类型事实，不是运行时加载器）。
 * bare specifier（npm 包）跳过——交给 harvest / env。
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
    for (const spec of collectDependencySpecs(ast)) {
      const resolved = resolveRelative(file, spec);
      if (resolved) queue.push({ file: resolved, depth: depth + 1 });
    }
  }
  return graph;
}
