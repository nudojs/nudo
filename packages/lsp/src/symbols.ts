/**
 * 文档符号 + 跨文件导航（definition / references / rename）。
 * 本文件只做 AST 静态扫描；fs 解析走 service 的相对路径规则。
 */
import type { Node, Identifier, FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, ClassDeclaration, ClassMethod, ObjectMethod, TSDeclareMethod } from "@babel/types";
import traverse from "@babel/traverse";
import { traverseEsm } from "./traverse-esm.ts";
import {
  parse,
  programBody,
  unwrapExport,
  getDeclarations,
  getDeclaratorId,
  getDeclaratorInit,
  fnOrClassIdName,
  getClassMembers,
  classMemberKeyName,
  classMemberKey,
  paramDisplayName,
  exportSpecifierExportedName,
  nameOrStringValue,
} from "@nudojs/parser";
import type { SymbolInfo, ReferenceInfo, SymbolTable, SourceLocation } from "@nudojs/service";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sidecarPathOf } from "@nudojs/core";

function locFromNode(node: Node): SourceLocation {
  return {
    start: { line: node.loc?.start.line ?? 1, column: node.loc?.start.column ?? 0 },
    end: { line: node.loc?.end.line ?? 1, column: node.loc?.end.column ?? 0 },
  };
}

function traverseFn(): typeof traverse {
  return traverseEsm();
}

// ---------------------------------------------------------------------------
// 作用域 / 位置元数据（符号表遮蔽判定 + rename 编辑协议合法性）
// ---------------------------------------------------------------------------

/** 作用域范围（babel scope block 的源码范围；行 1-based / 列 0-based） */
export type ScopeRange = {
  start: { line: number; column: number };
  end: { line: number; column: number };
  /** 是否是模块（Program）作用域 */
  program?: boolean;
};

/**
 * 位置附加元数据。
 *
 * service 的 `SourceLocation` 是冻结面（公共 API），但 LSP 需要在**位置**上挂
 * 「这条引用属于哪个作用域」「这是不是简写属性的 key」「这条引用在源码里占几列」。
 * server 侧按引用传递 loc 对象（`loc: ref.loc`），因此这些字段能一路活到
 * `buildRenameEdits`。
 */
export type LocMeta = {
  /** 所属作用域的范围：遮蔽（同名不同作用域）判定用 */
  scope?: ScopeRange;
  /** 简写属性（`{ x }`）的 key 文本：改名保留 key（`{ x }` → `{ x: y }`） */
  shorthandKey?: string;
  /** 引用位在源码里的列跨度：编辑范围不得宽于一个标识符 */
  srcWidth?: number;
  /**
   * 「导出名身份」的**本地名**（`export { hidden as visible }` 里的 `visible`）。
   *
   * 别名导出把**两个身份**压进了同一个说明符：本地名 `hidden`（本地绑定）
   * 与导出名 `visible`（本模块对外的名字）。带上这个字段 ⇒ 符号表能分辨
   * 「这条定义是**导出名**」⇒ 跨文件匹配按**导出名**走、改名编辑集按
   * **导出名**收集（Bug 1066）。
   */
  exportLocalName?: string;
};

/** 带元数据的位置（service 的 SourceLocation + LSP 私有元数据） */
export type MetaLoc = SourceLocation & LocMeta;

function metaLoc(loc: SourceLocation, meta: LocMeta): MetaLoc {
  return { ...loc, ...meta };
}

/** 读位置上的元数据（loc 可能是普通 SourceLocation —— 元数据可选） */
function metaOf(loc: SourceLocation | undefined): LocMeta {
  return (loc ?? {}) as MetaLoc;
}

/** 标识符在源码里的列跨度（跨行 / 无 loc ⇒ undefined） */
function srcWidthOf(node: Node | null | undefined): number | undefined {
  const loc = node?.loc;
  if (!loc) return undefined;
  if (loc.start.line !== loc.end.line) return undefined;
  return loc.end.column - loc.start.column;
}

/** babel scope block 的源码范围 */
function scopeRangeOf(scope: { block?: Node | null } | null | undefined): ScopeRange | undefined {
  const block = scope?.block;
  if (!block?.loc) return undefined;
  return {
    start: { line: block.loc.start.line, column: block.loc.start.column },
    end: { line: block.loc.end.line, column: block.loc.end.column },
    program: block.type === "Program",
  };
}

/** 位置是否落在范围内 */
function inRange(
  range: ScopeRange | undefined,
  at: { line: number; column: number } | undefined,
): boolean {
  if (!range || !at) return false;
  const afterStart =
    at.line > range.start.line ||
    (at.line === range.start.line && at.column >= range.start.column);
  const beforeEnd =
    at.line < range.end.line ||
    (at.line === range.end.line && at.column <= range.end.column);
  return afterStart && beforeEnd;
}

/** inner 是否整体落在 outer 里（作用域包含判定） */
function rangeContains(outer: ScopeRange | undefined, inner: ScopeRange | undefined): boolean {
  if (!outer || !inner) return false;
  return inRange(outer, inner.start) && inRange(outer, inner.end);
}

/** 范围大小（内层作用域优先的比较基准） */
function rangeSize(range: ScopeRange | undefined): number {
  if (!range) return Number.MAX_SAFE_INTEGER;
  return (
    (range.end.line - range.start.line) * 1_000_000 + (range.end.column - range.start.column)
  );
}

/**
 * 简写属性（`{ x }`）的 key 文本。
 *
 * `{ x }` 的 key 与 value 是**两个节点、同一段源码**（babel 8）⇒ 直接把这段
 * 源码替换成新名字会把 **key** 也改掉（对象形状被静默改掉）。改名必须走
 * 「key: value」形态 ⇒ 这里给出 key 文本，由 buildRenameEdits 生成 `x: <新名>`。
 */
function shorthandKeyOf(parent: Node | null | undefined, node: Node): string | undefined {
  const p = parent as
    | { type?: string; shorthand?: boolean; key?: { name?: string } }
    | null
    | undefined;
  if (!p || p.type !== "ObjectProperty" || p.shorthand !== true) return undefined;
  return p.key?.name ?? (node as { name?: string }).name;
}

/**
 * 绑定**声明位**是不是简写属性的 value：`function f({ x })` / `const { x } = o;`
 * —— 这里的 key 是被解构出来的属性名，改名必须保留 key（`{ x: y }`）。
 */
function shorthandKeyOfBinding(binding: {
  identifier?: Node;
  path?: { node?: Node };
}): string | undefined {
  const id = binding.identifier;
  if (!id) return undefined;
  const decl = binding.path?.node as
    | {
        type?: string;
        id?: { type?: string };
        properties?: Array<{ key?: { name?: string }; value?: Node; shorthand?: boolean }>;
      }
    | undefined;
  if (!decl) return undefined;
  let pattern:
    | { properties?: Array<{ key?: { name?: string }; value?: Node; shorthand?: boolean }> }
    | undefined;
  if (decl.type === "ObjectPattern") {
    pattern = decl as never;
  } else if (decl.type === "VariableDeclarator" && decl.id?.type === "ObjectPattern") {
    pattern = decl.id as never;
  }
  for (const prop of pattern?.properties ?? []) {
    if (prop.value === id && prop.shorthand === true) {
      return prop.key?.name ?? (id as { name?: string }).name;
    }
  }
  return undefined;
}

/**
 * 绑定标识符判定：rename/references 只动**绑定**，不动属性名。
 * 金标语义（refactor-gold）：
 * - `obj.x` 非 computed 的 `x` 不是绑定
 * - `{ x: 1 }` 非 shorthand 的 key 不是绑定；`{ x }` shorthand 是绑定
 * - class/object method/property 非 computed 的 key 不是绑定
 * - label 不是绑定
 * - import local 是定义；`import { a as b }` 的 `a`（imported）不是
 * - export `{ a as b }` 的 `b`（exported）不是本地绑定
 */
export function isBindingIdentifier(path: {
  node: Node;
  parent: Node | null;
  parentPath?: unknown;
  key?: string | number | null;
}): boolean {
  const node = path.node as { type: string; name?: string };
  if (node.type !== "Identifier") return false;
  const parent = path.parent as
    | (Node & {
        type: string;
        key?: Node;
        value?: Node;
        property?: Node;
        computed?: boolean;
        shorthand?: boolean;
        local?: Node;
        imported?: Node;
        exported?: Node;
        label?: Node;
      })
    | null;
  if (!parent) return true;

  const isSelf = (n?: Node | null): boolean => n === path.node;

  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      // obj.x — property 非 computed 不是绑定；obj[x] 的 x 是
      if (isSelf(parent.property) && parent.computed !== true) return false;
      return true;
    case "ObjectProperty":
    case "ObjectMethod":
    case "ClassMethod":
    case "ClassProperty":
    case "ClassPrivateProperty":
    case "ClassPrivateMethod":
    case "TSDeclareMethod":
      if (isSelf(parent.key) && parent.computed !== true) {
        // shorthand `{ x }`：key 与 value 同名绑定，可改名
        return parent.type === "ObjectProperty" && parent.shorthand === true;
      }
      return true;
    case "PrivateName":
      // 私有成员（`#name`）：**不是**普通绑定。
      // 它的身份是 `#name`（带 `#`），由符号表按「类作用域 + `#` 前缀」单独
      // 登记（见 buildSymbolTable 的 ClassPrivateMethod / ClassPrivateProperty
      // 访问器）⇒ 这里若放行，`#total` 会被当成普通标识符 `total`
      // ⇒ 命中同名的模块级绑定（跨文件毁掉无关导出， Bug 1007）。
      return false;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return false;
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      // 仅 local 是绑定定义
      return isSelf((parent as { local?: Node }).local);
    case "ExportSpecifier":
      // export { local as exported } — 只有 local 是引用
      return isSelf((parent as { local?: Node }).local);
    case "ExportDefaultDeclaration":
      return true;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      // id / params 在下层作为定义登记；这里放行进 references 由调用方去重
      return true;
    default:
      return true;
  }
}

function registerParam(
  register: (name: string, kind: SymbolInfo["kind"], node: Node) => void,
  param: Node | null | undefined,
  kind: SymbolInfo["kind"] = "variable",
): void {
  if (!param) return;
  const p = param as {
    type: string;
    name?: string;
    id?: Node;
    left?: Node;
    properties?: Array<{ key?: Node; value?: Node; computed?: boolean; shorthand?: boolean }>;
    elements?: Array<Node | null>;
  };
  if (p.type === "Identifier" && p.name) {
    register(p.name, kind, param);
  } else if (p.type === "AssignmentPattern") {
    registerParam(register, p.left, kind);
  } else if (p.type === "RestElement") {
    registerParam(register, (p as { argument?: Node }).argument, kind);
  } else if (p.type === "ObjectPattern") {
    for (const prop of p.properties ?? []) {
      registerParam(register, prop.value ?? prop.key, kind);
    }
  } else if (p.type === "ArrayPattern") {
    for (const el of p.elements ?? []) {
      registerParam(register, el, kind);
    }
  }
}

/** 符号表登记回调（见 {@link buildSymbolTable}） */
type RegisterFn = (
  name: string,
  kind: SymbolInfo["kind"],
  node: Node,
  scope: ScopeRange | undefined,
  extra?: LocMeta,
) => void;

/** 向上找所属类节点（ClassDeclaration / ClassExpression） */
function enclosingClassNode(path: {
  parentPath?: { node?: Node | null; parentPath?: unknown } | null;
}): Node | null {
  let cur: { node?: Node | null; parentPath?: unknown } | null | undefined = path.parentPath;
  while (cur) {
    const node = cur.node;
    if (node?.type === "ClassDeclaration" || node?.type === "ClassExpression") return node;
    cur = cur.parentPath as typeof cur;
  }
  return null;
}

/**
 * 私有成员所属**类**的作用域范围。
 *
 * 私有名（`#name`）只在自己类体里可见 ⇒ 作用域 = 所属类（不是模块作用域）。
 */
function privateMemberScopeRange(path: {
  parentPath?: { node?: Node | null; parentPath?: unknown } | null;
}): ScopeRange | undefined {
  const classNode = enclosingClassNode(path);
  if (!classNode?.loc) return undefined;
  return scopeRangeOf({ block: classNode });
}

/** PrivateName 是不是某个类成员的**声明位**（`#total() {}` / `#field = 1`） */
function isPrivateMemberDeclaration(path: {
  parentPath?: { node?: { type?: string } | null } | null;
}): boolean {
  const parent = path.parentPath?.node;
  return parent?.type === "ClassPrivateMethod" || parent?.type === "ClassPrivateProperty";
}

/**
 * 私有成员（`#name`）的**身份**登记（Bug 1007）。
 *
 * 身份 = `#name`（**带 `#`**）⇒ 与同名的模块级绑定在**名字层面**就分开；
 * 声明位 = 私有名里的标识符（`#total` 的 `total` 那一段，不含 `#`）
 * ⇒ 改名只替换标识符、`#` 保留。
 */
function registerPrivateMember(
  register: RegisterFn,
  path: {
    node: { key?: Node | null };
    parentPath?: { node?: Node | null; parentPath?: unknown } | null;
  },
  kind: SymbolInfo["kind"] = "variable",
): void {
  const key = path.node.key as { type?: string; id?: Node } | null | undefined;
  if (!key || key.type !== "PrivateName" || !key.id) return;
  const name = (key.id as { name?: string }).name;
  if (!name) return;
  register(`#${name}`, kind, key.id, privateMemberScopeRange(path));
}

