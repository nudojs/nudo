/**
 * 静态依赖说明符收集（ESM import/export-from + CJS require/require.resolve）。
 *
 * 唯一实现，经 `@nudojs/core/internal` 供 service（static-imports）与
 * harvester（collect-specs）复用——此前 harvester 头注释自认
 * "Copied from service's static-imports.ts"，两份靠手工同步。
 */
import type { File, Node } from "@babel/types";
import { foldStaticStringExpr } from "./exec/transpile/helpers.ts";

/** 依赖说明符的装载通道标签（Bug 238：require 消费方必须拿 require 条件构建） */
export type DependencySpecMode = "import" | "require";

export type DependencySpecEntry = { spec: string; mode: DependencySpecMode };

/** 从 AST 收集静态相对依赖及装载通道（ESM import / CJS require） */
export function collectDependencySpecsWithMode(ast: File): DependencySpecEntry[] {
  const out: DependencySpecEntry[] = [];
  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") {
      out.push({ spec: stmt.source.value, mode: "import" });
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.source) {
      out.push({ spec: stmt.source.value, mode: "import" });
    }
    if (stmt.type === "ExportAllDeclaration" && stmt.source) {
      out.push({ spec: stmt.source.value, mode: "import" });
    }
    // require("...") / require.resolve
    collectRequires(stmt, out);
  }
  return out;
}

/** 从 AST 收集静态相对依赖（ESM import + CJS require） */
export function collectDependencySpecs(ast: File): string[] {
  return collectDependencySpecsWithMode(ast).map((e) => e.spec);
}

function collectRequires(node: Node, out: DependencySpecEntry[]): void {
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as {
      type?: string;
      callee?: {
        type?: string;
        name?: string;
        computed?: boolean;
        object?: { type?: string; name?: string };
        property?: { type?: string; name?: string };
      };
      arguments?: Array<unknown>;
      [k: string]: unknown;
    };
    if (obj.type === "CallExpression" && obj.callee) {
      // require(spec) / require.resolve(spec)：可折叠说明符才进依赖图
      const c = obj.callee;
      let spec: string | undefined;
      if (c.type === "Identifier" && c.name === "require") {
        spec = foldStaticStringExpr(obj.arguments?.[0]);
      } else if (
        c.type === "MemberExpression" &&
        !c.computed &&
        c.object?.type === "Identifier" &&
        c.object.name === "require" &&
        c.property?.type === "Identifier" &&
        c.property.name === "resolve"
      ) {
        spec = foldStaticStringExpr(obj.arguments?.[0]);
      }
      if (spec !== undefined) out.push({ spec, mode: "require" });
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
