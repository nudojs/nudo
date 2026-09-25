/**
 * AST 辅助：函数收集 / 形参 / 定位 / 节点 Abs 表。
 * 自 analyzer.ts 机械拆出；语义未改。
 */
import type { Node, Statement, ClassDeclaration } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type Abs,
  type Environment,
  formalParamsFromNodes,
  formalParamDisplayNames,
  unknown as absUnknown,
  abs as makeAbsVal,
  numLit,
  strLit,
  boolLit,
} from "@nudojs/core";
import {
  programBody,
  getDeclarations,
  getDeclaratorInit,
  getFirstDeclaratorId,
  getExpressionStatementExpression,
  unwrapExport,
  asIdentifier,
  asAssignmentExpression,
  classIdName,
  fnOrClassIdLoc,
  isModuleExportsMember,
  memberPropertyKey,
  classInstanceMethods,
  exportSpecifierLocalName,
  exportSpecifierExportedName,
  unwrapDefaultExport,
} from "@nudojs/parser";
import type { BindingInfo, SourceLocation } from "./analyzer-types.ts";

export function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

export function extractParamNames(node: Node): string[] {
  const fn = node.type === "ExportDefaultDeclaration" ? node.declaration : node;
  if (
    fn.type === "FunctionDeclaration" ||
    fn.type === "FunctionExpression" ||
    fn.type === "ArrowFunctionExpression" ||
    fn.type === "ClassMethod" ||
    fn.type === "ObjectMethod" ||
    fn.type === "TSDeclareMethod"
  ) {
    return formalParamDisplayNames(formalParamsFromNodes((fn as { params?: unknown[] }).params as never));
  }
  if (fn.type === "VariableDeclaration") {
    const init = getDeclaratorInit(getDeclarations(fn)[0]);
    if (init && (init.type === "FunctionExpression" || init.type === "ArrowFunctionExpression")) {
      return formalParamDisplayNames(formalParamsFromNodes(init.params as never));
    }
  }
  return [];
}