export function buildSymbolTable(ast: Node, uri: string): SymbolTable {
  const definitions = new Map<string, SymbolInfo>();
  const references: ReferenceInfo[] = [];

  /**
   * 登记定义。
   *
   * 同名绑定在不同作用域**各存一条**（键 = 作用域路径 `name@行:列`）⇒
   * 遮蔽（同名局部变量）不再互相覆盖；另有一条 plain-name 兜底条目
   * （程序作用域优先，否则源码序第一条）供无位置信息的调用方使用。
   */
  const register = (
    name: string,
    kind: SymbolInfo["kind"],
    node: Node,
    scope: ScopeRange | undefined,
    extra?: LocMeta,
  ): void => {
    const loc = metaLoc(locFromNode(node), { scope, srcWidth: srcWidthOf(node), ...extra });
    const info: SymbolInfo = { name, kind, loc, uri };
    // 同作用域内后声明不覆盖先声明
    const key = scope ? `${name}@${scope.start.line}:${scope.start.column}` : `${name}@?`;
    if (!definitions.has(key)) definitions.set(key, info);
    // plain-name 兜底：程序作用域优先；否则先声明者优先
    const plain = definitions.get(name);
    if (!plain) {
      definitions.set(name, info);
      return;
    }
    const plainScope = metaOf(plain.loc).scope;
    const plainProgram = plainScope?.program === true;
    const thisProgram = scope?.program === true;
    if (plainProgram && !thisProgram) return;
    if (!plainProgram && thisProgram) definitions.set(name, info);
  };

  try {
    traverseFn()(ast, {
      FunctionDeclaration(path) {
        if (path.node.id) {
          // 函数名的绑定在**外层**作用域（函数自己的作用域是它的体）
          register(path.node.id.name, "function", path.node.id, scopeRangeOf(path.scope.parent));
        }
        for (const param of path.node.params ?? []) {
          registerParam(
            (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
            param,
          );
        }
      },
      FunctionExpression(path) {
        if (path.node.id) {
          register(path.node.id.name, "function", path.node.id, scopeRangeOf(path.scope.parent));
        }
        for (const param of path.node.params ?? []) {
          registerParam(
            (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
            param,
          );
        }
      },
      ArrowFunctionExpression(path) {
        for (const param of path.node.params ?? []) {
          registerParam(
            (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
            param,
          );
        }
      },
      // 类方法形参（Bug 1010）：此前访问器清单只覆盖三种函数 ⇒ 类方法形参
      // 不进 definitions ⇒ `definition` 返回 null，而同一位置的 `references`
      // 却返回声明位点（同一个 LSP、同一坐标、两个面自相矛盾）。
      ClassMethod(path) {
        for (const param of path.node.params ?? []) {
          registerParam(
            (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
            param,
          );
        }
      },
      // 对象字面量方法形参（Bug 1010）
      ObjectMethod(path) {
        for (const param of path.node.params ?? []) {
          registerParam(
            (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
            param,
          );
        }
      },
      // 私有方法：形参 + **私有成员身份**（Bug 1007 / 1010）
      ClassPrivateMethod(path) {
        for (const param of path.node.params ?? []) {
          registerParam(
            (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
            param,
          );
        }
        registerPrivateMember(register, path, "function");
      },
      // 私有字段（无形参）：登记**私有成员身份**（Bug 1007）
      ClassPrivateProperty(path) {
        registerPrivateMember(register, path, "variable");
      },
      // `catch (e)` 的形参（Bug 1010）：作用域 = **CatchClause 自身作用域**
      // （babel 的 catch 形参绑定在 catch 块里，不是外层作用域）
      CatchClause(path) {
        registerParam(
          (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
          path.node.param,
        );
      },
      VariableDeclarator(path) {
        if (path.node.id.type === "Identifier") {
          register(path.node.id.name, "variable", path.node.id, scopeRangeOf(path.scope));
        } else {
          registerParam(
            (n, k, node) => register(n, k, node, scopeRangeOf(path.scope)),
            path.node.id,
          );
        }
      },
      ClassDeclaration(path) {
        if (path.node.id) {
          register(path.node.id.name, "class", path.node.id, scopeRangeOf(path.scope.parent));
        }
      },
      ClassExpression(path) {
        if (path.node.id) {
          register(path.node.id.name, "class", path.node.id, scopeRangeOf(path.scope.parent));
        }
      },
      ImportDeclaration(path) {
        for (const spec of path.node.specifiers ?? []) {
          register(spec.local.name, "variable", spec.local, scopeRangeOf(path.scope));
        }
      },
      /**
       * 本地 export list（`export { a }` / `export { a as b }`）：**导出名**是
       * 一个**独立身份**（Bug 1066）。
       *
       * `export { hidden as visible }` 里 `hidden`（本地绑定）与 `visible`
       * （本模块对外的名字）是**两个符号**：改导出名要连 importer 的 imported
       * 侧一起改，改本地名**不得**连坐（否则模块图断裂）。
       * ⇒ 导出名按自己的名字登记成一条定义，并带上本地名（`exportLocalName`）。
       */
      ExportNamedDeclaration(path) {
        // re-export（`export { a } from "./m"`）不绑本地名 ⇒ 不是本地定义
        if (path.node.source) return;
        for (const spec of path.node.specifiers ?? []) {
          if (spec.type !== "ExportSpecifier") continue;
          const exported = exportSpecifierExportedName(spec);
          if (exported === undefined) continue;
          const local = nameOrStringValue(spec.local);
          if (!local) continue;
          const exportedName = String(exported);
          // 同名直出（`export { a }`）⇒ 导出名 == 本地名 ⇒ 本地绑定那条定义
          // 已经是它的声明位（先声明者优先），这里**不重复登记**
          if (exportedName === local) continue;
          register(exportedName, "variable", spec.exported, scopeRangeOf(path.scope), {
            exportLocalName: local,
          });
        }
      },
      /**
       * 私有成员用点位（`this.#total()`）：身份 = `#total`（带 `#`）。
       *
       * 私有成员**只在所属类体里可见** ⇒ 作用域 = 所属类；名字带 `#` ⇒ 与
       * 同名的模块级绑定**在名字层面**就分开了（Bug 1007）。
       */
      PrivateName(path) {
        const id = path.node.id;
        if (!id?.name) return;
        // 声明位（`#total() {}`）由 ClassPrivateMethod / ClassPrivateProperty
        // 访问器登记 ⇒ 这里只收**用点**
        if (isPrivateMemberDeclaration(path)) return;
        const scope = privateMemberScopeRange(path);
        references.push({
          name: `#${id.name}`,
          loc: metaLoc(locFromNode(id), { scope, srcWidth: srcWidthOf(id) }),
          uri,
        });
      },
      Identifier(path) {
        // 定义位点不进 references（decl 由 resolveReferences/includeDeclaration 负责）
        if (path.parentPath?.node.type === "FunctionDeclaration" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "FunctionExpression" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "VariableDeclarator" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "ClassDeclaration" && path.parentPath.node.id === path.node) return;
        if (path.parentPath?.node.type === "ClassExpression" && path.parentPath.node.id === path.node) return;
        // 解构模式里的简写属性（`function f({ x })`）：key 与 value 都是**声明位**
        if (path.parentPath?.node.type === "ObjectProperty") {
          const prop = path.parentPath.node as unknown as { shorthand?: boolean; value?: Node };
          if (prop.shorthand === true && path.parentPath.parentPath?.node.type === "ObjectPattern") {
            return;
          }
        }

        if (!isBindingIdentifier(path)) return;

        const loc = metaLoc(locFromNode(path.node), {
          scope: scopeRangeOf(path.scope),
          srcWidth: srcWidthOf(path.node),
        });
        // 同一段源码只记一次（`{ x }` 的 key 与 value 同位）
        const last = references[references.length - 1];
        if (
          last &&
          last.name === path.node.name &&
          last.loc.start.line === loc.start.line &&
          last.loc.start.column === loc.start.column
        ) {
          return;
        }
        references.push({
          name: path.node.name,
          loc,
          uri,
        });
      },
    });
  } catch {
    // traverse may fail on partial ASTs
  }

  return { definitions, references };
}

/**
 * 私有成员（`#name`）的同绑定引用（Bug 1007）。
 *
 * babel 的 scope **不登记私有名**（`scope.getBinding("#x")` 恒为 undefined）
 * ⇒ 不能走通用绑定路径。私有名的可见性 = **所属类体** ⇒ 引用集合 = 同一个类里
 * 所有同名私有名（声明位 + 用点位），且**永不跨文件**。
 *
 * 引用位 = 私有名里的**标识符**（`#total` 的 `total` 那一段，不含 `#`）
 * ⇒ 改名只替换标识符、`#` 保留。
 */
function collectPrivateMemberReferences(
  ast: Node,
  memberName: string,
  at: { line: number; column: number },
  uri: string,
  options: { includeDeclaration?: boolean },
): ReferenceInfo[] {
  const includeDecl = options.includeDeclaration !== false;
  const bare = memberName.startsWith("#") ? memberName.slice(1) : memberName;
  const out: ReferenceInfo[] = [];
  // ① 光标处的私有成员 → 所属类
  const hit: { owner: Node | null } = { owner: null };
  try {
    traverseFn()(ast, {
      PrivateName(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === at.line &&
          loc.start.column <= at.column &&
          loc.end.column >= at.column
        ) {
          hit.owner = enclosingClassNode(path);
          path.stop();
        }
      },
    });
  } catch {
    /* partial AST */
  }
  const owner = hit.owner;
  if (!owner) return out;
  const scope = scopeRangeOf({ block: owner });
  // ② 同一个类里所有同名私有名
  try {
    traverseFn()(ast, {
      PrivateName(path) {
        const id = path.node.id;
        if (!id?.name || id.name !== bare) return;
        if (enclosingClassNode(path) !== owner) return;
        if (isPrivateMemberDeclaration(path) && !includeDecl) return;
        out.push({
          name: memberName,
          loc: metaLoc(locFromNode(id), { scope, srcWidth: srcWidthOf(id) }),
          uri,
        });
      },
    });
  } catch {
    /* partial AST */
  }
  return out;
}

/**
 * 作用域感知的同绑定引用（重构金标核心）：
 * 从 (line, column) 处的标识符解析 babel binding，只收集**同一绑定**的
 * 引用与声明。属性名/成员属性/遮蔽的同名绑定不会被带入。
 *
 * `includeDeclaration`（默认 true）控制**声明位**是否计入 —— LSP 的
 * `textDocument/references` 用 `context.includeDeclaration` 表达同一语义
 * （false ⇒ 只返回用点，不含声明位）。
 */
export function collectBindingReferences(
  ast: Node,
  name: string,
  at: { line: number; column: number },
  uri: string,
  options: { includeDeclaration?: boolean } = {},
): ReferenceInfo[] {
  // 私有成员（`#name`）：babel 的 scope **不登记私有名** ⇒ 没有 binding 可查
  // ⇒ 走「类内收集」专用路径（Bug 1007）
  if (name.startsWith("#")) {
    return collectPrivateMemberReferences(ast, name, at, uri, options);
  }
  const includeDecl = options.includeDeclaration !== false;
  const out: ReferenceInfo[] = [];
  const seen = new Set<string>();
  const push = (node: Node, extra?: LocMeta): void => {
    const loc = locFromNode(node);
    const key = `${loc.start.line}:${loc.start.column}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name,
      loc: metaLoc(loc, { srcWidth: srcWidthOf(node), ...extra }),
      uri,
    });
  };

  try {
    traverseFn()(ast, {
      Program(path) {
        // 定位触点 → binding
        let target: { node: Node; scope: { getBinding(n: string): { identifier: Node; referencePaths: unknown[] } | undefined } } | null =
          null;
        path.traverse({
          Identifier(p) {
            const loc = p.node.loc;
            if (!loc) return;
            if (
              loc.start.line === at.line &&
              loc.start.column <= at.column &&
              loc.end.column >= at.column &&
              p.node.name === name
            ) {
              if (isBindingIdentifier(p)) {
                target = { node: p.node, scope: p.scope };
              }
              p.stop();
            }
          },
        });
        if (!target) {
          path.stop();
          return;
        }
        const binding = (target as { scope: { getBinding(n: string): { identifier: Node; referencePaths: unknown[] } | undefined } })
          .scope.getBinding(name);
        if (!binding) {
          // 未解析绑定（global / 部分语法）：退回名称匹配但已过滤属性键
          path.traverse({
            Identifier(p) {
              if (p.node.name !== name || !isBindingIdentifier(p)) return;
              const shorthandKey = shorthandKeyOf(p.parent, p.node);
              push(p.node, shorthandKey ? { shorthandKey } : undefined);
            },
          });
          path.stop();
          return;
        }
        // 声明位（includeDeclaration=false 时不计入）
        if (includeDecl) {
          const shorthandKey = shorthandKeyOfBinding(binding as never);
          push(binding.identifier, shorthandKey ? { shorthandKey } : undefined);
        }
        for (const ref of binding.referencePaths as Array<{
          node: Node;
          parentPath?: { node?: Node };
        }>) {
          const node = ref?.node;
          // 只收**标识符**节点：babel 会把 ExportNamedDeclaration **语句节点**
          // 放进导出绑定的 referencePaths —— 直接当编辑目标会产出「整条
          // `export function …` 声明被替换成一个标识符」的协议非法编辑
          // （且与声明位的编辑互相重叠）。
          if (!node || node.type !== "Identifier") continue;
          const shorthandKey = shorthandKeyOf(ref.parentPath?.node ?? null, node);
          push(node, shorthandKey ? { shorthandKey } : undefined);
        }
        // assignment / constant violation 也改名
        const pv = binding as unknown as {
          constantViolations?: Array<{ node: Node }>;
        };
        for (const v of pv.constantViolations ?? []) {
          if (v?.node?.type === "Identifier") push(v.node);
          else if (v?.node) {
            // AssignmentExpression left
            const left = (v.node as { left?: Node }).left;
            if (left?.type === "Identifier") push(left);
          }
        }
        path.stop();
      },
    });
  } catch {
    /* partial AST */
  }
  return out;
}

/** prepareRename 目标：绑定标识符，或 class/object 方法 / getter / setter 键 */
export type RenameTarget = {
  name: string;
  loc: SourceLocation;
  /**
   * 目标类别：
   * - `binding`：普通绑定标识符；
   * - `method`：class/object 方法键（按**归属**分派，name-based）；
   * - `private`：私有成员（`#name`）—— 身份带 `#`，只在所属类内可见；
   * - `export`：本地 export list 的**导出名**（`export { a as b }` 的 b）。
   */
  kind: "binding" | "method" | "private" | "export";
  /**
   * 方法归属（kind === "method" 时给出）：类方法 → 所属类；对象字面量方法 → 绑定变量名。
   *
   * 「同名」不等于「同一个符号」：两个类可以各有 `run()`，对象字面量也可以有同名的
   * 数据属性 ⇒ 方法改名 / 引用必须**以归属为界**（Bug 712）。
   */
  owner?: MethodOwner;
};

/** 方法的归属：类方法 → 类；对象字面量方法 → 字面量绑定的变量名 */
export type MethodOwner = {
  kind: "class" | "object";
  /** 类名 / 对象字面量绑定的变量名 */
  name: string;
};

/** 方法引用命中：key = 定义位点（方法键）；member = 使用位点（成员访问） */
export type MethodHit = {
  loc: SourceLocation;
  kind: "key" | "member";
  /** 归属（无法判定时 null） */
  owner: MethodOwner | null;
};

/** Babel scope 的最小结构：只要能取到绑定节点 */
type ScopeLike = {
  getBinding(name: string): { path?: { node?: Node | null } | null } | undefined;
};

/** 成员访问的接收者归属 */
type ReceiverOwner = {
  owner: MethodOwner;
  /** instance = 实例访问；static = 类名访问；any = 归属不在本文件（import 来的） */
  access: "instance" | "static" | "any";
};

/** 归属表：一个归属（类 / 对象字面量）拥有哪些方法、哪些成员 */
type OwnerTable = {
  owner: MethodOwner;
  /** 方法名 → 定义位点（key 节点） */
  methods: Map<string, { key: Node; isStatic: boolean }>;
  /** 全部成员名（含数据属性）——「同名冲突」判定用 */
  members: Set<string>;
};

function ownerKeyOf(owner: MethodOwner): string {
  return `${owner.kind}:${owner.name}`;
}

/** 对象字面量绑定的变量名（`const o = {…}` → "o"；匿名 → null） */
function objectLiteralOwnerName(parent: Node | null | undefined): string | null {
  const p = parent as (Node & { type: string; id?: Node | null; left?: Node | null }) | null;
  if (!p) return null;
  if (p.type === "VariableDeclarator" && p.id?.type === "Identifier") return p.id.name;
  if (p.type === "AssignmentExpression" && p.left?.type === "Identifier") return p.left.name;
  return null;
}

/**
 * 属性值是不是「方法」：函数表达式 / 箭头 / 绑定到函数的标识符。
 *
 * 简写属性（`{ x }`）**不是**方法：它的 key 与 value 是同一个节点 ⇒ 改 key 会改坏
 * 变量绑定（那是绑定面的事，见 Bug 715）。
 */
function isMethodLikeValue(value: Node | null | undefined, scope: ScopeLike | null): boolean {
  if (!value) return false;
  if (value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression") return true;
  if (value.type === "Identifier" && scope) {
    const binding = scope.getBinding(value.name);
    const node = binding?.path?.node;
    if (!node) return false;
    if (node.type === "FunctionDeclaration") return true;
    if (node.type === "VariableDeclarator") {
      const init = (node as { init?: Node | null }).init;
      return init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
    }
  }
  return false;
}

/** 归属表：文件内的类 / 对象字面量各自有哪些方法、哪些成员 */
function collectMethodOwners(ast: Node): Map<string, OwnerTable> {
  const owners = new Map<string, OwnerTable>();
  const ensure = (owner: MethodOwner): OwnerTable => {
    const key = ownerKeyOf(owner);
    let table = owners.get(key);
    if (!table) {
      table = { owner, methods: new Map(), members: new Set() };
      owners.set(key, table);
    }
    return table;
  };
  const addClass = (node: Node & { id?: Node | null }): void => {
    const id = node.id;
    if (!id || id.type !== "Identifier") return;
    const table = ensure({ kind: "class", name: id.name });
    for (const member of getClassMembers(node as never)) {
      const key = classMemberKey(member);
      if (!key || key.type !== "Identifier") continue;
      const m = member as { type: string; computed?: boolean; static?: boolean };
      if (m.computed === true) continue;
      table.members.add(key.name);
      // getter / setter / 普通方法都是方法；字段（ClassProperty）只是成员
      if (m.type === "ClassMethod") {
        table.methods.set(key.name, { key, isStatic: m.static === true });
      }
    }
  };
  try {
    traverseFn()(ast, {
      ClassDeclaration(p) {
        addClass(p.node);
      },
      ClassExpression(p) {
        addClass(p.node);
      },
      ObjectExpression(p) {
        const name = objectLiteralOwnerName(p.parent);
        if (!name) return;
        const table = ensure({ kind: "object", name });
        for (const prop of p.node.properties) {
          if (prop.type === "ObjectMethod") {
            if (prop.computed === true) continue;
            const key = prop.key;
            if (key.type !== "Identifier") continue;
            table.members.add(key.name);
            table.methods.set(key.name, { key, isStatic: false });
            continue;
          }
          if (prop.type === "ObjectProperty") {
            if (prop.computed === true || prop.shorthand === true) continue;
            const key = prop.key;
            if (key.type !== "Identifier") continue;
            table.members.add(key.name);
            // `{ m: fn }` 是方法定义位；`{ m: 1 }` 是数据属性（不是方法）
            if (isMethodLikeValue(prop.value, p.scope)) {
              table.methods.set(key.name, { key, isStatic: false });
            }
          }
        }
      },
    });
  } catch {
    /* partial AST */
  }
  return owners;
}

/** 从绑定解析接收者归属（`const k = new K()` → 类 K） */
function ownerFromBinding(
  binding: { path?: { node?: Node | null } | null },
  scope: ScopeLike,
  depth: number,
): ReceiverOwner | null {
  const node = binding.path?.node;
  if (!node) return null;
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    const id = node.id;
    if (!id || id.type !== "Identifier") return null;
    return { owner: { kind: "class", name: id.name }, access: "static" };
  }
  if (node.type === "VariableDeclarator") {
    const init = (node as { init?: Node | null }).init;
    if (!init) return null;
    if (init.type === "NewExpression" && init.callee.type === "Identifier") {
      return { owner: { kind: "class", name: init.callee.name }, access: "instance" };
    }
    if (init.type === "ObjectExpression") {
      const name = objectLiteralOwnerName(node as unknown as Node);
      return name ? { owner: { kind: "object", name }, access: "instance" } : null;
    }
    if (init.type === "Identifier" && depth < 4) {
      const alias = scope.getBinding(init.name);
      return alias ? ownerFromBinding(alias, scope, depth + 1) : null;
    }
    return null;
  }
  if (node.type === "ImportSpecifier") {
    const imported = node.imported;
    const name = imported.type === "Identifier" ? imported.name : String(imported.value);
    return { owner: { kind: "class", name }, access: "any" };
  }
  if (node.type === "ImportDefaultSpecifier") {
    return { owner: { kind: "class", name: "default" }, access: "any" };
  }
  if (node.type === "ImportNamespaceSpecifier") {
    // 命名空间成员（`ns.m`）不是某个类的方法 ⇒ 归属不可解析
    return null;
  }
  return null;
}

/** 成员访问的接收者归属（解析不出来 ⇒ null） */
function resolveReceiverOwner(
  node: Node | null | undefined,
  scope: ScopeLike,
  thisClassName?: string | undefined,
): ReceiverOwner | null {
  if (!node) return null;
  if (node.type === "NewExpression") {
    const callee = node.callee;
    if (callee.type === "Identifier") {
      return { owner: { kind: "class", name: callee.name }, access: "instance" };
    }
    return null;
  }
  if (node.type === "Identifier") {
    const binding = scope.getBinding(node.name);
    if (!binding) return null;
    return ownerFromBinding(binding, scope, 0);
  }
  if (node.type === "ThisExpression" && thisClassName) {
    return { owner: { kind: "class", name: thisClassName }, access: "instance" };
  }
  return null;
}

/** 文件内是否存在同名**方法**定义（class/object method / get / set / 函数值属性） */
export function hasMethodNamed(ast: Node, name: string): boolean {
  for (const table of collectMethodOwners(ast).values()) {
    if (table.methods.has(name)) return true;
  }
  return false;
}

/**
 * B1：方法 / getter / setter 可改名（文件内同名定义 + 成员访问）。
 * 数据属性成员（无同名 method 定义）仍拒绝——保持「属性名不是绑定」金标。
 *
 * **以「归属」为界**（Bug 712）：同名但不同类 / 不同对象的方法不合并——
 * 成员访问只在**接收者归属与该方法定义同源**时才计入。
 * `opts.owner` 显式给出归属时严格按它取；不给时用「文件内唯一一个同名方法归属」。
 */
export function collectMethodReferences(
  ast: Node,
  name: string,
  opts?: { owner?: MethodOwner },
): MethodHit[] {
  return scanMethodReferences(ast, name, opts).hits;
}

/**
 * 方法引用扫描结果：位点 + **归属歧义**标记。
 *
 * `ambiguous` 的含义（Bug 712 的自洽性护栏）：文件内存在「同名但不同归属」的
 * 成员，**同时**存在「接收者归属解析不出来」的成员访问（形参 / 外部对象）。
 * 此时这个成员访问**可能**指目标方法、也**可能**指那个别的归属 —— 静态上
 * 不可判定。
 *
 * 此时改名只有两种自洽的结果：
 * - 把这批歧义访问**全部**一起改（可能改到无关对象 ⇒ 运行时 undefined）；
 * - **拒绝改名**（不产出任何编辑 ⇒ 代码不被改坏）。
 * 「只改定义、不改歧义调用点」是**不自洽**的：定义改了、调用点没改 ⇒
 * 调用点读到 undefined ⇒ 同样改出坏代码。因此歧义时必须拒绝。
 */
export type MethodReferenceScan = {
  hits: MethodHit[];
  ambiguous: boolean;
};

/** 归属歧义检测：改名是否会把代码改坏（见 {@link MethodReferenceScan}） */
export function hasAmbiguousMethodReceiver(
  ast: Node,
  name: string,
  opts?: { owner?: MethodOwner },
): boolean {
  return scanMethodReferences(ast, name, opts).ambiguous;
}

function scanMethodReferences(
  ast: Node,
  name: string,
  opts?: { owner?: MethodOwner },
): MethodReferenceScan {
  const owners = collectMethodOwners(ast);
  const candidates = [...owners.values()].filter((t) => t.methods.has(name));
  // 归属范围：显式传入优先；否则「文件内只有一个同名方法归属」时用它（唯一解）
  const scope: MethodOwner | undefined =
    opts?.owner ?? (candidates.length === 1 ? candidates[0]!.owner : undefined);
  const out: MethodHit[] = [];
  // 归属歧义：接收者解析不出来 + 文件内存在同名不同归属的成员
  let ambiguous = false;

  // 1) 定义位点：方法键（class method / object method / object 的函数值属性）
  for (const table of owners.values()) {
    if (scope && table.owner.name !== scope.name) continue;
    const m = table.methods.get(name);
    if (!m) continue;
    out.push({ loc: locFromNode(m.key), kind: "key", owner: table.owner });
  }

  // 2) 使用位点：成员访问（接收者归属必须与定义同源）
  const conflict = hasConflictingMember(owners, name, scope);
  const collectMemberAccess = (
    node: { computed?: boolean; property?: Node | null; object?: Node | null },
    scopeOfPath: ScopeLike,
    thisClassName: string | undefined,
  ): void => {
    if (node.computed === true) return;
    const prop = node.property;
    if (!prop || prop.type !== "Identifier" || prop.name !== name) return;
    const receiver = resolveReceiverOwner(node.object ?? null, scopeOfPath, thisClassName);
    if (!receiver) {
      // 接收者不可解析（形参 / 外部对象）：文件内存在「同名但不同归属」的成员时
      // 它**可能**指目标方法、也可能指那个别的归属 ⇒ 归属歧义（改名必须拒绝，
      // 否则「定义改了、调用点没改」同样改出坏代码）。
      if (conflict) {
        ambiguous = true;
        return;
      }
      out.push({ loc: locFromNode(prop), kind: "member", owner: null });
      return;
    }
    if (scope && receiver.owner.name !== scope.name) return;
    const table = owners.get(ownerKeyOf(receiver.owner));
    if (table) {
      const m = table.methods.get(name);
      // 该归属没有同名方法 ⇒ 不是同一个符号（数据属性 / 别的类的方法）
      if (!m) return;
      if (receiver.access === "instance" && m.isStatic) return;
      if (receiver.access === "static" && !m.isStatic) return;
    } else if (!scope || receiver.owner.name !== scope.name) {
      // 归属不在本文件（import 来的类）：只有与目标同名才计入
      return;
    }
    out.push({ loc: locFromNode(prop), kind: "member", owner: receiver.owner });
  };
  try {
    traverseFn()(ast, {
      MemberExpression(p) {
        const cls = p.findParent((parent) => parent.isClass());
        const className = classNameOfNode(cls?.node ?? null);
        collectMemberAccess(p.node, p.scope, className);
      },
      OptionalMemberExpression(p) {
        const cls = p.findParent((parent) => parent.isClass());
        const className = classNameOfNode(cls?.node ?? null);
        collectMemberAccess(p.node, p.scope, className);
      },
    });
  } catch {
    /* partial AST */
  }
  return { hits: out, ambiguous };
}

/** 归属之外的同名成员（数据属性 / 别的类的方法）⇒ 存在改名冲突 */
function hasConflictingMember(
  owners: Map<string, OwnerTable>,
  name: string,
  scope: MethodOwner | undefined,
): boolean {
  for (const table of owners.values()) {
    if (scope && table.owner.name === scope.name) continue;
    if (table.members.has(name)) return true;
  }
  return false;
}

/** 类节点的类名（匿名 → undefined） */
function classNameOfNode(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  const id = (node as { id?: Node | null }).id;
  return id && id.type === "Identifier" ? id.name : undefined;
}

/** prepareRename：绑定标识符，或方法/getter/setter（含调用点 `.name`）。 */
export function renameTargetAt(
  source: string,
  line: number,
  column: number,
): RenameTarget | { error: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return { error: "parse error" };
  }
  return renameTargetFromAst(ast, line, column);
}

/**
 * 同 {@link renameTargetAt}，但**复用已解析的 AST**。
 *
 * 符号层（definition / references）自己已经持有 AST ⇒ 走本函数避免二次解析，
 * 也让「协议面的方法面」与「纯函数面的方法面」**同一份判据**（口径不分裂）。
 */
export function renameTargetFromAst(
  ast: Node,
  line: number,
  column: number,
): RenameTarget | { error: string } | null {
  type Hit = {
    name: string;
    loc: SourceLocation;
    ok: boolean;
    methodKey: boolean;
    memberProp: boolean;
    /** 私有成员（`#name`）：身份带 `#`（Bug 1007） */
    privateMember: boolean;
    /** 本地 export list 的**导出名**（`export { a as b }` 的 b）（Bug 1066） */
    exportSide: boolean;
    owner?: MethodOwner;
    receiver: ReceiverOwner | null;
  };
  let hit: Hit | null = null;
  try {
    traverseFn()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        const parent = path.parent as
          | (Node & {
              type: string;
              key?: Node;
              computed?: boolean;
              shorthand?: boolean;
              value?: Node | null;
              local?: Node;
              exported?: Node;
            })
          | null;
        // 私有成员（`#name`）：babel 把键 / 用点包成 `PrivateName`
        // ⇒ 命中范围取 **PrivateName**（含 `#`）⇒ 光标落在 `#` 上也算命中
        const priv =
          parent?.type === "PrivateName"
            ? (parent as unknown as { id?: Node; loc?: { start: { line: number; column: number }; end: { line: number; column: number } } })
            : undefined;
        const hitLoc = priv?.loc ?? loc;
        if (
          hitLoc.start.line === line &&
          hitLoc.start.column <= column &&
          hitLoc.end.column >= column
        ) {
          // 私有成员键（`#name`）在 babel 里是 `PrivateName` 包着标识符
          // ⇒ 自身键判定必须**穿透** PrivateName（看它的 id）（Bug 1007）
          const isPrivateSelfKey = Boolean(
            priv &&
              priv.id === path.node &&
              path.parentPath &&
              isPrivateMemberDeclaration(path.parentPath),
          );
          const isSelfKey =
            (parent &&
              (parent.type === "ClassMethod" ||
                parent.type === "ObjectMethod" ||
                parent.type === "ClassPrivateMethod") &&
              parent.key === path.node &&
              parent.computed !== true) ||
            // 穿透 PrivateName 的私有成员键（见上）
            isPrivateSelfKey;
          // 对象字面量的函数值属性（`{ m: fn }`）也是方法定义位；
          // 简写 `{ x }` 不是（key 与 value 同节点 ⇒ 那是绑定，见 Bug 715）。
          const isObjectFnKey =
            parent &&
            parent.type === "ObjectProperty" &&
            parent.key === path.node &&
            parent.computed !== true &&
            parent.shorthand !== true &&
            isMethodLikeValue(parent.value ?? null, path.scope);
          const isMemberProp =
            parent &&
            (parent.type === "MemberExpression" ||
              parent.type === "OptionalMemberExpression") &&
            (parent as { property?: Node }).property === path.node &&
            (parent as { computed?: boolean }).computed !== true;
          // 私有成员（`#name`）：**不是**普通绑定，也不是 name-based 的方法
          // （方法面按名字收集 ⇒ 会把同名模块级绑定一起改掉）
          const isPrivateMember = Boolean(priv && priv.id === path.node);
          // 本地 export list 的**导出名**（`export { a as b }` 的 b）：
          // 它是**另一个身份**（不是本地绑定 `a`）（Bug 1066）
          const isExportSide = Boolean(
            parent?.type === "ExportSpecifier" &&
              parent.exported === path.node &&
              parent.local !== path.node,
          );
          const isMethod = Boolean(isSelfKey || isPrivateSelfKey || isObjectFnKey) && !isPrivateMember;
          hit = {
            name: isPrivateMember ? `#${path.node.name}` : path.node.name,
            loc: locFromNode(path.node),
            ok: isBindingIdentifier(path),
            methodKey: isMethod,
            memberProp: Boolean(isMemberProp),
            privateMember: isPrivateMember,
            exportSide: isExportSide,
            owner: isMethod ? ownerOfMethodKey(path) : undefined,
            receiver: isMemberProp ? receiverOwnerAt(path) : null,
          };
          path.stop();
        }
      },
    });
  } catch {
    return { error: "parse error" };
  }
  if (!hit) return null;
  const h = hit as Hit;
  // 私有成员（`#name`）：身份带 `#` ⇒ placeholder 含 `#`；
  // 但**编辑范围**只覆盖标识符（`#` 保留）⇒ 改名结果是 `#newName`。
  // ⚠ 新名校验（合法 JS 标识符）拒收 `#newName` ⇒ placeholder 只作**提示**，
  //   用户填的是**不带 `#`** 的标识符（编辑范围不含 `#`，两者一致）。
  if (h.privateMember) {
    return { name: h.name, loc: h.loc, kind: "private" };
  }
  // 导出名（`export { a as b }` 的 b）：可改名身份 = **导出名**（不是本地名 `a`）
  if (h.exportSide) {
    return { name: h.name, loc: h.loc, kind: "export" };
  }
  if (h.methodKey) {
    return { name: h.name, loc: h.loc, kind: "method", owner: h.owner };
  }
  // 成员属性：接收者归属与该方法定义同源时按方法改名
  if (h.memberProp) {
    const info = memberMethodInfo(ast, h);
    if (info.owner) {
      return { name: h.name, loc: h.loc, kind: "method", owner: info.owner };
    }
    if (info.known) {
      // 归属已知但没有同名方法 ⇒ 这是数据属性，不是方法
      return { error: `cannot rename '${h.name}' (property / non-binding identifier)` };
    }
    // 归属判不出来（形参 / 外部对象）：退回「文件内有同名方法定义」的旧口径
    if (hasMethodNamed(ast, h.name)) {
      return { name: h.name, loc: h.loc, kind: "method" };
    }
    return { error: `cannot rename '${h.name}' (property / non-binding identifier)` };
  }
  if (!h.ok) {
    return { error: `cannot rename '${h.name}' (property / non-binding identifier)` };
  }
  return { name: h.name, loc: h.loc, kind: "binding" };
}

/**
 * **方法面**目标：光标处的标识符是不是「某个归属的方法」（方法键 / 同源成员访问）。
 *
 * 方法键**不是绑定**（绑定表不收它）⇒ 走绑定面永远查不到它 ⇒ 定义 / 引用面
 * 必须先问一次「这是不是方法」。
 *
 * ⚠ **与协议面同源**：判据直接取 {@link renameTargetFromAst}（改名面的那一份）
 * ⇒ 纯函数面与协议面**同一口径**（此前协议面内联一份、纯函数面没有 ⇒ 两面分裂）。
 *
 * @returns 方法身份（名字 + 归属）；不是方法 ⇒ `null`（调用方退回绑定面）。
 */
export function methodTargetAt(
  ast: Node,
  line: number,
  column: number,
): { name: string; owner?: MethodOwner } | null {
  const target = renameTargetFromAst(ast, line, column);
  if (!target || "error" in target) return null;
  if (target.kind !== "method") return null;
  return { name: target.name, owner: target.owner };
}

/** 方法引用命中（带**文件**身份）——跨文件口径下的方法面结果 */
export type MethodReferenceInfo = {
  name: string;
  loc: SourceLocation;
  /** 命中所在文件（路径形态，与 `ReferenceInfo.uri` 同口径） */
  uri: string;
  kind: "key" | "member";
};

/**
 * **方法面**的引用收集：当前文件 + `extraFiles` 里的**跨文件**命中。
 *
 * ⚠ **为什么必须跨文件**：`Alpha.run` 的调用点常常在**另一个文件**里
 * （`import { Alpha } from "./a.js"; new Alpha().run()`）。只扫当前文件 ⇒
 * 「查找引用」看不到调用点，而改名面**已经**会带上它们 ⇒ 两个面口径分裂
 * （用户在 IDE 里查引用看不到、但一改名就跨文件被改 ⇒ 越权改动）。
 *
 * 归属（owner）**由调用方显式给出**（来自光标所在文件）⇒ 跨文件扫描按**同一个归属**
 * 匹配：`Alpha` 在别的文件里是 import 绑定 ⇒ 接收者归属仍解析为 `class:Alpha`
 * ⇒ 同源成员访问照常计入；`Beta.run`（同名不同类）不计入（Bug 712 的边界）。
 *
 * 文本取**打开文档的 buffer**（磁盘 ≠ buffer ⇒ 坐标错位），与改名面同源。
 */
export function collectMethodReferencesAcrossFiles(
  fromFile: string,
  source: string,
  target: { name: string; owner?: MethodOwner },
  options: {
    extraFiles?: string[];
    sourceProvider?: SourceProvider;
  } = {},
): MethodReferenceInfo[] {
  const out: MethodReferenceInfo[] = [];
  const pushHits = (uri: string, ast: Node): void => {
    for (const h of collectMethodReferences(ast, target.name, { owner: target.owner })) {
      out.push({ name: target.name, loc: h.loc, uri, kind: h.kind });
    }
  };
  try {
    pushHits(fromFile, parse(source));
  } catch {
    /* 解析失败 ⇒ 当前文件没有命中 */
  }
  const currentKey = cacheKeyOf(fromFile);
  for (const extra of options.extraFiles ?? []) {
    if (cacheKeyOf(extra) === currentKey) continue;
    const extraSrc = readSourceWith(options.sourceProvider, extra);
    if (extraSrc === undefined) continue;
    try {
      pushHits(extra, parse(extraSrc));
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/** 路径归一（去重口径）：绝对路径 + 正斜杠（与 `validation.ts` 的 cacheKey 同形） */
function cacheKeyOf(filePath: string): string {
  try {
    return resolve(filePath).replace(/\\/g, "/");
  } catch {
    return filePath.replace(/\\/g, "/");
  }
}

/** 方法键的归属（类 → 类名；对象字面量 → 绑定变量名） */
function ownerOfMethodKey(path: {
  parentPath?: {
    parent?: Node | null;
    parentPath?: { parent?: Node | null } | null;
  } | null;
}): MethodOwner | undefined {
  // memberPath = 方法键所在的成员（ClassMethod / ObjectMethod / ObjectProperty）
  const memberPath = path.parentPath;
  if (!memberPath) return undefined;
  const container = memberPath.parent; // ClassBody | ObjectExpression
  if (!container) return undefined;
  if (container.type === "ObjectExpression") {
    // 对象字面量 → 它的绑定变量名（`const o = {…}` → "o"）
    const name = objectLiteralOwnerName(memberPath.parentPath?.parent ?? null);
    return name ? { kind: "object", name } : undefined;
  }
  // ClassBody → ClassDeclaration / ClassExpression
  const className = classNameOfNode(memberPath.parentPath?.parent ?? null);
  return className ? { kind: "class", name: className } : undefined;
}

/** 成员访问的接收者归属（`k.m` → k 的归属） */
function receiverOwnerAt(path: {
  parent: Node | null;
  scope: ScopeLike;
  findParent(cb: (parent: { node: Node | null; isClass(): boolean }) => boolean): {
    node: Node | null;
  } | null;
}): ReceiverOwner | null {
  const parent = path.parent as (Node & { object?: Node | null }) | null;
  if (!parent?.object) return null;
  const cls = path.findParent((p) => p.isClass());
  return resolveReceiverOwner(parent.object, path.scope, classNameOfNode(cls?.node ?? null));
}

/**
 * 成员属性是不是「某个归属的方法」：
 * - owner：归属（该归属确有同名方法）
 * - known：归属是否可判定（可判定且没有同名方法 ⇒ 数据属性）
 */
function memberMethodInfo(
  ast: Node,
  hit: { name: string; receiver: ReceiverOwner | null },
): { owner?: MethodOwner; known: boolean } {
  const r = hit.receiver;
  if (!r) return { known: false };
  const table = collectMethodOwners(ast).get(ownerKeyOf(r.owner));
  if (!table) return { known: false };
  if (!table.methods.has(hit.name)) return { known: true };
  return { owner: r.owner, known: true };
}

export type RenameEdit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

/**
 * 纯函数：把 def+refs 转成 LSP WorkspaceEdit.changes。
 *
 * 协议合法性兜底（见 dedupeRenameEdits）：
 * - 编辑范围**不得宽于一个标识符**（导出绑定的 referencePaths 会混进
 *   ExportNamedDeclaration 语句节点 —— 直接改会把整条声明替换掉）；
 * - 同一份 edit 列表里的 range **不得互相重叠**（LSP 规定；重叠会让客户端
 *   拒绝整次改名，或顺序套用把文件改坏）。
 */
export function buildRenameEdits(
  newName: string,
  locations: Array<{ uri: string; loc: SourceLocation }>,
): Record<string, RenameEdit[]> {
  const changes: Record<string, RenameEdit[]> = {};
  for (const { uri, loc } of locations) {
    const meta = metaOf(loc);
    // 宽于一个标识符的编辑一律挡掉（语句级节点误入编辑目标）
    if (meta.srcWidth !== undefined) {
      const width =
        loc.end.line === loc.start.line ? loc.end.column - loc.start.column : Number.MAX_SAFE_INTEGER;
      if (width !== meta.srcWidth) continue;
    }
    const list = (changes[uri] ??= []);
    list.push({
      range: {
        start: { line: loc.start.line - 1, character: loc.start.column },
        end: { line: loc.end.line - 1, character: loc.end.column },
      },
      // 简写属性 `{ x }`：key 与 value 同一段源码 ⇒ 改名必须保留 key
      // （`{ x }` → `{ x: <新名> }`，否则对象的键被静默改掉）
      newText: meta.shorthandKey ? `${meta.shorthandKey}: ${newName}` : newName,
    });
  }
  for (const uri of Object.keys(changes)) {
    changes[uri] = dedupeRenameEdits(changes[uri]!);
  }
  return changes;
}

/** 编辑区间的宽度（跨行编辑按「行数 × 大常数」计 ⇒ 恒宽于单行编辑） */
function renameEditWidth(e: RenameEdit): number {
  const lines = e.range.end.line - e.range.start.line;
  if (lines > 0) return lines * 1_000_000 + (e.range.end.character - e.range.start.character);
  return e.range.end.character - e.range.start.character;
}

/** 两个编辑区间是否重叠（相接不算重叠） */
function renameEditsOverlap(a: RenameEdit, b: RenameEdit): boolean {
  const beforeEnd =
    a.range.start.line < b.range.end.line ||
    (a.range.start.line === b.range.end.line && a.range.start.character < b.range.end.character);
  const beforeEnd2 =
    b.range.start.line < a.range.end.line ||
    (b.range.start.line === a.range.end.line && b.range.start.character < a.range.end.character);
  return beforeEnd && beforeEnd2;
}

/**
 * 编辑列表去重 + 协议合法性：
 * - 完全相同的编辑去重；
 * - 互相重叠的编辑只留一条：**窄的优先**（语句级误收的宽编辑被挡掉）。
 */
function dedupeRenameEdits(edits: RenameEdit[]): RenameEdit[] {
  const byRange = new Map<string, RenameEdit>();
  for (const e of edits) {
    const key = `${e.range.start.line}:${e.range.start.character}:${e.range.end.line}:${e.range.end.character}`;
    if (!byRange.has(key)) byRange.set(key, e);
  }
  const list = [...byRange.values()];
  // 窄的先占位 ⇒ 宽的（语句级）编辑与它重叠时被跳过
  const ordered = [...list].sort((a, b) => renameEditWidth(a) - renameEditWidth(b));
  const kept: RenameEdit[] = [];
  for (const e of ordered) {
    if (kept.some((k) => renameEditsOverlap(k, e))) continue;
    kept.push(e);
  }
  // 输出保持源码顺序
  return list.filter((e) => kept.includes(e));
}

/**
 * 查定义（作用域感知）。
 *
 * 符号表按**作用域路径**存同名绑定（`name@行:列`）⇒ 给了光标位置时，取
 * 「光标所在作用域」里**最内层**的那个定义 —— 遮蔽的同名局部变量不再跳到
 * 别的作用域。没给位置时退回 plain-name 兜底条目（程序作用域优先）。
 */
export function findDefinition(
  symbolTable: SymbolTable,
  name: string,
  at?: { line: number; column: number },
): SymbolInfo | null {
  if (at) {
    let best: SymbolInfo | null = null;
    let bestScope: ScopeRange | undefined;
    for (const [key, info] of symbolTable.definitions) {
      if (!key.startsWith(`${name}@`)) continue;
      const scope = metaOf(info.loc).scope;
      if (!inRange(scope, at)) continue;
      if (!best || rangeSize(scope) < rangeSize(bestScope)) {
        best = info;
        bestScope = scope;
      }
    }
    if (best) return best;
  }
  return symbolTable.definitions.get(name) ?? null;
}

/**
 * 查引用（作用域感知）：给了光标位置时，只返回**该绑定所在作用域（含其内层
 * 作用域）**里的引用 —— 另一个作用域的同名绑定不会被算进来。
 */
export function findReferences(
  symbolTable: SymbolTable,
  name: string,
  at?: { line: number; column: number },
): ReferenceInfo[] {
  const refs = symbolTable.references.filter((r) => r.name === name);
  if (!at) return refs;
  const def = findDefinition(symbolTable, name, at);
  const scope = def ? metaOf(def.loc).scope : undefined;
  if (!scope) return refs;
  return refs.filter((r) => {
    const refScope = metaOf(r.loc).scope;
    return rangeContains(scope, refScope);
  });
}

export function findIdentifierAtPosition(ast: Node, line: number, column: number): string | null {
  let found: string | null = null;
  try {
    traverseFn()(ast, {
      // 私有成员（`#name`）：身份 = `#name`（带 `#`）⇒ 光标落在 `#` 上也算命中
      PrivateName(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === line &&
          loc.start.column <= column &&
          loc.end.column >= column
        ) {
          found = `#${path.node.id.name}`;
          path.stop();
        }
      },
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
  const body = programBody(ast);

  type FnLike =
    | FunctionDeclaration
    | FunctionExpression
    | ArrowFunctionExpression
    | ClassMethod
    | ObjectMethod
    | TSDeclareMethod;
  const pushFn = (
    fnNode: FnLike,
    idNode: Identifier | null | undefined,
    exported: boolean,
    fallbackName?: string,
  ): void => {
    const name = idNode?.name ?? fallbackName;
    if (!name) return;
    const range = rangeOfNode(fnNode);
    const selection = idNode?.name ? rangeOfNode(idNode) : range;
    const children: DocumentSymbolItem[] = [];
    const params: string[] = (fnNode.params ?? [])
      .map((p) => paramDisplayName(p))
      .filter(Boolean);
    out.push({
      name,
      detail: `(${params.join(", ")})${exported ? " export" : ""}`,
      kind: SymbolKind.Function,
      range,
      selectionRange: selection,
      children: children.length ? children : undefined,
    });
  };

  const classChildren = (decl: ClassDeclaration): DocumentSymbolItem[] =>
    getClassMembers(decl).flatMap((m) => {
      const key = classMemberKeyName(m);
      const keyNode = classMemberKey(m);
      if (!key || !keyNode || (m.type !== "ClassMethod" && m.type !== "ClassProperty")) return [];
      return [{
        name: String(key),
        kind: m.type === "ClassMethod" ? SymbolKind.Method : SymbolKind.Property,
        range: rangeOfNode(m),
        selectionRange: rangeOfNode(keyNode),
      }];
    });

  /**
   * `export default …`：默认导出必须在大纲里出现。
   * 匿名 `export default function () {}` / `export default <arrow>` 也要出项
   * （名字取 `default`；有名时取函数名）。
   */
  const pushDefaultExport = (decl: Node): void => {
    if (decl.type === "FunctionDeclaration") {
      pushFn(decl, decl.id, true, "default");
      return;
    }
    if (decl.type === "ClassDeclaration") {
      out.push({
        name: decl.id?.name ?? "default",
        detail: "export class",
        kind: SymbolKind.Class,
        range: rangeOfNode(decl),
        selectionRange: decl.id ? rangeOfNode(decl.id) : rangeOfNode(decl),
        children: classChildren(decl),
      });
      return;
    }
    if (decl.type === "ArrowFunctionExpression") {
      pushFn(decl, null, true, "default");
      return;
    }
    if (decl.type === "FunctionExpression") {
      pushFn(decl, decl.id, true, "default");
      return;
    }
    // 其它表达式（字面量 / 调用）：也给一个 default 符号
    out.push({
      name: "default",
      detail: "export default",
      kind: SymbolKind.Variable,
      range: rangeOfNode(decl),
      selectionRange: rangeOfNode(decl),
    });
  };

  for (const stmt of body) {
    // export default：顶层语句循环必须单独处理（它不是 Function/Class/Variable 声明）
    if (stmt.type === "ExportDefaultDeclaration") {
      pushDefaultExport(stmt.declaration);
      continue;
    }
    // CJS 成员导出：`exports.f = fn` / `module.exports.f = fn`（键名即导出名）
    // ——此前整段在大纲里消失（998）：诊断面点名 alpha，符号面却查不到。
    if (stmt.type === "ExpressionStatement") {
      const expr = stmt.expression;
      if (expr.type === "AssignmentExpression" && expr.operator === "=") {
        const left = expr.left;
        const right = expr.right;
        if (left.type === "MemberExpression" && !left.computed) {
          const obj = left.object;
          const isExports = obj.type === "Identifier" && obj.name === "exports";
          const isModuleExports =
            obj.type === "MemberExpression" &&
            obj.object.type === "Identifier" &&
            obj.object.name === "module" &&
            obj.property.type === "Identifier" &&
            obj.property.name === "exports";
          const prop = left.property;
          if (
            (isExports || isModuleExports) &&
            prop.type === "Identifier" &&
            (right.type === "FunctionExpression" || right.type === "ArrowFunctionExpression")
          ) {
            pushFn(right, prop, true);
          }
        }
      }
      continue;
    }
    const { declaration: decl, exported } = unwrapExport(stmt);

    if (decl.type === "FunctionDeclaration") {
      pushFn(decl, decl.id, exported);
      continue;
    }
    if (decl.type === "ClassDeclaration" && decl.id) {
      out.push({
        name: decl.id.name,
        detail: exported ? "export class" : "class",
        kind: SymbolKind.Class,
        range: rangeOfNode(decl),
        selectionRange: rangeOfNode(decl.id),
        children: classChildren(decl),
      });
      continue;
    }
    if (decl.type === "VariableDeclaration") {
      // detail 必须按声明种类（const / let / var）写，不能一律写 const
      const kindWord = decl.kind === "let" ? "let" : decl.kind === "var" ? "var" : "const";
      const detail = exported ? `export ${kindWord}` : kindWord;
      for (const d of getDeclarations(decl)) {
        const id = getDeclaratorId(d);
        if (id) {
          const init = getDeclaratorInit(d);
          const isFn =
            init &&
            (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression");
          out.push({
            name: id.name,
            detail,
            kind: isFn ? SymbolKind.Function : SymbolKind.Variable,
            range: rangeOfNode(d),
            selectionRange: rangeOfNode(id),
          });
          continue;
        }
        // 解构声明：每个绑定各出一个符号（否则整条声明从大纲里消失）
        for (const binding of patternBindingIdentifiers(d.id)) {
          out.push({
            name: binding.name,
            detail,
            kind: SymbolKind.Variable,
            range: rangeOfNode(binding),
            selectionRange: rangeOfNode(binding),
          });
        }
      }
    }
  }
  return out;
}

/** 解构模式里的绑定标识符（`{ p, q }` / `[a, b]` / 嵌套 / 默认值 / rest） */
function patternBindingIdentifiers(pattern: Node | null | undefined): Identifier[] {
  const out: Identifier[] = [];
  const walk = (node: Node | null | undefined): void => {
    if (!node) return;
    switch (node.type) {
      case "Identifier":
        out.push(node);
        return;
      case "ObjectPattern":
        for (const prop of node.properties) {
          if (prop.type === "ObjectProperty") walk(prop.value);
          else if (prop.type === "RestElement") walk(prop.argument);
        }
        return;
      case "ArrayPattern":
        for (const el of node.elements) walk(el);
        return;
      case "AssignmentPattern":
        walk(node.left);
        return;
      case "RestElement":
        walk(node.argument);
        return;
      default:
        return;
    }
  };
  walk(pattern);
  return out;
}

// ---------------------------------------------------------------------------
// Cross-file import resolution
// ---------------------------------------------------------------------------

/**
 * 源码读取覆盖层：跨文件导航的事实来源是**编辑器 buffer**，不是磁盘
 * （用户未保存的改动在磁盘上不存在）。返回 undefined ⇒ 退回磁盘。
 */
export type SourceProvider = (filePath: string) => string | undefined;

export type ImportBinding = {
  /** 导入说明符原文 */
  spec: string;
  /** 目标模块里的导出名（default / 具名 / "*" = 命名空间） */
  importedName: string;
  /** 解析后的绝对路径（相对 specifier 成功时） */
  resolvedPath?: string;
  /** 本地绑定名（带别名时 ≠ importedName） */
  local: string;
  /** import 说明符的 imported 侧标识符位置（= 对目标模块导出的引用；改名要改这里） */
  importedLoc?: SourceLocation;
  /** import 说明符的 local 侧标识符位置（= 本地绑定声明位） */
  localLoc?: SourceLocation;
  /** 带别名（imported ≠ local）：imported 侧与 local 侧是两个不同的节点 */
  aliased: boolean;
};

/**
 * re-export 边：`export { a } from "./m"` / `export { a as b } from "./m"`。
 * ES 语义下它**不绑本地名**，但它确实建立「本模块导出名 ↔ 目标模块导出名」
 * 的跨文件边 —— references / rename 必须看得见这条边，否则改名会改断模块图。
 */
export type ReExportBinding = {
  /** 说明符原文 */
  spec: string;
  /** 目标模块里的导出名 */
  importedName: string;
  /** 本模块对外的导出名 */
  exportedName: string;
  /** 解析后的绝对路径 */
  resolvedPath?: string;
  /** ExportSpecifier.local 位置（= 对目标模块导出的引用） */
  importedLoc?: SourceLocation;
  /** ExportSpecifier.exported 位置（= 本模块对外导出名） */
  exportedLoc?: SourceLocation;
  /** 带别名（imported ≠ exported） */
  aliased: boolean;
};

/** 收集 `import { a as b } from "./x"` / `import def from` / `import * as ns` 的本地绑定 */
export function collectImportBindings(
  ast: Node,
  fromFile: string,
): Map<string, ImportBinding> {
  const map = new Map<string, ImportBinding>();
  for (const stmt of programBody(ast)) {
    if (stmt.type !== "ImportDeclaration") continue;
    const spec = stmt.source.value as string;
    const resolvedPath = resolveRelativeModule(spec, fromFile);
    for (const specNode of stmt.specifiers ?? []) {
      if (specNode.type === "ImportSpecifier") {
        const imported = specNode.imported.type === "Identifier" ? specNode.imported.name : String(specNode.imported.value);
        map.set(specNode.local.name, {
          spec,
          importedName: imported,
          resolvedPath,
          local: specNode.local.name,
          importedLoc: locFromNode(specNode.imported),
          localLoc: locFromNode(specNode.local),
          aliased: imported !== specNode.local.name,
        });
      } else if (specNode.type === "ImportDefaultSpecifier") {
        // default 导入：imported 侧与 local 侧是同一个标识符节点
        map.set(specNode.local.name, {
          spec,
          importedName: "default",
          resolvedPath,
          local: specNode.local.name,
          importedLoc: locFromNode(specNode.local),
          localLoc: locFromNode(specNode.local),
          aliased: false,
        });
      } else if (specNode.type === "ImportNamespaceSpecifier") {
        // namespace：不支持精确跳转到单个导出（引用面走 `ns.<name>` 成员访问）
        map.set(specNode.local.name, {
          spec,
          importedName: "*",
          resolvedPath,
          local: specNode.local.name,
          importedLoc: locFromNode(specNode.local),
          localLoc: locFromNode(specNode.local),
          aliased: false,
        });
      }
    }
  }
  return map;
}

/** 收集 re-export 边（`export { a } from "./m"` / `export { a as b } from "./m"`） */
export function collectReExportBindings(ast: Node, fromFile: string): ReExportBinding[] {
  const out: ReExportBinding[] = [];
  for (const stmt of programBody(ast)) {
    if (stmt.type !== "ExportNamedDeclaration" || !stmt.source) continue;
    const spec = stmt.source.value as string;
    const resolvedPath = resolveRelativeModule(spec, fromFile);
    for (const s of stmt.specifiers ?? []) {
      if (s.type !== "ExportSpecifier") continue;
      const imported = nameOrStringValue(s.local);
      const exported = exportSpecifierExportedName(s);
      if (imported === undefined || exported === undefined) continue;
      const exportedName = String(exported);
      out.push({
        spec,
        importedName: imported,
        exportedName,
        resolvedPath,
        importedLoc: locFromNode(s.local),
        exportedLoc: locFromNode(s.exported),
        aliased: imported !== exportedName,
      });
    }
  }
  return out;
}

/** 跨文件边：当前文件里指向「目标模块某个导出」的一条 import / re-export 说明符。 */
type CrossEdge = {
  kind: "import" | "reexport";
  /** 目标模块里的导出名（"default" / 具名 / "*"） */
  importedName: string;
  /** 本地绑定名（import 才有） */
  local?: string;
  /** 目标模块绝对路径 */
  resolvedPath?: string;
  /** imported 侧标识符位置（= 对目标模块导出的引用） */
  importedLoc?: SourceLocation;
  /** local 侧标识符位置 */
  localLoc?: SourceLocation;
  /** exported 侧标识符位置（re-export 才有） */
  exportedLoc?: SourceLocation;
  /** 本模块对外的导出名（re-export 才有） */
  exportedName?: string;
  /** 带别名 */
  aliased: boolean;
};

/** 当前文件里全部跨文件边（import + re-export） */
function collectCrossEdges(ast: Node, fromFile: string): CrossEdge[] {
  const out: CrossEdge[] = [];
  for (const [local, b] of collectImportBindings(ast, fromFile)) {
    out.push({
      kind: "import",
      importedName: b.importedName,
      local,
      resolvedPath: b.resolvedPath,
      importedLoc: b.importedLoc,
      localLoc: b.localLoc,
      aliased: b.aliased,
    });
  }
  for (const r of collectReExportBindings(ast, fromFile)) {
    out.push({
      kind: "reexport",
      importedName: r.importedName,
      resolvedPath: r.resolvedPath,
      importedLoc: r.importedLoc,
      exportedLoc: r.exportedLoc,
      exportedName: r.exportedName,
      aliased: r.aliased,
    });
  }
  return out;
}

/** 光标落在 import / re-export 说明符上时，命中的是哪条边、哪一侧。 */
type EdgeHit = CrossEdge & {
  /** 光标所在侧：imported = 对目标模块导出的引用；local = 本地绑定；exported = 本模块对外名 */
  side: "imported" | "local" | "exported";
};

function nodeAtPosition(
  node: Node | null | undefined,
  at: { line: number; column: number },
): boolean {
  const loc = node?.loc;
  if (!loc) return false;
  return loc.start.line === at.line && loc.start.column <= at.column && loc.end.column >= at.column;
}

/** 光标处的 import / re-export 说明符（命中 imported / local / exported 哪一侧） */
function findEdgeAt(
  ast: Node,
  fromFile: string,
  at: { line: number; column: number },
): EdgeHit | null {
  for (const stmt of programBody(ast)) {
    if (stmt.type === "ImportDeclaration") {
      const spec = stmt.source.value as string;
      const resolvedPath = resolveRelativeModule(spec, fromFile);
      for (const s of stmt.specifiers ?? []) {
        if (s.type === "ImportSpecifier") {
          const imported = s.imported.type === "Identifier" ? s.imported.name : String(s.imported.value);
          const base = {
            kind: "import" as const,
            importedName: imported,
            local: s.local.name,
            resolvedPath,
            importedLoc: locFromNode(s.imported),
            localLoc: locFromNode(s.local),
            aliased: imported !== s.local.name,
          };
          // 非别名 import：imported / local 是两个同区间节点 —— imported 优先
          if (nodeAtPosition(s.imported, at)) return { ...base, side: "imported" };
          if (nodeAtPosition(s.local, at)) return { ...base, side: "local" };
        } else if (s.type === "ImportDefaultSpecifier") {
          if (nodeAtPosition(s.local, at)) {
            return {
              kind: "import",
              side: "local",
              importedName: "default",
              local: s.local.name,
              resolvedPath,
              importedLoc: locFromNode(s.local),
              localLoc: locFromNode(s.local),
              aliased: false,
            };
          }
        } else if (s.type === "ImportNamespaceSpecifier") {
          if (nodeAtPosition(s.local, at)) {
            return {
              kind: "import",
              side: "local",
              importedName: "*",
              local: s.local.name,
              resolvedPath,
              importedLoc: locFromNode(s.local),
              localLoc: locFromNode(s.local),
              aliased: false,
            };
          }
        }
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.source) {
      const spec = stmt.source.value as string;
      const resolvedPath = resolveRelativeModule(spec, fromFile);
      for (const s of stmt.specifiers ?? []) {
        if (s.type !== "ExportSpecifier") continue;
        const imported = nameOrStringValue(s.local);
        const exported = exportSpecifierExportedName(s);
        if (imported === undefined || exported === undefined) continue;
        const exportedName = String(exported);
        const base = {
          kind: "reexport" as const,
          importedName: imported,
          resolvedPath,
          importedLoc: locFromNode(s.local),
          exportedLoc: locFromNode(s.exported),
          exportedName,
          aliased: imported !== exportedName,
        };
        if (nodeAtPosition(s.local, at)) return { ...base, side: "imported" };
        if (nodeAtPosition(s.exported, at)) return { ...base, side: "exported" };
      }
    }
  }
  return null;
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
    // 单次 statSync（#135 口径 + 可见化）：不存在 → miss 继续；EACCES/EIO 等
    // 真实读故障不得静默折叠成候选 miss（定义跳转静默失联）——console.error
    // 可见后继续下一候选（上抛会让 LSP 崩，吞掉则不可排查）。
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(cand, { throwIfNoEntry: false });
    } catch (e) {
      console.error(`[nudo-lsp] module candidate stat failed (${cand}):`, e);
      continue;
    }
    if (st !== undefined && st.isFile()) return cand;
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

/**
 * 取源码：**打开文档的 buffer 优先**，磁盘只作 fallback。
 *
 * 跨文件导航的位置语义绑定在编辑器 buffer 上（客户端把 WorkspaceEdit 应用到
 * buffer）—— 读磁盘会让未保存的改动消失 ⇒ F12 跳错行、改名改坏用户代码。
 */
export function readSourceWith(
  provider: SourceProvider | undefined,
  filePath: string,
): string | undefined {
  if (provider) {
    try {
      const buffered = provider(filePath);
      if (buffered !== undefined) return buffered;
    } catch {
      /* provider 失联 ⇒ 退回磁盘 */
    }
  }
  return readSourceIfExists(filePath);
}

/**
 * 在目标文件里找具名/default 导出的定义位置。
 *
 * `export { a } from "./m"`（re-export）**不是**本地 export list：它把本模块的
 * 导出名接到目标模块的导出名上 ⇒ 查定义必须跟到目标模块（fromFile 用于解析
 * 相对说明符；缺省时无法解析相对路径 ⇒ re-export 只能跳过）。
 *
 * ⚠ **本地名 / 导出名是两个身份**（Bug 1066）：`export { hidden as visible }`
 * 里 `hidden`（本地绑定）与 `visible`（对外的导出名）必须分开 ⇒ 别名导出
 * 额外返回 `exportName`（导出名）与 `exportLoc`（导出说明符的**导出侧**）。
 */
export function findExportDefinition(
  targetSource: string,
  exportName: string,
  fromFile?: string,
  sourceProvider?: SourceProvider,
): {
  name: string;
  kind: SymbolInfo["kind"];
  loc: SourceLocation;
  /** 对外的导出名（**别名导出**时 ≠ name） */
  exportName?: string;
  /** 导出说明符的**导出侧**位置（**别名导出**时给出） */
  exportLoc?: SourceLocation;
} | null {
  let ast: Node;
  try {
    ast = parse(targetSource);
  } catch {
    return null;
  }
  for (const stmt of programBody(ast)) {
    let decl: Node = stmt;
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
      for (const d of getDeclarations(decl)) {
        const id = getDeclaratorId(d);
        if (id && id.name === exportName) {
          return { name: id.name, kind: "variable", loc: locFromNode(id) };
        }
      }
    }
    // export { a, b as c } —— 本地 export list 与 re-export 必须分流
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration && stmt.specifiers) {
      for (const s of stmt.specifiers) {
        if (s.type !== "ExportSpecifier") continue;
        const exported = exportSpecifierExportedName(s);
        if (exported === undefined || String(exported) !== exportName) continue;
        const local = nameOrStringValue(s.local);
        if (!local) continue;
        if (stmt.source) {
          // re-export：跟到目标模块的同名导出
          if (!fromFile) continue;
          const target = resolveRelativeModule(stmt.source.value as string, fromFile);
          if (!target) continue;
          const targetSrc = readSourceWith(sourceProvider, target);
          if (targetSrc === undefined) continue;
          const reexported = findExportDefinition(targetSrc, local, target, sourceProvider);
          if (reexported) return reexported;
          continue;
        }
        const table = buildSymbolTable(ast, "");
        const def = table.definitions.get(local);
        if (def) {
          const exportedName = String(exported);
          if (exportedName === local) {
            // 同名直出（`export { a }`）⇒ 导出名 == 本地名 ⇒ 同一个身份
            return { name: local, kind: def.kind, loc: def.loc };
          }
          // 别名导出（`export { a as b }`）⇒ **两个身份**：
          //   loc = 本地绑定 `a` 的声明位（F12：跳到本地绑定）
          //   exportLoc = 导出说明符的**导出侧** `b`（改名面：改的是导出名）
          return {
            name: local,
            kind: def.kind,
            loc: def.loc,
            exportName: exportedName,
            exportLoc: locFromNode(s.exported),
          };
        }
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
  options: {
    /** 光标位置（命中 import / re-export 说明符时按说明符侧解析） */
    at?: { line: number; column: number };
    /** 源码覆盖层（打开文档 buffer 优先） */
    sourceProvider?: SourceProvider;
  } = {},
): { filePath: string; loc: SourceLocation; name: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return null;
  }
  // 光标落在 import / re-export 说明符上 ⇒ 目标是**目标模块的导出**；
  // 否则按本地名找 import 绑定。
  const hit = options.at ? findEdgeAt(ast, fromFile, options.at) : null;
  let resolvedPath: string | undefined;
  let targetName: string | undefined;
  if (hit) {
    resolvedPath = hit.resolvedPath;
    targetName = hit.importedName;
  } else {
    const bindings = collectImportBindings(ast, fromFile);
    const binding = bindings.get(ident);
    if (!binding?.resolvedPath) return null;
    resolvedPath = binding.resolvedPath;
    targetName = binding.importedName;
  }
  if (!resolvedPath || targetName === undefined) return null;
  if (targetName === "*") return null;
  const targetSource = readSourceWith(options.sourceProvider, resolvedPath);
  if (targetSource === undefined) return null;
  const def = findExportDefinition(targetSource, targetName, resolvedPath, options.sourceProvider);
  if (!def) return null;
  return { filePath: resolvedPath, loc: def.loc, name: def.name };
}

/**
 * 跨文件 references：在 candidateFiles（默认 = 当前文件目录树 + 已知文件）里
 * 找**引用了 definingFile 的导出**的文件，并收集引用位。
 *
 * `exportName` 是被查符号在 definingFile 里的**本地名**；本函数负责把它翻译成
 * 对外的**导出名**（`export default function greet` ⇒ 导出名是 "default"，
 * 它是一等导出名，不能被 `!==` 直接跳过）。
 *
 * 三类边的口径：
 * - 无别名 import（本地名 == 导出名）⇒ 本地全部引用位都是对该导出的引用；
 * - 带别名 import（`import { a as b }`）⇒ **只有 imported 侧**是对该导出的引用
 *   （local 侧是另一个本地绑定，改名不得连坐）；
 * - 命名空间 import（`import * as ns`）⇒ 只认 `ns.<exportName>` 的成员访问，
 *   裸 `ns` 的出现处不是引用；
 * - re-export（`export { a } from "./m"`）⇒ ExportSpecifier 的 imported 侧。
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
    /** 源码覆盖层（打开文档 buffer 优先） */
    sourceProvider?: SourceProvider;
    /**
     * 显式的**导出名集合**（覆盖「按本地名反查导出名」的默认推导）。
     *
     * 别名导出（`export { hidden as visible }`）里本地名与导出名**分属两个
     * 身份** ⇒ 调用方按身份指定要匹配的导出名（Bug 1066）。
     */
    exportNames?: string[];
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

  // 被查符号在定义文件里的导出名（default 导出 = "default"）
  const exportNames =
    options.exportNames ?? exportedNamesIn(definingFile, exportName, options.sourceProvider);

  const definingNorm = resolve(definingFile);
  for (const cand of candidates) {
    if (resolve(cand) === definingNorm) continue;
    const src = readSourceWith(options.sourceProvider, cand);
    if (src === undefined) continue;
    let ast: Node;
    try {
      ast = parse(src);
    } catch {
      continue;
    }
    for (const edge of collectCrossEdges(ast, cand)) {
      if (!edge.resolvedPath || resolve(edge.resolvedPath) !== definingNorm) continue;
      if (edge.kind === "reexport") {
        // re-export 边：ExportSpecifier 的 imported 侧是对目标模块导出的引用
        if (!exportNames.includes(edge.importedName)) continue;
        if (edge.importedLoc) out.push({ name: edge.importedName, loc: edge.importedLoc, uri: cand });
        continue;
      }
      if (edge.importedName === "*") {
        // 命名空间 import：只认成员访问（裸 ns 不是引用）
        for (const loc of namespaceMemberReferences(ast, edge.local ?? "", exportNames)) {
          out.push({ name: edge.importedName, loc, uri: cand });
        }
        continue;
      }
      if (!exportNames.includes(edge.importedName)) continue;
      if (edge.aliased) {
        // 带别名：imported 侧才是对目标导出的引用（local 侧是另一个本地绑定）
        if (edge.importedLoc) out.push({ name: edge.importedName, loc: edge.importedLoc, uri: cand });
        continue;
      }
      // 无别名：本地名 == 导出名 ⇒ 本地引用位全部是对该导出的引用
      const table = buildSymbolTable(ast, cand);
      for (const ref of table.references) {
        if (ref.name !== edge.local) continue;
        out.push({ name: edge.local!, loc: ref.loc, uri: cand });
      }
    }
  }
  return out;
}

/**
 * 被查符号在 definingFile 里的**导出名**集合。
 * `export default function greet` ⇒ {"default"}；`export { greet as g }` ⇒ {"g"}。
 */
function exportedNamesIn(
  definingFile: string,
  localName: string,
  sourceProvider?: SourceProvider,
): string[] {
  const src = readSourceWith(sourceProvider, definingFile);
  if (src === undefined) return [localName];
  try {
    const names = exportedNamesOfLocal(parse(src), localName);
    return names.length > 0 ? names : [localName];
  } catch {
    return [localName];
  }
}

/** 命名空间 import 的引用位：`ns.<exportName>` 的成员属性（裸 `ns` 的出现处不是引用） */
function namespaceMemberReferences(
  ast: Node,
  namespaceName: string,
  exportNames: string[],
): SourceLocation[] {
  const out: SourceLocation[] = [];
  if (!namespaceName) return out;
  const collect = (node: Node): void => {
    const m = node as Node & { object?: Node; property?: Node; computed?: boolean };
    if (m.computed === true) return;
    const obj = m.object;
    const prop = m.property;
    if (!obj || obj.type !== "Identifier" || obj.name !== namespaceName) return;
    if (!prop || prop.type !== "Identifier") return;
    if (!exportNames.includes(prop.name)) return;
    out.push(locFromNode(prop));
  };
  try {
    traverseFn()(ast, {
      MemberExpression(p) {
        collect(p.node);
      },
      OptionalMemberExpression(p) {
        collect(p.node);
      },
    });
  } catch {
    /* partial AST */
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
 * 同名导出兜底定义查找：ident 在当前文件既无本地定义也无 import 绑定时
 * （典型：依赖注入风格的函数参数 `computeScorecard` 的调用点），在候选
 * 文件集（同目录树 + 会话已知文件）里查找名为 ident 的导出定义。
 * 仅用于 definition 跳转；rename/references 不走此路径（改名语义必须
 * 绑定到真实绑定点，不能按名字跨文件外推）。
 */
export function findWorkspaceExportDefinition(
  fromFile: string,
  ident: string,
  options: {
    extraFiles?: string[];
    rootDir?: string;
    maxFiles?: number;
    /** 源码覆盖层（打开文档 buffer 优先） */
    sourceProvider?: SourceProvider;
  } = {},
): { filePath: string; loc: SourceLocation; name: string } | null {
  const root = options.rootDir ?? dirname(fromFile);
  const candidates = new Set<string>(options.extraFiles ?? []);
  try {
    collectJsFiles(root, candidates, options.maxFiles ?? 200, 0);
  } catch {
    /* ignore unreadable roots */
  }
  candidates.delete(fromFile);
  for (const cand of candidates) {
    const src = readSourceWith(options.sourceProvider, cand);
    if (src === undefined) continue;
    const def = findExportDefinition(src, ident);
    if (def) return { filePath: cand, loc: def.loc, name: def.name };
  }
  return null;
}

/**
 * 侧车契约绑定位置 —— **只认引擎真正消费的绑定**：
 * 「导出」且为 `fn({ … }, …)` 形态。
 *
 * 引擎口径（`packages/core/src/algebra/interface.ts`：Phase 1 只消费
 * `fn({ … }, …)` 形态的**导出**绑定；值模板 / 私有绑定会被报
 * `not fn() form` 并**不生效**）—— LSP 若把这类绑定当契约定义指给用户，
 * 用户改多少都不会生效（与 hover / codeLens 的 `imp`、CLI 的 `[implicit]` 矛盾）。
 */
function findSidecarContractDefinition(
  fromFile: string,
  ident: string,
  options: { extraFiles?: string[]; sourceProvider?: SourceProvider } = {},
): { filePath: string; loc: SourceLocation; name: string } | null {
  try {
    const sidecar = sidecarPathOf(fromFile);
    const candidates = [sidecar, ... (options.extraFiles ?? []).filter((f) => f.endsWith(".nudo.js") || f.endsWith(".nudo.ts"))];
    for (const path of candidates) {
      if (!path || !existsSync(path)) continue;
      const src = readSourceWith(options.sourceProvider, path);
      if (src === undefined) continue;
      let ast: Node;
      try {
        ast = parse(src);
      } catch {
        continue;
      }
      const d = findSidecarContractBinding(ast, ident);
      if (d) return { filePath: path, loc: d.loc, name: d.name };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 侧车里「导出 + fn() 形态」的契约绑定。
 * 判定与引擎同源：`fn` 来自 `@nudojs/core` 的 `fn(...)` 构造器（`fn` 槽存在）。
 */
function findSidecarContractBinding(
  ast: Node,
  ident: string,
): { name: string; loc: SourceLocation } | null {
  const fnLocals = sidecarFnLocals(ast);
  if (fnLocals.size === 0) return null;
  for (const stmt of programBody(ast)) {
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      const decl = stmt.declaration;
      if (decl.type !== "VariableDeclaration") continue;
      for (const d of getDeclarations(decl)) {
        const id = getDeclaratorId(d);
        if (!id || id.name !== ident) continue;
        const init = getDeclaratorInit(d);
        if (!init || !isFnFormInit(ast, init, fnLocals, new Set())) continue;
        return { name: id.name, loc: locFromNode(id) };
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration" && !stmt.declaration) {
      // export { x } / export { x as ident } —— 本地 export list
      for (const s of stmt.specifiers ?? []) {
        if (s.type !== "ExportSpecifier") continue;
        const exported = exportSpecifierExportedName(s);
        if (exported === undefined || String(exported) !== ident) continue;
        const local = nameOrStringValue(s.local);
        if (!local) continue;
        const localInit = localBindingInit(ast, local);
        if (!localInit || !isFnFormInit(ast, localInit, fnLocals, new Set())) continue;
        const table = buildSymbolTable(ast, "");
        const def = table.definitions.get(local);
        if (!def) continue;
        return { name: local, loc: def.loc };
      }
    }
  }
  return null;
}

/** 侧车里从 `@nudojs/core` 导入的 `fn` 构造器的本地名集合 */
function sidecarFnLocals(ast: Node): Set<string> {
  const out = new Set<string>();
  for (const stmt of programBody(ast)) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = stmt.source.value as string;
    if (source !== "@nudojs/core") continue;
    for (const s of stmt.specifiers ?? []) {
      if (s.type !== "ImportSpecifier") continue;
      const imported = s.imported.type === "Identifier" ? s.imported.name : String(s.imported.value);
      if (imported === "fn") out.add(s.local.name);
    }
  }
  return out;
}

/** 顶层本地绑定的初始值（`const x = …`） */
function localBindingInit(ast: Node, name: string): Node | undefined {
  for (const stmt of programBody(ast)) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of getDeclarations(stmt)) {
        const id = getDeclaratorId(d);
        if (id?.name === name) return getDeclaratorInit(d);
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "VariableDeclaration") {
      for (const d of getDeclarations(stmt.declaration)) {
        const id = getDeclaratorId(d);
        if (id?.name === name) return getDeclaratorInit(d);
      }
    }
  }
  return undefined;
}

/** 初始值是否是 `fn({ … }, …)` 形态（允许链式调用与本地别名） */
function isFnFormInit(
  ast: Node,
  init: Node,
  fnLocals: Set<string>,
  seen: Set<string>,
): boolean {
  let cur: Node | undefined = init;
  // 链式：`fn({…}).gt(0)` —— 剥掉成员访问链
  while (cur && (cur.type === "MemberExpression" || cur.type === "OptionalMemberExpression")) {
    cur = (cur as Node & { object?: Node }).object;
  }
  if (!cur) return false;
  if (cur.type === "CallExpression") {
    const callee = (cur as Node & { callee?: Node }).callee;
    return callee?.type === "Identifier" && fnLocals.has(callee.name);
  }
  // 本地别名：`const c = fn({…}); export const x = c;`
  if (cur.type === "Identifier") {
    const name = (cur as { name?: string }).name;
    if (!name || seen.has(name)) return false;
    seen.add(name);
    const aliasInit = localBindingInit(ast, name);
    if (!aliasInit) return false;
    return isFnFormInit(ast, aliasInit, fnLocals, seen);
  }
  return false;
}

/**
 * 光标处的标识符是否是**成员属性**（`obj.x` 的 x，非 computed）。
 * 成员属性没有来源：工作区「同名导出兜底」不得对它生效（否则 F12 会跳到
 * 毫不相干的另一个文件里的同名导出）。
 */
export function isMemberAccessAt(
  ast: Node,
  line: number,
  column: number,
): boolean {
  let hit = false;
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
          const parent = path.parent as
            | (Node & { type: string; property?: Node; computed?: boolean })
            | null;
          if (
            parent &&
            (parent.type === "MemberExpression" ||
              parent.type === "OptionalMemberExpression") &&
            parent.property === path.node &&
            parent.computed !== true
          ) {
            hit = true;
          }
          path.stop();
        }
      },
    });
  } catch {
    /* partial AST */
  }
  return hit;
}

/**
 * 当前文件里 `ident` 是否是**带别名**的 import 本地名。
 *
 * `import { a as b }` 里的 `b` 是**本地符号**（另一个绑定），不是目标模块
 * 的导出 `a` ⇒ 改 `b` 不得连坐改目标模块（见 Bug 710）。
 */
export function isLocalAliasSymbol(ast: Node, ident: string): boolean {
  const binding = collectImportBindings(ast, "").get(ident);
  return binding?.aliased === true;
}

/**
 * A5：可能的定义位（本地定义优先，其次跨文件，再次侧车契约）。
 * onDefinition 返回 Location[]，便于 F12 跳本地声明，Peek Definition 见侧车。
 *
 * ⚠ **方法面优先**：类 / 对象方法的**方法键不是绑定**（绑定表不收它）⇒
 * 绑定面永远查不到它 ⇒ 先问一次「光标处是不是方法」（{@link methodTargetAt}），
 * 是则走**方法面**（定义位 = 方法键，跨文件同源），否则走绑定面。
 * 协议面与纯函数面因此**同一口径**（此前协议面内联一份方法判据、纯函数面没有
 * ⇒ 直接调用纯函数时方法认不出来 ⇒ 两面分裂）。
 */
export function resolveDefinitionLocations(
  fromFile: string,
  source: string,
  ident: string,
  options: {
    extraFiles?: string[];
    workspaceFallback?: boolean;
    /** 源码覆盖层（打开文档 buffer 优先） */
    sourceProvider?: SourceProvider;
    /** 光标位置（区分 import 说明符的 imported / local 侧） */
    at?: { line: number; column: number };
    /** 本次查询落在**成员属性**上（成员属性不参与工作区同名导出兜底） */
    isMemberAccess?: boolean;
  } = {},
): Array<{ filePath: string; loc: SourceLocation; name: string }> {
  const out: Array<{ filePath: string; loc: SourceLocation; name: string }> = [];
  const ast = parse(source);
  // 方法面（方法键不是绑定 ⇒ 先问方法面；判据与协议面同源）
  if (options.at) {
    const methodTarget = methodTargetAt(ast, options.at.line, options.at.column);
    if (methodTarget) {
      const hits = collectMethodReferencesAcrossFiles(fromFile, source, methodTarget, {
        extraFiles: options.extraFiles,
        sourceProvider: options.sourceProvider,
      });
      const defs = hits.filter((h) => h.kind === "key");
      if (defs.length > 0) {
        return defs.map((h) => ({ filePath: h.uri, loc: h.loc, name: h.name }));
      }
    }
  }
  const table = buildSymbolTable(ast, fromFile);
  // D1：光标位置必须透传 —— 符号表按作用域存同名绑定，不给位置就会落到
  // 另一个作用域的声明（遮蔽）。无位置时 findDefinition 退回 plain-name 兜底。
  const local = findDefinition(table, ident, options.at);
  const cross = findCrossFileDefinition(fromFile, source, ident, {
    at: options.at,
    sourceProvider: options.sourceProvider,
  });
  // import 绑定：真实定义在目标导出；本地 import 说明符作次要位点（Peek）
  // 「导出名身份」（`export { hidden as visible }` 的 visible）：F12 跳到
  // **本地绑定**（`hidden` 的声明）—— 导出说明符的导出侧只是「这个名字的
  // 声明处」，本地绑定才是实现（与停在本地名位的行为一致， Bug 1066）。
  const exportLocal = local ? metaOf(local.loc).exportLocalName : undefined;
  if (exportLocal && local) {
    const localBinding = findDefinition(table, exportLocal, options.at);
    if (localBinding) {
      out.push({ filePath: fromFile, loc: localBinding.loc, name: localBinding.name });
    }
    out.push({ filePath: fromFile, loc: local.loc, name: local.name });
  } else if (cross) {
    out.push(cross);
    if (local) {
      out.push({ filePath: fromFile, loc: local.loc, name: local.name });
    }
  } else if (local) {
    out.push({ filePath: fromFile, loc: local.loc, name: local.name });
  }
  const sidecar = findSidecarContractDefinition(fromFile, ident, {
    extraFiles: options.extraFiles,
    sourceProvider: options.sourceProvider,
  });
  if (sidecar && !out.some((d) => d.filePath === sidecar.filePath)) {
    out.push(sidecar);
  }
  // 同名导出兜底只对**裸标识符**生效：成员属性（obj.x）的 x 没有来源，
  // 跳到工作区里毫不相干的同名导出会把用户带偏。
  if (out.length === 0 && options.workspaceFallback && !options.isMemberAccess) {
    const ws = findWorkspaceExportDefinition(fromFile, ident, {
      extraFiles: options.extraFiles,
      sourceProvider: options.sourceProvider,
    });
    if (ws) out.push(ws);
  }
  return out;
}

/**
 * 「导出名身份」的**声明位**（Bug 1066）。
 *
 * `export { hidden as visible }` 里 **visible**（导出名）与 **hidden**（本地名）
 * 是**两个身份**：
 * - 导出名的声明位 = 导出说明符的**导出侧**（`visible` 那一段）；
 * - 本地名的声明位 = 本地绑定的声明（`const hidden = 1`）。
 *
 * 改名必须按身份分派：改导出名 ⇒ 改导出侧 + importer 的 imported 侧；
 * 改本地名 ⇒ 改本地声明 + 导出说明符的本地侧。
 */
function exportNameDeclarationAt(
  fromFile: string,
  source: string,
  ident: string,
  at: { line: number; column: number },
  options: { sourceProvider?: SourceProvider },
): { filePath: string; loc: SourceLocation; name: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return null;
  }
  // ① 光标在本地 export list 的**导出侧**（`export { a as b }` 的 b）
  for (const stmt of programBody(ast)) {
    if (stmt.type !== "ExportNamedDeclaration" || stmt.source) continue;
    for (const s of stmt.specifiers ?? []) {
      if (s.type !== "ExportSpecifier") continue;
      if (!nodeAtPosition(s.exported, at)) continue;
      const exported = exportSpecifierExportedName(s);
      if (exported === undefined) continue;
      const local = nameOrStringValue(s.local);
      // 同名直出（`export { a }`）⇒ 导出名 == 本地名 ⇒ **同一个**身份
      // （声明位仍是本地绑定的声明 ⇒ 不走本函数）
      if (!local || local === String(exported)) continue;
      return { filePath: fromFile, loc: locFromNode(s.exported), name: String(exported) };
    }
  }
  // ② 光标在 importer 的用法处 ⇒ 符号是目标模块的**导出名**
  //    （目标模块用别名导出 ⇒ 声明位 = 目标模块的导出说明符导出侧）
  const binding = collectImportBindings(ast, fromFile).get(ident);
  if (!binding?.resolvedPath || binding.aliased || binding.importedName === "*") return null;
  const targetSrc = readSourceWith(options.sourceProvider, binding.resolvedPath);
  if (targetSrc === undefined) return null;
  const def = findExportDefinition(
    targetSrc,
    binding.importedName,
    binding.resolvedPath,
    options.sourceProvider,
  );
  if (!def?.exportLoc || !def.exportName) return null;
  return { filePath: binding.resolvedPath, loc: def.exportLoc, name: def.exportName };
}

/**
 * 改名通道的**定义位**。
 *
 * ⚠ 与 {@link resolveDefinitionLocations}（F12 导航面）**刻意不同**：
 * 别名导出（`export { hidden as visible }`）里 **visible**（导出名）与
 * **hidden**（本地名）是两个身份 ——
 * - F12 面：跳到**本地绑定**（`hidden` 的声明）；
 * - 改名面：编辑集必须是**导出名**的身份 ⇒ 定义位取导出说明符的**导出侧**
 *   （改了本地名会把「导出名 ≠ 本地名」的模块图改断，importer 立刻失联，
 *   Bug 1066）。
 */
export function resolveDefinition(
  fromFile: string,
  source: string,
  ident: string,
  options: {
    extraFiles?: string[];
    workspaceFallback?: boolean;
    sourceProvider?: SourceProvider;
    at?: { line: number; column: number };
    isMemberAccess?: boolean;
  } = {},
): { filePath: string; loc: SourceLocation; name: string } | null {
  if (options.at) {
    const exportDecl = exportNameDeclarationAt(fromFile, source, ident, options.at, {
      sourceProvider: options.sourceProvider,
    });
    if (exportDecl) return exportDecl;
  }
  const all = resolveDefinitionLocations(fromFile, source, ident, options);
  return all[0] ?? null;
}

/**
 * 统一 references：本地（作用域绑定）+ 跨文件（import / re-export 了定义文件的调用方）。
 * includeDeclaration=true 时把定义位置也计入（LSP context.includeDeclaration）。
 * `at` 提供时走 collectBindingReferences——同绑定、抗遮蔽、不碰属性名。
 *
 * ⚠ **方法面优先**：`at` 落在**类 / 对象方法**上时走 {@link methodTargetAt} +
 * {@link collectMethodReferencesAcrossFiles}（方法键 + 同源成员访问，**含跨文件**）
 * —— 方法键不是绑定 ⇒ 绑定面查不到它；跨文件同源 ⇒ 与改名面口径一致
 * （此前 references 只扫当前文件、rename 却跨文件 ⇒ 两面分裂）。
 *
 * 符号归属判定（决定跨文件口径）：
 * 1. 光标在 import / re-export 说明符上 ⇒ 符号是**目标模块的导出**；
 * 2. 本文件的 ident 是**带别名**的 import 绑定 ⇒ 符号是**本地别名**（只改本地）；
 * 3. 本文件的 ident 是 import 绑定（无别名）⇒ 符号是目标模块的导出；
 * 4. 本文件的 ident 是**导出**绑定 ⇒ 符号是本文件的导出（跨文件同步）。
 */
export function resolveReferences(
  fromFile: string,
  source: string,
  ident: string,
  options: {
    extraFiles?: string[];
    includeDeclaration?: boolean;
    at?: { line: number; column: number };
    /** 源码覆盖层（打开文档 buffer 优先） */
    sourceProvider?: SourceProvider;
  } = {},
): ReferenceInfo[] {
  const includeDecl = options.includeDeclaration !== false;
  const ast = parse(source);
  // 方法面优先（方法键不是绑定 ⇒ 绑定面查不到）
  if (options.at) {
    const methodTarget = methodTargetAt(ast, options.at.line, options.at.column);
    if (methodTarget) {
      const hits = collectMethodReferencesAcrossFiles(fromFile, source, methodTarget, {
        extraFiles: options.extraFiles,
        sourceProvider: options.sourceProvider,
      });
      const refs = hits
        .filter((h) => includeDecl || h.kind !== "key")
        .map((h) => ({ name: h.name, loc: h.loc, uri: h.uri }));
      if (refs.length > 0) return refs;
    }
  }
  const table = buildSymbolTable(ast, fromFile);
  // D1：includeDeclaration 必须透传给引用收集（声明位在 collectBindingReferences
  // 里也会出现一次；不透传 ⇒ context.includeDeclaration=false 仍返回声明位）。
  const localRefs = options.at
    ? collectBindingReferences(ast, ident, options.at, fromFile, {
        includeDeclaration: includeDecl,
      })
    : findReferences(table, ident, options.at);
  // D1：光标位置必须透传 —— 同名绑定按作用域存，不给位置会拿到别的作用域的声明。
  const localDef = findDefinition(table, ident, options.at);
  const declOf = (def: { name: string; loc: SourceLocation }): ReferenceInfo[] =>
    includeDecl ? [{ name: def.name, loc: def.loc, uri: fromFile }] : [];
  const dedup = (...groups: ReferenceInfo[][]): ReferenceInfo[] => {
    const seen = new Set<string>();
    const all: ReferenceInfo[] = [];
    for (const r of groups.flat()) {
      const key = `${r.uri ?? ""}:${r.loc.start.line}:${r.loc.start.column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
    }
    return all;
  };

  // ① 光标在 import / re-export 说明符上
  const hit = options.at ? findEdgeAt(ast, fromFile, options.at) : null;
  if (hit) {
    // 本地别名（`import { a as b }` 的 b 侧）⇒ 只改本地
    if (hit.kind === "import" && hit.side === "local" && hit.aliased) {
      return dedup(localDef ? declOf(localDef) : [], localRefs);
    }
    // re-export 的 exported 侧（`export { a as b } from` 的 b）⇒ 本模块的对外名
    if (hit.kind === "reexport" && hit.side === "exported" && hit.exportedLoc) {
      return [{ name: ident, loc: hit.exportedLoc, uri: fromFile }];
    }
    if (!hit.resolvedPath) return localRefs;
    return referencesOfExportedSymbol(hit.resolvedPath, hit.importedName, {
      fromFile,
      at: options.at,
      includeDecl,
      extraFiles: options.extraFiles,
      sourceProvider: options.sourceProvider,
      localRefs,
    });
  }

  // ② 本文件的 ident 是 import 绑定
  const binding = collectImportBindings(ast, fromFile).get(ident);
  if (binding?.resolvedPath) {
    // 带别名 ⇒ 符号是本地别名（imported 侧是对目标导出的引用，不是本地绑定）
    if (binding.aliased) {
      return dedup(localDef ? declOf(localDef) : [], localRefs);
    }
    if (binding.importedName === "*") {
      // 命名空间导入：引用面是 `ns.<name>` 成员访问（本地绑定不跨文件）
      return dedup(localDef ? declOf(localDef) : [], localRefs);
    }
    return referencesOfExportedSymbol(binding.resolvedPath, binding.importedName, {
      fromFile,
      at: options.at,
      includeDecl,
      extraFiles: options.extraFiles,
      sourceProvider: options.sourceProvider,
      localRefs,
    });
  }

  // ③ 本地定义：扫描 import / re-export 本文件的其它文件
  if (localDef) {
    const meta = metaOf(localDef.loc);
    // 「导出名身份」（`export { hidden as visible }` 的 visible）：符号是**导出名**
    // ⇒ 跨文件引用 = importer 们对该**导出名**的引用（不是本地名的）
    const exportLocal = meta.exportLocalName;
    if (exportLocal) {
      const exportNames = exportedNamesOfLocal(ast, exportLocal);
      const cross =
        exportNames.length > 0
          ? findCrossFileReferences(fromFile, exportLocal, {
              extraFiles: options.extraFiles,
              sourceProvider: options.sourceProvider,
              exportNames,
            })
          : [];
      return dedup(declOf(localDef), localRefs, cross);
    }
    // 本地绑定身份：只认**以自己的名字**对外的导出名
    // （`export { f as g }` 的 `g` 是**另一个**身份 ⇒ 改 `f` 不得连坐 `g` 的
    //   importer；`export default f` 的 "default" 仍是 `f` 自己 ⇒ 算）
    const exportName = localDef.name;
    const directNames = directExportNamesOfLocal(ast, exportName);
    const cross =
      directNames.length > 0
        ? findCrossFileReferences(fromFile, exportName, {
            extraFiles: options.extraFiles,
            sourceProvider: options.sourceProvider,
            exportNames: directNames,
          })
        : [];
    return dedup(declOf(localDef), localRefs, cross);
  }

  return localRefs;
}

/**
 * 「某个模块的某个导出」的引用集合 = 定义位 + 定义文件内的引用 +
 * 所有 importer / re-exporter 的引用位。
 */
function referencesOfExportedSymbol(
  definingFile: string,
  exportName: string,
  opts: {
    fromFile: string;
    at?: { line: number; column: number };
    includeDecl: boolean;
    extraFiles?: string[];
    sourceProvider?: SourceProvider;
    localRefs: ReferenceInfo[];
  },
): ReferenceInfo[] {
  const defSource = readSourceWith(opts.sourceProvider, definingFile) ?? "";
  let defAst: Node | null = null;
  try {
    defAst = parse(defSource);
  } catch {
    defAst = null;
  }
  const defLocalRefs: ReferenceInfo[] = [];
  let defDecl: ReferenceInfo[] = [];
  // 定义文件里的**本地名**（default 导出的本地名 ≠ 导出名 "default"）
  let localNameInDef = exportName;
  // 别名导出（`export { hidden as visible }`）⇒ 符号是**导出名** `visible`，
  // 本地名 `hidden` 是**另一个**身份（Bug 1066）
  let exportedNameInDef = exportName;
  let exportedLocInDef: SourceLocation | undefined;
  if (defAst) {
    const def = findExportDefinition(defSource, exportName, definingFile, opts.sourceProvider);
    if (def) {
      localNameInDef = def.name;
      exportedNameInDef = def.exportName ?? def.name;
      exportedLocInDef = def.exportLoc;
    }
    const defTable = buildSymbolTable(defAst, definingFile);
    if (def?.exportLoc && exportedNameInDef !== localNameInDef) {
      // 别名导出：定义文件内的引用 = 导出说明符的**导出侧**
      // （本地名 `hidden` 的声明 / 引用属于**另一个**身份 ⇒ 不得进编辑集：
      //   改了会把「导出名 ≠ 本地名」的模块图改断，importer 立刻失联）
      if (opts.includeDecl && exportedLocInDef) {
        defDecl = [{ name: exportedNameInDef, loc: exportedLocInDef, uri: definingFile }];
      }
    } else {
      if (opts.at && def) {
        // 目标文件：从定义位点收集同绑定
        // D1：includeDeclaration 同样要透传（声明位在引用集合里也出现一次）
        defLocalRefs.push(
          ...collectBindingReferences(
            defAst,
            localNameInDef,
            { line: def.loc.start.line, column: def.loc.start.column },
            definingFile,
            { includeDeclaration: opts.includeDecl },
          ),
        );
      } else {
        defLocalRefs.push(...findReferences(defTable, localNameInDef));
      }
      const d = findDefinition(defTable, localNameInDef);
      if (d && opts.includeDecl) {
        defDecl = [{ name: d.name, loc: d.loc, uri: definingFile }];
      }
    }
  }

  const cross = findCrossFileReferences(definingFile, localNameInDef, {
    extraFiles: [...(opts.extraFiles ?? []), opts.fromFile],
    sourceProvider: opts.sourceProvider,
  });

  const seen = new Set<string>();
  const all: ReferenceInfo[] = [];
  for (const r of [...defDecl, ...defLocalRefs, ...opts.localRefs, ...cross]) {
    const key = `${r.uri ?? ""}:${r.loc.start.line}:${r.loc.start.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(r);
  }
  return all;
}

/**
 * 本地绑定 `name` 在本文件里对外的**导出名**集合。
 * - `export function f` / `export const f` ⇒ {"f"}
 * - `export default function f` / `export default f` ⇒ {"default"}（default 是一等导出名）
 * - `export { f as g }` ⇒ {"g"}
 * - re-export（`export { f } from "./m"`）⇒ {}（f 不是本文件的本地绑定）
 */
export function exportedNamesOfLocal(ast: Node, name: string): string[] {
  const out: string[] = [];
  for (const stmt of programBody(ast)) {
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) {
        const d: Node = stmt.declaration;
        if (d.type === "FunctionDeclaration" && d.id?.name === name) out.push(name);
        if (d.type === "ClassDeclaration" && d.id?.name === name) out.push(name);
        if (d.type === "VariableDeclaration") {
          for (const dec of getDeclarations(d)) {
            const id = getDeclaratorId(dec);
            if (id?.name === name) out.push(name);
          }
        }
        continue;
      }
      // 本地 export list（无 source）：`export { f }` / `export { f as g }`
      for (const s of stmt.specifiers ?? []) {
        if (s.type !== "ExportSpecifier") continue;
        const local = nameOrStringValue(s.local);
        if (local !== name) continue;
        const exported = exportSpecifierExportedName(s);
        if (exported === undefined) continue;
        out.push(String(exported));
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d: Node = stmt.declaration;
      if (fnOrClassIdName(d) === name) out.push("default");
      if (d?.type === "Identifier" && d.name === name) out.push("default");
    }
  }
  return out;
}

/**
 * 本地绑定 `name` 在本文件里**以自己的名字**对外的导出名集合（Bug 1066）。
 *
 * - `export function f` / `export const f` / `export { f }` ⇒ {"f"}
 * - `export default function f` / `export default f` ⇒ {"default"}
 *   （default 导出**就是**这个本地绑定 ⇒ 改名要连 importer 一起改）
 * - `export { f as g }` ⇒ **{}** —— `g` 是**另一个**身份（对外的公开名），
 *   改本地绑定 `f` **不得**连坐 `g` 的 importer（否则模块图断裂）。
 * - re-export（`export { f } from "./m"`）⇒ {}（`f` 不是本文件的本地绑定）
 */
function directExportNamesOfLocal(ast: Node, name: string): string[] {
  const out: string[] = [];
  const push = (n: string): void => {
    if (!out.includes(n)) out.push(n);
  };
  for (const stmt of programBody(ast)) {
    if (stmt.type === "ExportNamedDeclaration") {
      if (stmt.declaration) {
        const d: Node = stmt.declaration;
        if (d.type === "FunctionDeclaration" && d.id?.name === name) push(name);
        if (d.type === "ClassDeclaration" && d.id?.name === name) push(name);
        if (d.type === "VariableDeclaration") {
          for (const dec of getDeclarations(d)) {
            const id = getDeclaratorId(dec);
            if (id?.name === name) push(name);
          }
        }
        continue;
      }
      // 本地 export list（无 source）：`export { f }` / `export { f as g }`
      if (stmt.source) continue;
      for (const s of stmt.specifiers ?? []) {
        if (s.type !== "ExportSpecifier") continue;
        const local = nameOrStringValue(s.local);
        if (local !== name) continue;
        const exported = exportSpecifierExportedName(s);
        if (exported === undefined) continue;
        // 别名导出（`export { f as g }`）⇒ `g` 属于**另一个**身份 ⇒ 不计
        if (String(exported) === name) push(name);
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d: Node = stmt.declaration;
      if (fnOrClassIdName(d) === name) push("default");
      if (d?.type === "Identifier" && d.name === name) push("default");
    }
  }
  return out;
}
