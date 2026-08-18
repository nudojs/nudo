import type { Node } from "@babel/types";

/**
 * TS 剥除 pass（Babel typescript 插件 AST → 纯 JS AST）。
 *
 * 为什么放在 parser 层而不是 evaluator 里逐节点 unwrap：
 * parse() 的产物被所有下游消费——CLI resolveModule/generate、service
 * analyzer/case-emitter、LSP server/agent-tools、evaluator 的整条求值链。
 * 在 evaluator 层做 unwrap 只能修一条链，其余消费方（buildModuleGraph 的
 * import 提取、directive 提取、semanticTokens 等）仍会撞上 TS-only 节点。
 * parse() 统一剥除后所有消费方零改动即可分析 .ts 文件。
 *
 * 对纯 JS 源码本 pass 是结构性 no-op（TS-only 节点/字段根本不会出现），
 * 向后兼容；节点均原地改写，loc/start/end 与兄弟节点顺序保持不变
 * （@nudo:case 注释按 comment loc 对齐，删语句只从语句数组中剔除）。
 *
 * 剥除规则：
 *  - 表达式解包：TSAsExpression（含 as const）/ TSSatisfiesExpression /
 *    TSTypeAssertion（<T>x）/ TSNonNullExpression（x!）/ TSInstantiationExpression
 *    （裸泛型引用 const f = foo<number>）→ 直接取 .expression
 *  - 类型声明删除：TSInterfaceDeclaration / TSTypeAliasDeclaration /
 *    TSDeclareFunction / declare 修饰的 TSModuleDeclaration、VariableDeclaration、
 *    ClassDeclaration，以及包装它们的 ExportNamedDeclaration / ExportDefaultDeclaration
 *  - TSEnumDeclaration 直接删除。风险：TS enum 有运行时语义（编译为带反向映射的
 *    对象），删除后源码中 enum 成员引用会退化为 unknown-global 诊断；nudo 的
 *    求值器没有 enum 求值语义，保真合成对象超出本次范围
 *  - type-only import/export：importKind/exportKind === "type" 的声明删除；
 *    值 import 里混入的 type specifier（import { type A, b }）按 specifier 剔除，
 *    全部为 type 时整个声明删除
 *  - 类成员：TSIndexSignature / TSDeclareMethod（含 abstract 方法）/ declare·abstract
 *    的 ClassProperty 删除；implements / superTypeParameters 字段删除
 *  - 求值器不读的类型字段：typeParameters（声明与调用点 TSTypeParameterInstantiation，
 *    即 foo<string>(1)）、typeAnnotation、returnType（含 TSTypePredicate）、
 *    参数 Identifier/ObjectPattern/ArrayPattern/RestElement 上的 optional 一律 delete
 *
 * 已知不处理（会以 unknown 求值，不崩溃）：非 declare 的 namespace（运行时语义）、
 * TSImportEqualsDeclaration（import x = require(...)）、构造器参数属性
 * （constructor(private x)）——均在 .ts 推断目标场景之外。
 */

/** 数组槽位删除哨兵：语句/成员/specifier 只出现在数组上下文中 */
const REMOVE: unique symbol = Symbol("nudo.strip.remove");

/** 不含 AST 子节点的键：位置/注释/打印器元数据 */
const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "extra",
]);

/** 实参/形参模式等数组中的空洞（ArrayPattern 的 elision）保持原样 */
function transformValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const out: unknown[] = [];
    for (const el of value) {
      if (el === null || el === undefined) {
        out.push(el);
        continue;
      }
      const r = transformValue(el);
      if (r === REMOVE) {
        changed = true;
      } else {
        if (r !== el) changed = true;
        out.push(r);
      }
    }
    return changed ? out : value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (typeof (value as { type?: unknown }).type !== "string") return value;
  return transformNode(value as Node & Record<string, unknown>);
}

function isTsDeclareLike(node: Node): boolean {
  return (node as { declare?: unknown }).declare === true;
}

/** 类型声明本身是否 TS-only（供 export 包装语句判断整体删除） */
function isTypeOnlyDeclaration(decl: Node): boolean {
  switch (decl.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSDeclareFunction":
      return true;
    case "VariableDeclaration":
    case "ClassDeclaration":
      return isTsDeclareLike(decl);
    default:
      return false;
  }
}

/**
 * 语句/类成员/specifier 级删除判定（只会在数组上下文中出现，
 * 返回 REMOVE 时父数组剔除该元素）。
 */
