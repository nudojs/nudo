/**
 * Minimal export-spec walker for harvest-auto dependency discovery.
 * Copied from service's static-imports.ts (just `collectDependencySpecs` +
 * its `require` helper) so `@nudojs/harvester` does not depend on
 * `@nudojs/service`.
 */

import type { File, Node } from "@babel/types";
import { foldStaticStringExpr } from "@nudojs/core";

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
      if (spec !== undefined) out.push(spec);
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
