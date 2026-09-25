/**
 * Typed Babel AST narrowers / navigation helpers.
 * Replace ad-hoc `as any` property walks in service/lsp with these.
 */
import { isExpression } from "@babel/types";
import type {
  AssignmentExpression,
  ClassBody,
  ExportDefaultSpecifier,
  ExportNamespaceSpecifier,
  ExportSpecifier,
  Expression,
  File,
  Identifier,
  MemberExpression,
  Node,
  Program,
  Statement,
  VariableDeclarator,
} from "@babel/types";

/** File → its Program; Program → itself. Replaces `(ast as File).program ?? ast`. */
export function asProgram(ast: Node | File | Program | null | undefined): Program | undefined {
  if (!ast) return undefined;
  if (ast.type === "File") return ast.program;
  if (ast.type === "Program") return ast;
  return undefined;
}

/** Top-level statements of a File/Program (empty when neither). */
export function programBody(ast: Node | File | Program | null | undefined): Statement[] {
  return asProgram(ast)?.body ?? [];
}

export function asIdentifier(node: Node | null | undefined): Identifier | undefined {
  return node?.type === "Identifier" ? node : undefined;
}

export function asExpression(node: Node | null | undefined): Expression | undefined {
  return node && isExpression(node) ? node : undefined;
}

export function asAssignmentExpression(
  node: Node | null | undefined,
): AssignmentExpression | undefined {
  return node?.type === "AssignmentExpression" ? node : undefined;
}

/** Identifier.name, else StringLiteral.value (module string export names). */
export function nameOrStringValue(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "StringLiteral") return node.value;
  return undefined;
}

/** Identifier.name only (undefined for string export names). */
export function identifierName(node: Node | null | undefined): string | undefined {
  return node?.type === "Identifier" ? node.name : undefined;
}

/** VariableDeclaration.declarations; empty for other nodes. */
export function getDeclarations(node: Node | null | undefined): VariableDeclarator[] {
  return node?.type === "VariableDeclaration" ? node.declarations : [];
}

/** First declarator's init (fn-binding extraction). */
export function getDeclaratorInit(node: Node | null | undefined): Expression | undefined {
  const decl = node?.type === "VariableDeclarator" ? node : undefined;
  return decl?.init ?? undefined;
}

/** First declarator of a VariableDeclaration, narrowed to Identifier id. */
export function getFirstDeclaratorId(node: Node | null | undefined): Identifier | undefined {
  const decl = getDeclarations(node)[0];
  return decl?.id.type === "Identifier" ? decl.id : undefined;
}

/** VariableDeclarator id narrowed to Identifier. */
export function getDeclaratorId(node: Node | null | undefined): Identifier | undefined {
  const decl = node?.type === "VariableDeclarator" ? node : undefined;
  return decl?.id.type === "Identifier" ? decl.id : undefined;
}

/** Inner declaration of `export default` / `export …` (undefined for other nodes). */
export function getExportDeclaration(node: Node | null | undefined): Node | undefined {
  if (!node) return undefined;
  if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
    return node.declaration ?? undefined;
  }
  return undefined;
}

/**
 * Unwrap an export form: named/default exports yield their inner declaration
 * with `exported: true`; any other statement is returned as-is with `exported: false`.
 */
export function unwrapExport(node: Node | null | undefined): { declaration: Node; exported: boolean } {
  if (node?.type === "ExportNamedDeclaration" && node.declaration) {
    return { declaration: node.declaration, exported: true };
  }
  if (node?.type === "ExportDefaultDeclaration") {
    return { declaration: node.declaration, exported: true };
  }
  return { declaration: node as Node, exported: false };
}

/** ExportNamedDeclaration.specifiers (empty for other nodes). */
export function getExportSpecifiers(
  node: Node | null | undefined,
): (ExportSpecifier | ExportDefaultSpecifier | ExportNamespaceSpecifier)[] {
  return node?.type === "ExportNamedDeclaration" ? node.specifiers : [];
}

/** ExportSpecifier local name — Identifier only (matches `local.name`). */
export function exportSpecifierLocalName(spec: Node | null | undefined): string | undefined {
  return spec?.type === "ExportSpecifier" ? identifierName(spec.local) : undefined;
}

/** ExportSpecifier exported name (`exported.name ?? exported.value`). */
export function exportSpecifierExportedName(
  spec: Node | null | undefined,
): string | number | undefined {
  if (spec?.type !== "ExportSpecifier") return undefined;
  const exported = spec.exported;
  return exported.type === "Identifier" ? exported.name : exported.value;
}

/** ExpressionStatement.expression. */
export function getExpressionStatementExpression(
  node: Node | null | undefined,
): Expression | undefined {
  return node?.type === "ExpressionStatement" ? node.expression : undefined;
}

/** Function/Class declaration or expression `id?.name`. */
export function fnOrClassIdName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression" ||
    node.type === "TSDeclareFunction"
  ) {
    return node.id?.name;
  }
  return undefined;
}

