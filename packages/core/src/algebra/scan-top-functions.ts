/**
 * 顶层函数清单：function 声明 + const 箭头/函数表达式（含 export 包装）
 *  + **导出 class 的实例方法**（C4.2，命名 `Class.method`）。
 *  P1：本地 `class Foo` 经 `export { Foo }` / `export { Foo as default }` /
 *  `export default Foo` 导出时同样登记实例方法。
 *
 * 从 scan.ts 拆出：纯 AST 清单，无调用图状态。
 */

import { parseSource as parse } from "./parse-source.ts";
import type { Node } from "@babel/types";

export function listTopFunctions(source: string, file?: ReturnType<typeof parse>): string[] {
  const f = file ?? parse(source);
  const names: string[] = [];
  /** 本地 ClassDeclaration（含未直接 export 的） */
  const localClasses = new Map<string, Node>();
  for (const stmt of f.program.body) {
    if (stmt.type === "ClassDeclaration") {
      const cname = (stmt as { id?: { name?: string } }).id?.name;
      if (cname) localClasses.set(cname, stmt);
    }
  }
  /** 经任意 export 形态暴露的 class 本地名 */
  const exportedClassNames = new Set<string>();
  const collectClassMethods = (cname: string, decl: Node) => {
    const body = (decl as { body?: { body?: unknown[] } }).body?.body ?? [];
    for (const m of body) {
      const mem = m as {
        type?: string;
        kind?: string;
        key?: { type?: string; name?: string };
        static?: boolean;
      };
      const isMethod =
        mem.type === "MethodDefinition" ||
        mem.type === "ClassMethod" ||
        mem.type === "TSDeclareMethod";
      if (!isMethod) continue;
      if (mem.kind && mem.kind !== "method") continue; // skip ctor/get/set
      // static 与实例方法同为入口可见（design §3.2）
      const keyName =
        mem.key?.type === "Identifier" ? mem.key.name : undefined;
      if (keyName) names.push(`${cname}.${keyName}`);
    }
  };
  for (const stmt of f.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
      // export default (…) => … / function (…)：本地键 default
      if (
        decl.type === "ArrowFunctionExpression" ||
        decl.type === "FunctionExpression"
      ) {
        if (!names.includes("default")) names.push("default");
      }
    }
    if (decl.type === "FunctionDeclaration" && decl.id) names.push(decl.id.name);
    if (
      decl.type === "FunctionDeclaration" &&
      !decl.id &&
      stmt.type === "ExportDefaultDeclaration"
    ) {
      if (!names.includes("default")) names.push("default");
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          names.push(d.id.name);
        }
      }
    }
    // C4.2：导出 class 的普通实例方法 → `Class.method`（跳过 ctor/get/set）
    if (
      decl.type === "ClassDeclaration" &&
      (decl as { id?: { name?: string } }).id?.name &&
      (stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration")
    ) {
      const cname = (decl as { id: { name: string } }).id.name;
      exportedClassNames.add(cname);
      collectClassMethods(cname, decl);
    }
  }
  // P1：export { Foo } / export { Foo as default } / export default Foo
  for (const stmt of f.program.body) {
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration) {
      const specs = (stmt as { specifiers?: unknown[] }).specifiers ?? [];
      for (const spec of specs) {
        const s = spec as {
          type?: string;
          local?: { name?: string };
          exported?: { name?: string; value?: unknown };
        };
        if (s.type !== "ExportSpecifier") continue;
        const localName = s.local?.name;
        if (!localName || exportedClassNames.has(localName)) continue;
        const exportedName = s.exported?.name ?? s.exported?.value;
        const isDefault = exportedName === "default";
        // 只在「导出到外部」时登记：export { Foo } 或 export { Foo as default }
        if (!isDefault && exportedName !== localName) {
          // export { Foo as Bar }：仍导出 class，方法键按本地名
        }
        const decl = localClasses.get(localName);
        if (!decl) continue;
        exportedClassNames.add(localName);
        collectClassMethods(localName, decl);
      }
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      const d = stmt.declaration;
      if (d.type === "Identifier") {
        const localName = d.name;
        if (!exportedClassNames.has(localName)) {
          const decl = localClasses.get(localName);
          if (decl) {
            exportedClassNames.add(localName);
            collectClassMethods(localName, decl);
          }
        }
      }
    }
  }
  // CJS：exports.f = fn / module.exports.f = fn / module.exports = { f: fn }
  for (const stmt of f.program.body) {
    if (stmt.type !== "ExpressionStatement") continue;
    const expr = (stmt as { expression?: unknown }).expression as
      | { type?: string; left?: unknown; right?: unknown }
      | undefined;
    if (!expr || expr.type !== "AssignmentExpression") continue;
    const left = expr.left as {
      type?: string;
      object?: { type?: string; name?: string; object?: { name?: string }; property?: { name?: string } };
      property?: { type?: string; name?: string; value?: unknown };
      computed?: boolean;
    } | undefined;
    const right = expr.right;
    if (!left || left.type !== "MemberExpression" || left.computed) continue;
    const obj = left.object;
    const prop = left.property;
    const propName =
      prop?.type === "Identifier"
        ? prop.name
        : prop?.type === "StringLiteral" || prop?.type === "NumericLiteral"
          ? String(prop.value)
          : undefined;
    const isExportsIdent = !!obj && obj.type === "Identifier" && obj.name === "exports";
    const isModuleExportsMember =
      !!obj &&
      obj.type === "MemberExpression" &&
      obj.object?.name === "module" &&
      obj.property?.name === "exports";
    const isModuleExportsIdent =
      !!obj && obj.type === "Identifier" && obj.name === "module" && propName === "exports";

    const pushFnFromInit = (fallbackName: string | undefined, init: unknown): void => {
      const r = init as { type?: string; id?: { name?: string } } | undefined;
      if (!r) return;
      if (r.type !== "FunctionExpression" && r.type !== "ArrowFunctionExpression") return;
      const n = r.id?.name ?? fallbackName;
      if (n && !names.includes(n)) names.push(n);
    };

    if (isModuleExportsIdent) {
      pushFnFromInit(undefined, right);
      const objLit = right as { type?: string; properties?: unknown[] } | undefined;
      if (objLit?.type === "ObjectExpression") {
        for (const p of objLit.properties ?? []) {
          const prop2 = p as {
            type?: string;
            key?: { type?: string; name?: string; value?: unknown };
            value?: unknown;
            params?: unknown[];
            body?: unknown;
            async?: boolean;
            id?: { name?: string };
          };
          if (prop2.type === "ObjectMethod" || prop2.type === "ClassMethod") {
            const keyName =
              prop2.key?.type === "Identifier"
                ? prop2.key.name
                : prop2.key?.type === "StringLiteral" || prop2.key?.type === "NumericLiteral"
                  ? String(prop2.key.value)
                  : undefined;
            if (keyName && !names.includes(keyName)) names.push(keyName);
            continue;
          }
          if (prop2.type !== "ObjectProperty" && prop2.type !== "Property") continue;
          const keyName =
            prop2.key?.type === "Identifier"
              ? prop2.key.name
              : prop2.key?.type === "StringLiteral" || prop2.key?.type === "NumericLiteral"
                ? String(prop2.key.value)
                : undefined;
          if (keyName) pushFnFromInit(keyName, prop2.value);
        }
      }
      continue;
    }
    if ((isExportsIdent || isModuleExportsMember) && propName) {
      pushFnFromInit(propName, right);
    }
  }
  return names;
}