function isTypeOnlyStatement(node: Node): boolean {
  const anyNode = node as Node & { importKind?: string; exportKind?: string; specifiers?: unknown[] };
  switch (node.type) {
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSDeclareFunction":
      return true;
    case "TSModuleDeclaration":
      // declare module / declare namespace 纯类型；非 declare 的 namespace 有运行时语义，保留
      return isTsDeclareLike(node);
    case "VariableDeclaration":
    case "ClassDeclaration":
      return isTsDeclareLike(node);
    case "ImportDeclaration":
      if (anyNode.importKind === "type") return true;
      // import { type A, type B } from "m" —— 全 type specifier 则整个 import 无值语义
      {
        const specs = anyNode.specifiers as { importKind?: string }[] | undefined;
        if (specs && specs.length > 0 && specs.every((s) => s.importKind === "type" || s.importKind === "typeof")) {
          return true;
        }
      }
      return false;
    case "ExportNamedDeclaration": {
      if (anyNode.exportKind === "type") return true;
      const decl = (node as { declaration: Node | null }).declaration;
      if (decl && isTypeOnlyDeclaration(decl)) return true;
      // export { type A } / export { type A } from "m"
      {
        const specs = anyNode.specifiers as { exportKind?: string }[] | null;
        if (!decl && specs && specs.length > 0 && specs.every((s) => s.exportKind === "type")) return true;
      }
      return false;
    }
    case "ExportAllDeclaration":
      return anyNode.exportKind === "type";
    case "ExportDefaultDeclaration":
      return isTypeOnlyDeclaration((node as { declaration: Node }).declaration);
    // ---- 类成员 ----
    case "TSIndexSignature":
    case "TSDeclareMethod": // declare / abstract 方法，无运行时实现
      return true;
    case "ClassProperty":
    case "ClassPrivateProperty":
      return isTsDeclareLike(node) || (node as { abstract?: unknown }).abstract === true;
    default:
      return false;
  }
}

/** 求值器不读的类型字段：原地 delete */
function deleteTypeSyntaxFields(node: Node & Record<string, unknown>): void {
  const tp = node.typeParameters as { type?: string } | undefined;
  if (tp && typeof tp.type === "string" && tp.type.startsWith("TSTypeParameter")) {
    // 声明处（TSTypeParameterDeclaration）与调用处（TSTypeParameterInstantiation，
    // 即 foo<string>(1) / new Foo<string>()）一并删除
    delete node.typeParameters;
  }
  const ta = node.typeAnnotation as { type?: string } | undefined;
  if (ta && ta.type === "TSTypeAnnotation") delete node.typeAnnotation;
  const rt = node.returnType as { type?: string } | undefined;
  if (rt && (rt.type === "TSTypeAnnotation" || rt.type === "TSTypePredicate")) delete node.returnType;
  // `a?: T` 的可选标记。只在这些模式节点上删：OptionalMemberExpression 等
  // 表达式节点自己的 optional 语义（a?.b）不属于 TS 语法，不能动
  if (
    node.optional === true &&
    (node.type === "Identifier" || node.type === "ObjectPattern" || node.type === "ArrayPattern" || node.type === "RestElement")
  ) {
    delete node.optional;
  }
  // 类的 implements 子句与继承泛型实参
  if ("implements" in node) delete node.implements;
  if ("superTypeParameters" in node) delete node.superTypeParameters;
}

/** 表达式级解包：类型断言/满足断言/非空断言/裸泛型引用 → 内层表达式 */
function unwrapExpression(node: Node & Record<string, unknown>): Node | null {
  switch (node.type) {
    case "TSAsExpression": // 含 as const
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSNonNullExpression":
    case "TSInstantiationExpression":
      return node.expression as Node;
    default:
      return null;
  }
}

function transformNode(node: Node & Record<string, unknown>): Node | typeof REMOVE {
  if (isTypeOnlyStatement(node)) return REMOVE;

  deleteTypeSyntaxFields(node);

  // 值 import/export 里混入的 type-only specifier 逐个剔除
  if (node.type === "ImportDeclaration") {
    node.specifiers = node.specifiers.filter(
      (s) => !((s as { importKind?: string }).importKind === "type" || (s as { importKind?: string }).importKind === "typeof"),
    );
  } else if (node.type === "ExportNamedDeclaration") {
    if (node.specifiers) {
      node.specifiers = node.specifiers.filter((s) => (s as { exportKind?: string }).exportKind !== "type");
    }
  }

  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (child === null || typeof child !== "object") continue;
    const r = transformValue(child);
    if (r === REMOVE) {
      // 单槽位理论上不会收到 REMOVE（删除项均为数组上下文），防御性清槽
      delete node[key];
    } else {
      node[key] = r;
    }
  }

  return unwrapExpression(node) ?? node;
}

/**
 * 原地剥除 AST 中的 TS-only 语法节点/字段，返回同一棵 AST（便于链式使用）。
 * 不改写任何 loc/start/end；语句删除只影响所在数组，不重排兄弟节点。
 */
export function stripTypes<T extends Node>(ast: T): T {
  transformValue(ast);
  return ast;
}