/** ClassDeclaration/ClassExpression `id?.name`. */
export function classIdName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    return node.id?.name;
  }
  return undefined;
}

/** `id.loc` of a named function/class (undefined when anonymous or unlocated). */
export function fnOrClassIdLoc(node: Node | null | undefined): Node["loc"] {
  if (!node) return undefined;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression" ||
    node.type === "TSDeclareFunction"
  ) {
    return node.id?.loc ?? undefined;
  }
  return undefined;
}

/** Non-computed member property key text (Identifier.name or StringLiteral.value). */
export function memberPropertyKey(member: Node | null | undefined): string | null {
  if (member?.type !== "MemberExpression" || member.computed) return null;
  return nameOrStringValue(member.property) ?? null;
}

/** Identifier name of a non-computed member's object (e.g. `module` in `module.exports`). */
export function memberObjectName(member: Node | null | undefined): string | undefined {
  if (member?.type !== "MemberExpression") return undefined;
  return identifierName(member.object as Node);
}

/** Identifier name of a non-computed member's property (e.g. `exports`). */
export function memberPropertyName(member: Node | null | undefined): string | undefined {
  if (member?.type !== "MemberExpression" || member.computed) return undefined;
  return identifierName(member.property);
}

/** `module.exports` / `module["exports"]` is rejected here: computed keys return false. */
export function isModuleExportsMember(member: Node | null | undefined): boolean {
  return memberObjectName(member) === "module" && memberPropertyName(member) === "exports";
}

export function asMemberExpression(
  node: Node | null | undefined,
): MemberExpression | undefined {
  return node?.type === "MemberExpression" ? node : undefined;
}

/** Class body members; empty when node is not a class. */
export function getClassMembers(node: Node | null | undefined): ClassBody["body"] {
  if (
    node?.type === "ClassDeclaration" ||
    node?.type === "ClassExpression"
  ) {
    return node.body.body;
  }
  return [];
}

/**
 * `key.name ?? key.value` on a class/object member key.
 * Handles Identifier / StringLiteral / NumericLiteral and ESTree-shaped keys.
 */
export function classMemberKeyName(member: Node | null | undefined): string | number | undefined {
  const key = (member as { key?: { name?: string; value?: string | number } | null } | null | undefined)?.key;
  return key?.name ?? key?.value;
}

/** Key node of a class member (for range selection). */
export function classMemberKey(member: Node | null | undefined): Node | undefined {
  return (member as { key?: Node | null } | null | undefined)?.key ?? undefined;
}

type LooseClassMember = {
  type?: string;
  kind?: string | null;
  static?: boolean;
  key?: { type?: string; name?: string; value?: string | number } | null;
  value?: Node | null;
};

export type InstanceMethod = { name: string; node: Node };

/**
 * Instance methods of a class-like node. Accepts Babel `ClassMethod` /
 * `TSDeclareMethod` and ESTree `MethodDefinition` (whose function lives in `value`).
 * Skips getters/setters/constructors and static members.
 */
export function classInstanceMethods(node: Node | null | undefined): InstanceMethod[] {
  const out: InstanceMethod[] = [];
  for (const raw of getClassMembers(node)) {
    const m = raw as unknown as LooseClassMember;
    const isMethod =
      m.type === "MethodDefinition" || m.type === "ClassMethod" || m.type === "TSDeclareMethod";
    if (!isMethod) continue;
    if (m.kind && m.kind !== "method") continue;
    if (m.static) continue;
    const keyName = m.key?.type === "Identifier" ? m.key.name : undefined;
    if (!keyName) continue;
    const methodNode = m.type === "MethodDefinition" ? (m.value ?? undefined) : (raw as Node);
    if (!methodNode) continue;
    out.push({ name: keyName, node: methodNode });
  }
  return out;
}

/** Class/TSDeclare method function node (ESTree MethodDefinition → its `value`). */
export function methodFunctionNode(member: Node | null | undefined): Node | undefined {
  const m = (member as unknown as LooseClassMember | null | undefined);
  if (!m) return undefined;
  return m.type === "MethodDefinition" ? (m.value ?? undefined) : (member as Node);
}

/**
 * Parameter display label: `name`, `...rest`, or `_`.
 * Non-identifier rest arguments keep the historical `...undefined` string form.
 */
export function paramDisplayName(param: Node | null | undefined): string {
  if (!param) return "_";
  if (param.type === "Identifier") return param.name;
  if (param.type === "RestElement") {
    const arg = param.argument as { name?: string };
    return `...${arg.name}`;
  }
  return "_";
}

/** RestElement argument name, else plain Identifier name. */
export function paramName(param: Node | null | undefined): string | undefined {
  if (!param) return undefined;
  if (param.type === "Identifier") return param.name;
  if (param.type === "RestElement") return identifierName(param.argument as Node);
  return undefined;
}

/** CJS/ESM default interop: callable module or `{ default }` wrapper. */
export function unwrapDefaultExport<T>(mod: T | { default: T }): T {
  if (typeof mod === "function") return mod as T;
  return (mod as { default: T }).default;
}
