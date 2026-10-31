/**
 * 顶层可调用遍历（body-read-types / interface-draft 共享 walker）。
 *
 * 遍历源文件全部顶层函数（含类方法）：导出声明（`export const` 箭头/函数
 * 表达式、export default）、顶层 class 的实例方法，逐函数回调
 * `visitFn(fnName, fnNode, paramNames)`；解析失败返回 false。
 *
 * 两个消费方的口径差异经 opts 显式表达（保持各自原有行为）：
 * - body-read-types（草稿/quickfix 证据）：含顶层私有 FunctionDeclaration；
 *   不扫 export specifier 引用的 class。
 * - interface-draft（草稿成员读取）：私有函数不进 interface 档（跳过）；扫
 *   `export { Foo }` specifier 引用的本地 class 方法。
 */
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";

export type TopCallableVisitor = (
  fnName: string,
  fnNode: Node,
  paramNames: Set<string>,
) => void;

export type WalkTopCallablesOpts = {
  /** 顶层私有 FunctionDeclaration 也访问（body-read 证据面） */
  includeLocalFunctions?: boolean;
  /** `export { Foo }` specifier 引用的本地 class 方法也访问（interface-draft） */
  visitExportSpecifierClasses?: boolean;
};

/** 遍历源文件全部顶层函数（含类方法），逐函数回调；解析失败返回 false */
export function walkTopCallables(
  source: string,
  visitFn: TopCallableVisitor,
  opts: WalkTopCallablesOpts = {},
): boolean {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source);
  } catch {
    return false;
  }
  const paramSet = (fnNode: Node): Set<string> => {
    const names = new Set<string>();
    const params = (fnNode as { params?: Node[] }).params ?? [];
    for (const p of params) {
      if (!p) continue;
      if (p.type === "Identifier") names.add(p.name);
      else if (p.type === "AssignmentPattern" && (p.left as Node)?.type === "Identifier") {
        names.add((p.left as { name: string }).name);
      } else if (p.type === "RestElement" && (p.argument as Node)?.type === "Identifier") {
        names.add((p.argument as { name: string }).name);
      } else if (p.type === "ObjectPattern") {
        for (const prop of (p as { properties?: Node[] }).properties ?? []) {
          if (prop.type === "ObjectProperty") {
            const v = prop.value as Node;
            if (v.type === "Identifier") names.add(v.name);
            else if (v.type === "AssignmentPattern" && (v.left as Node)?.type === "Identifier") {
              names.add((v.left as { name: string }).name);
            }
          }
        }
      }
    }
    return names;
  };

  const visitClassMethods = (className: string, classNode: Node): void => {
    const body = (classNode as { body?: { body?: Node[] } }).body?.body ?? [];
    for (const m of body) {
      const mem = m as {
        type?: string;
        kind?: string;
        static?: boolean;
        key?: { type?: string; name?: string };
        value?: Node;
      };
      const isMethod =
        mem.type === "MethodDefinition" ||
        mem.type === "ClassMethod" ||
        mem.type === "TSDeclareMethod";
      if (!isMethod || mem.static) continue;
      if (mem.kind && mem.kind !== "method") continue;
      const keyName = mem.key?.type === "Identifier" ? mem.key.name : undefined;
      if (!keyName) continue;
      const methodNode =
        mem.type === "MethodDefinition" ? (mem.value as Node | undefined) : (mem as unknown as Node);
      if (!methodNode) continue;
      visitFn(`${className}.${keyName}`, methodNode, paramSet(methodNode));
    }
  };

  const considerDecl = (decl: Node | null | undefined, exported: boolean): void => {
    if (!decl) return;
    if (decl.type === "FunctionDeclaration" && (decl as { id?: Node }).id) {
      const id = decl.id as { name: string };
      visitFn(id.name, decl, paramSet(decl));
      return;
    }
    if (decl.type === "ClassDeclaration" && (decl as { id?: { name?: string } }).id?.name) {
      visitClassMethods((decl.id as { name: string }).name, decl);
      return;
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of (decl as { declarations?: Array<{ id?: Node; init?: Node }> }).declarations ?? []) {
        const id = d.id;
        const init = d.init;
        if (
          exported &&
          id?.type === "Identifier" &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          visitFn((id as { name: string }).name, init, paramSet(init));
        }
      }
    }
  };

  const program = (ast as { program?: { body?: Node[] } }).program;
  const bodyStmts = program?.body ?? [];
  for (const stmt of bodyStmts) {
    if (stmt.type === "ExportNamedDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
      if (opts.visitExportSpecifierClasses) {
        // export { Foo } → 本地 class 方法 body
        for (const spec of (stmt as { specifiers?: Node[] }).specifiers ?? []) {
          const local = (spec as { local?: { type?: string; name?: string } }).local;
          if (local?.type !== "Identifier") continue;
          for (const s2 of bodyStmts) {
            if (
              s2.type === "ClassDeclaration" &&
              (s2 as { id?: { name?: string } }).id?.name === local.name
            ) {
              visitClassMethods(local.name!, s2);
            }
          }
        }
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
    } else if (stmt.type === "ClassDeclaration") {
      const id = (stmt as { id?: { name?: string } }).id;
      if (id?.name) visitClassMethods(id.name, stmt);
    } else if (stmt.type === "FunctionDeclaration") {
      // 私有函数：body-read 证据面访问；interface 档跳过（草稿同口径）
      if (opts.includeLocalFunctions) considerDecl(stmt, false);
    }
  }
  return true;
}