export function resolveFunctionNode(node: Node): Node {
  if (node.type === "ExportNamedDeclaration" && node.declaration) return resolveFunctionNode(node.declaration);
  if (node.type === "ExportDefaultDeclaration") return resolveFunctionNode(node.declaration);
  if (node.type === "VariableDeclaration") {
    const init = getDeclaratorInit(getDeclarations(node)[0]);
    if (init && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")) return init;
  }
  return node;
}

/** 函数声明名的标识符定位（无 id 的箭头函数回退声明节点）——诊断高亮
 *  应落函数名 token，而非 function 关键字 / 参数表起点 */
export function fnNameLoc(node: Node, fallback: SourceLocation): SourceLocation {
  const { declaration: d } = unwrapExport(node);
  if (d.type === "VariableDeclaration") {
    const id = getFirstDeclaratorId(d);
    if (id?.loc) return id.loc;
  }
  const idLoc = fnOrClassIdLoc(d);
  if (idLoc) return idLoc;
  return fallback;
}

export function isFnExprValue(node: Node | null | undefined): node is Node {
  return !!node && (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression");
}

export function namedFnExprId(node: Node): string | null {
  return node.type === "FunctionExpression" && node.id ? node.id.name : null;
}

/** `module.exports` — the only assignment target carrying no stable name of its own. */
export function isModuleExportsTarget(node: Node): boolean {
  return node.type === "MemberExpression" && !node.computed && isModuleExportsMember(node);
}

export { memberPropertyKey };

/** Rightmost value of a chained assignment (`a = b = fn` → fn). */
export function deepestAssignValue(expr: Node): Node | null {
  let cur: Node | null | undefined = expr;
  while (cur) {
    const assign = asAssignmentExpression(cur);
    if (!assign) break;
    cur = assign.right;
  }
  return cur ?? null;
}

/**
 * First stable name on an assignment chain, left to right: an identifier
 * binding, or a member property that is not `module.exports` itself. Returns
 * null for chains ending in a bare `module.exports = fn` or in computed
 * members (`exports[k] = fn`) — callers fall back to "default".
 */
export function assignmentChainName(expr: Node): string | null {
  let cur: Node | null | undefined = expr;
  while (cur) {
    const assign = asAssignmentExpression(cur);
    if (!assign) break;
    const target = assign.left as Node;
    if (target.type === "Identifier") return target.name;
    if (target.type === "MemberExpression") {
      if (isModuleExportsTarget(target)) {
        cur = assign.right;
        continue;
      }
      return memberPropertyKey(target);
    }
    return null;
  }
  return null;
}

/**
 * Top-level functions eligible for case synthesis. Besides FunctionDeclarations
 * this collects CJS-style function bindings:
 *
 *   const f = function () {};                           // declarator init
 *   exports.applyToDefaults = function (a, b) {};       // namespace property
 *   module.exports = internals.clone = function () {};  // chained export
 *
 * Naming: identifier bindings win (call sites dispatch on them, and the
 * evaluator's call records key on the callee identifier); a named function
 * expression's own id beats a member property name; a bare
 * `module.exports = fn` becomes "default" (ESM default-export analogue).
 * Collected non-declaration entries carry `noDeclaration` — see FunctionAnalysis.
 *
 * Member / class-method calls are recorded as `Class.method` / bare `method`
 * (see `$invoke` noteBCallRecord) and synthesize `call@` the same way.
 */
export function collectTopLevelFunctions(
  ast: Node,
): { name: string; node: Node; stmt: Node; noDeclaration: boolean; assignedName?: string }[] {
  const results: { name: string; node: Node; stmt: Node; noDeclaration: boolean; assignedName?: string }[] = [];
  if (ast.type !== "File") return results;
  const body = programBody(ast);

  // C4.2：class 导出面与 core localNamedExports 同口径——
  // export class / class+export list / export default Class/Identifier
  const classDecls = new Map<string, { node: ClassDeclaration; stmt: Node }>();
  const exportedClassNames = new Set<string>();
  const collectClassMethods = (cname: string, decl: ClassDeclaration, stmt: Node): void => {
    for (const { name: keyName, node: methodNode } of classInstanceMethods(decl)) {
      results.push({
        name: `${cname}.${keyName}`,
        node: methodNode,
        stmt,
        noDeclaration: true,
      });
    }
  };

  for (const stmt of body) {
    const className = classIdName(stmt);
    if (stmt.type === "ClassDeclaration" && className) {
      classDecls.set(className, { node: stmt, stmt });
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration;
      const exportedClassName = classIdName(d);
      if (d?.type === "ClassDeclaration" && exportedClassName) {
        classDecls.set(exportedClassName, { node: d, stmt });
        exportedClassNames.add(exportedClassName);
        continue;
      }
      if (!d && stmt.specifiers) {
        for (const spec of stmt.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          const local = exportSpecifierLocalName(spec);
          const exported = exportSpecifierExportedName(spec);
          if (!local) continue;
          // export { Local as Public } / export { Foo }：按本地声明名收集
          if (classDecls.has(local) || body.some((s) => classIdName(s) === local)) {
            exportedClassNames.add(local);
          }
          if (exported === "default") exportedClassNames.add(local);
        }
        continue;
      }
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      const defaultClassName = classIdName(d);
      if (d?.type === "ClassDeclaration" && defaultClassName) {
        classDecls.set(defaultClassName, { node: d, stmt });
        exportedClassNames.add(defaultClassName);
      } else {
        const idName = asIdentifier(d as Node)?.name;
        if (idName) exportedClassNames.add(idName);
      }
      continue;
    }
  }

  for (const stmt of body) {
    const decl = resolveFunctionNode(stmt);
    if (decl.type === "FunctionDeclaration" && decl.id) {
      results.push({ name: decl.id.name, node: decl, stmt, noDeclaration: false });
      continue;
    }
    // C4.2/D6：导出 class 实例方法 → `Class.method`（dts 无稳定声明形态，noDeclaration）
    if (decl.type === "ClassDeclaration" && decl.id?.name) {
      continue; // 已在导出扫描后统一收集
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const d = resolveFunctionNode(stmt);
      if (d.type === "FunctionDeclaration" && d.id) {
        results.push({ name: d.id.name, node: d, stmt, noDeclaration: false });
      }
      if (d.type === "ClassDeclaration" && d.id?.name) {
        // 交给下方 exportedClassNames 循环
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d: Node = stmt.declaration;
      if (d.type === "FunctionDeclaration") {
        if (d.id) {
          results.push({ name: d.id.name, node: d, stmt, noDeclaration: false });
        } else {
          results.push({ name: "default", node: d, stmt, noDeclaration: true });
        }
      } else if (isFnExprValue(d)) {
        results.push({ name: "default", node: d, stmt, noDeclaration: true });
      }
      continue;
    }
    if (stmt.type === "VariableDeclaration") {
      for (const declarator of getDeclarations(stmt)) {
        const id = asIdentifier(declarator.id as Node);
        if (id && isFnExprValue(declarator.init)) {
          results.push({ name: id.name, node: declarator.init, stmt, noDeclaration: true });
        }
      }
      continue;
    }
    const expr = getExpressionStatementExpression(stmt);
    if (expr?.type === "AssignmentExpression") {
      const fn = deepestAssignValue(expr);
      if (isFnExprValue(fn)) {
        const name = namedFnExprId(fn) ?? assignmentChainName(expr) ?? "default";
        // 命名函数表达式 id（_apply）与导出槽名（applyToDefaults）不同时
        // 记录槽名——B run 的 CJS 命名空间按槽名导出（entry@ 求值回退用）
        const chain = assignmentChainName(expr);
        const assignedName =
          namedFnExprId(fn) && chain && chain !== name ? chain : undefined;
        results.push({ name, node: fn, stmt, noDeclaration: true, ...(assignedName ? { assignedName } : {}) });
      }
    }
  }

  for (const cname of exportedClassNames) {
    const hit = classDecls.get(cname);
    if (!hit) continue;
    collectClassMethods(cname, hit.node, hit.stmt);
  }
  return results;
}

/** The function value of the file's single `module.exports = <function>`
 * top-level assignment, when there is exactly one. Assigning module.exports
 * replaces the whole exports object, so such a file exports exactly that one
 * function and usage-site records may reach it under any re-export name —
 * matching by targetModule alone is then unambiguous. Returns null for
 * multi-export shapes (no such assignment, several, or `module.exports =
 * {...}`), where a name/alias match is still required so sibling functions
 * don't get misattributed. */
export function findSingleModuleExportsFunction(ast: Node): Node | null {
  if (ast.type !== "File") return null;
  let found: Node | null = null;
  for (const stmt of programBody(ast)) {
    const expr = getExpressionStatementExpression(stmt);
    if (expr?.type !== "AssignmentExpression") continue;
    const fn = deepestAssignValue(expr);
    if (!isFnExprValue(fn)) continue;
    let targetsModuleExports = false;
    let cur: Node | null | undefined = expr;
    while (cur) {
      const assign = asAssignmentExpression(cur);
      if (!assign) break;
      if (isModuleExportsTarget(assign.left as Node)) {
        targetsModuleExports = true;
        break;
      }
      cur = assign.right;
    }
    if (!targetsModuleExports) continue;
    if (found) return null; // a second `module.exports = fn` → ambiguous
    found = fn;
  }
  return found;
}

export function collectBindings(
  ast: Node,
  env: Environment,
  bindings: Map<string, BindingInfo>,
  absBinds?: Map<string, Abs>,
): void {
  if (ast.type !== "File") return;
  const setBinding = (name: string, loc: SourceLocation): void => {
    const absVal = absBinds?.get(name) ?? absUnknown;
    bindings.set(name, {
      abs: absVal,
      loc,
    });
  };
  const walk = (body: Statement[]): void => {
    for (const stmt of body) {
      if (stmt.type === "FunctionDeclaration" && stmt.id) {
        setBinding(stmt.id.name, locFromNode(stmt));
      }
      if (stmt.type === "VariableDeclaration") {
        for (const decl of stmt.declarations) {
          if (decl.id.type === "Identifier") {
            setBinding(decl.id.name, locFromNode(decl));
          }
        }
      }
      if (stmt.type === "ClassDeclaration" && stmt.id) {
        setBinding(stmt.id.name, locFromNode(stmt));
      }
      if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
        walk([stmt.declaration]);
      }
    }
  };
  walk(programBody(ast));
}

export function nullLitAbs(): Abs {
  return makeAbsVal({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
}

export function buildNodeTypeMap(
  ast: Node,
  env: Environment,
  nodeAbsMap: Map<Node, Abs>,
): void {
  const traverseFn = unwrapDefaultExport(traverse);
  try {
    traverseFn(ast, {
      enter(path) {
        const node = path.node;
        try {
          const setAbs = (a: Abs): void => {
            nodeAbsMap.set(node, a);
          };
          if (
            node.type === "Identifier" &&
            node.name !== "undefined" &&
            path.parentPath?.node.type !== "FunctionDeclaration" &&
            path.parentPath?.node.type !== "VariableDeclarator"
          ) {
            if (env.has(node.name)) {
              setAbs(env.lookup(node.name));
            }
          }
          if (node.type === "NumericLiteral") {
            setAbs(numLit(node.value));
          }
          if (node.type === "StringLiteral") {
            setAbs(strLit(node.value));
          }
          if (node.type === "BooleanLiteral") {
            setAbs(boolLit(node.value));
          }
          if (node.type === "NullLiteral") {
            setAbs(nullLitAbs());
          }
        } catch {
          // skip nodes that fail
        }
      },
    });
  } catch {
    // traverse may fail on partial ASTs
  }
}
