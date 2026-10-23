/**
 * B2 — refactor.inline（内联纯局部绑定）+ refactor.changeSignature
 * （参数改可选 = 默认 undefined）。纯函数，金标可测。
 */
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";
import { traverseEsm } from "./traverse-esm.ts";

export type TextEdit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

function locRange(node: Node): TextEdit["range"] | null {
  if (!node.loc) return null;
  return {
    start: { line: node.loc.start.line - 1, character: node.loc.start.column },
    end: { line: node.loc.end.line - 1, character: node.loc.end.column },
  };
}

/** （0 基）行号 + 列号 → 源码绝对偏移 */
function offsetAt(source: string, line: number, character: number): number {
  const lines = source.split("\n");
  let off = 0;
  for (let i = 0; i < line; i++) off += (lines[i] ?? "").length + 1;
  return off + character;
}

/** 区间内的源码文本 */
function textIn(source: string, range: TextEdit["range"]): string {
  const s = offsetAt(source, range.start.line, range.start.character);
  const t = offsetAt(source, range.end.line, range.end.character);
  return source.slice(s, t);
}

/** 两个区间是否相交（LSP：同一 change 数组内的 TextEdit 不得重叠） */
function rangesOverlap(a: TextEdit["range"], b: TextEdit["range"]): boolean {
  const before = (
    p: { line: number; character: number },
    q: { line: number; character: number },
  ): boolean => p.line < q.line || (p.line === q.line && p.character < q.character);
  return before(a.start, b.end) && before(b.start, a.end);
}

/**
 * 纯表达式：内联不重复副作用。
 *
 * Bug 741：成员读（`obj.total`）**可能是 getter / Proxy get 陷阱** ⇒ 内联把
 * 一次读换成 N 次读 ⇒ 副作用次数与结果都变。本函数只有 AST、没有类型信息，
 * 无法证明「该对象上没有访问器」⇒ 成员读一律判为**可能有副作用**（不内联）。
 */
function isPureExpr(node: Node): boolean {
  const t = node.type;
  if (
    t === "Identifier" ||
    t === "StringLiteral" ||
    t === "NumericLiteral" ||
    t === "BooleanLiteral" ||
    t === "NullLiteral"
  ) {
    return true;
  }
  if (t === "MemberExpression") {
    // Bug 741：成员读可能有 getter / Proxy 陷阱 ⇒ 判为可能有副作用
    return false;
  }
  if (t === "BinaryExpression" || t === "LogicalExpression") {
    const b = node as unknown as { left: Node; right: Node };
    return isPureExpr(b.left) && isPureExpr(b.right);
  }
  if (t === "UnaryExpression") {
    const u = node as unknown as { argument: Node; operator: string };
    return u.operator !== "delete" && u.operator !== "throw" && isPureExpr(u.argument);
  }
  return false;
}

/** 原子表达式无需加括号；复合表达式内联时加括号保优先级 */
function needsParens(node: Node): boolean {
  return !(
    node.type === "Identifier" ||
    node.type === "StringLiteral" ||
    node.type === "NumericLiteral" ||
    node.type === "BooleanLiteral" ||
    node.type === "NullLiteral" ||
    node.type === "MemberExpression"
  );
}

/** `path.get("init")` 的最小结构面（只用到 node / scope / traverse） */
type InitPathLike = {
  node: Node;
  scope: { getBinding(name: string): unknown };
  traverse(visitors: {
    ReferencedIdentifier?: (p: { node: Node }) => void;
  }): void;
};

/**
 * Bug 738 —— 被捕获的**自由变量**在「声明点 ↔ 使用点」之间取值是否不变。
 *
 * 内联的安全前提是「被捕获的表达式在声明点与使用点之间取值不变」。原来只验了
 * 更弱的两件事（表达式无副作用 + **被内联的变量自己**没被重赋值）⇒ 被引用的
 * 自由变量在中间被改写这一情形两道门都挡不住（`let a = 1; const x = a; a = 2;`
 * 内联后 `f()` 从 1 变 2）。
 *
 * 判据：init 里每个**自由引用标识符**的绑定若存在写入（constantViolations）
 * ⇒ 放弃内联。作用域外未声明的名字（全局）无法证明被写过 ⇒ 放行。
 * 自引用（`const x = x`）是 TDZ ⇒ 同样放弃。
 */
function freeVarsStable(initPath: InitPathLike, selfName: string): boolean {
  const names: string[] = [];
  if (initPath.node.type === "Identifier") {
    names.push((initPath.node as unknown as { name: string }).name);
  }
  initPath.traverse({
    ReferencedIdentifier(p: { node: Node }) {
      names.push((p.node as unknown as { name: string }).name);
    },
  });
  for (const name of names) {
    if (name === selfName) return false; // 自引用（TDZ）⇒ 拒绝
    const binding = initPath.scope.getBinding(name) as
      | { constantViolations?: unknown[] }
      | undefined;
    if (binding && (binding.constantViolations?.length ?? 0) > 0) return false;
  }
  return true;
}

/**
 * Bug 744 —— 绑定是否参与模块导出（`export const X` / `export { X }`）。
 *
 * 内联会**删除声明** ⇒ 导出绑定被内联 = 模块公开 API 变化 ⇒ 不可内联。
 * Babel 对导出绑定的 `binding.referencePaths` 里会多塞「声明本身」
 * （ExportNamedDeclaration）或导出说明符（ExportSpecifier）⇒ 这两类节点
 * **不是使用点**，既不能当引用替换，也不能被删除。
 */
function isExportedBinding(
  declGrandparent: string | undefined,
  referencePaths: Array<{ node: Node; parentPath?: { node?: Node } }>,
): boolean {
  if (
    declGrandparent === "ExportNamedDeclaration" ||
    declGrandparent === "ExportDefaultDeclaration"
  ) {
    return true;
  }
  for (const r of referencePaths) {
    if (r.node.type !== "Identifier") return true; // 声明侧节点（ExportNamedDeclaration 等）
    const pt = r.parentPath?.node?.type;
    if (
      pt === "ExportSpecifier" ||
      pt === "ExportNamedDeclaration" ||
      pt === "ExportDefaultDeclaration"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Bug 733 + Bug 970 —— 声明语句的删除 / 改写 edit。
 *
 * - **单 declarator**：删**声明语句自身**的区间（`const a = 1;` 整条，不是整行）；
 *   只有当该声明**独占一行**时才把区间扩到整行（含换行）—— 同行兄弟语句必须保留
 *   （Bug 733：整行扩大会把 `const a = 1; doSomething(a);` 里的 `doSomething(a);`
 *   一起删掉）。声明与兄弟语句同行时只删声明本身，并把紧邻的横向空白一并吃掉。
 * - **多 declarator**：不能只删一段（会留下 `const , b = 2;` 的语法错）⇒
 *   **改写整条声明**：去掉被内联的那个 declarator（含它的分隔逗号）、保留兄弟
 *   （Bug 970：删整条 `VariableDeclaration` 会把兄弟 declarator 的声明一起删掉 ⇒
 *   运行即 ReferenceError）。
 *
 * 逗号手术按 **declarator 节点区间**（`a = 1` / `b = 2`，不是标识符区间）做：
 * - 非最后一个 ⇒ 切 `[本 declarator 起点, 下一个 declarator 起点)`（含其后逗号）；
 * - 最后一个 ⇒ 切 `[本 declarator 之前最近的逗号, 本 declarator 终点)`。
 */
function declarationEdit(
  source: string,
  decl: Node,
  target: Node,
  declRange: TextEdit["range"],
): TextEdit | null {
  const decls = (decl as unknown as { declarations?: Node[] }).declarations ?? [];
  if (decls.length <= 1) {
    const lines = source.split("\n");
    const startLine = declRange.start.line;
    const endLine = declRange.end.line;
    const startLineText = lines[startLine] ?? "";
    const endLineText = lines[endLine] ?? "";
    const before = startLineText.slice(0, declRange.start.character);
    const after = endLineText.slice(declRange.end.character);
    if (before.trim() === "" && after.trim() === "") {
      // 声明独占一行 ⇒ 整行删（含换行）
      const end =
        endLine < lines.length - 1
          ? { line: endLine + 1, character: 0 }
          : { line: endLine, character: endLineText.length };
      return {
        range: { start: { line: startLine, character: 0 }, end },
        newText: "",
      };
    }
    // 声明与同行兄弟语句共存 ⇒ 只删声明本身（Bug 733）
    const trimmed = /^[ \t]*/.exec(after);
    const endChar = declRange.end.character + (trimmed?.[0].length ?? 0);
    return {
      range: {
        start: declRange.start,
        end: { line: declRange.end.line, character: endChar },
      },
      newText: "",
    };
  }
  // 多 declarator ⇒ 改写整条声明（Bug 970）
  const idx = decls.indexOf(target);
  if (idx < 0) return null;
  const declText = textIn(source, declRange);
  const declStart = offsetAt(source, declRange.start.line, declRange.start.character);
  const rel = (node: Node): { s: number; e: number } | null => {
    if (!node.loc) return null;
    return {
      s: offsetAt(source, node.loc.start.line - 1, node.loc.start.column) - declStart,
      e: offsetAt(source, node.loc.end.line - 1, node.loc.end.column) - declStart,
    };
  };
  const t = rel(target);
  if (!t) return null;
  let cutStart: number;
  let cutEnd: number;
  if (idx < decls.length - 1) {
    // 不是最后一个 ⇒ 连同它后面的逗号一起去掉
    const next = rel(decls[idx + 1]!);
    if (!next) return null;
    cutStart = t.s;
    cutEnd = next.s;
  } else {
    // 最后一个 ⇒ 连同它前面的逗号一起去掉
    cutStart = declText.lastIndexOf(",", t.s);
    if (cutStart < 0) return null;
    cutEnd = t.e;
  }
  if (cutEnd <= cutStart) return null;
  return {
    range: declRange,
    newText: declText.slice(0, cutStart) + declText.slice(cutEnd),
  };
}

/**
 * 内联变量：`const x = <pure>;` 后所有 x 的引用换成 <pure>，并删掉声明。
 * 仅当 init 是纯表达式且至少有一个引用（或 0 引用也可删，title 提示 unused）。
 */
export function inlineVariableAt(
  source: string,
  line: number,
  column: number,
): { title: string; edits: TextEdit[] } | { error: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return { error: "parse error" };
  }
  type Hit = {
    name: string;
    initSrc: string;
    refs: Array<{ range: TextEdit["range"] }>;
    declEdit: TextEdit;
  };
  let hit: Hit | null = null;

  try {
    traverseEsm()(ast, {
      VariableDeclarator(path) {
        const d = path.node;
        if (d.id.type !== "Identifier" || !d.init) return;
        const declLoc = path.parent?.loc ?? d.loc;
        if (!declLoc) return;
        if (
          declLoc.start.line !== line &&
          d.id.loc?.start.line !== line
        ) {
          return;
        }
        // 光标落在声明标识符或 init 上
        const idLoc = d.id.loc;
        const initLoc = d.init.loc;
        const onId =
          idLoc &&
          idLoc.start.line === line &&
          idLoc.start.column <= column &&
          idLoc.end.column >= column;
        const onInit =
          initLoc &&
          initLoc.start.line === line &&
          initLoc.start.column <= column &&
          initLoc.end.column >= column;
        if (!onId && !onInit) return;
        // Bug 741：成员读可能是 getter / Proxy get 陷阱 ⇒ 判为可能有副作用 ⇒ 不内联
        if (!isPureExpr(d.init)) return;

        const binding = path.scope.getBinding(d.id.name);
        if (binding?.constantViolations?.length) return; // 有再赋值不内联

        // Bug 744：导出绑定不可内联 —— 内联会**删除声明** ⇒ 模块公开 API 变化；
        // 且 Babel 会把「声明本身」塞进 referencePaths ⇒ 会多出一条与删除 edit
        // 重叠的替换 edit ⇒ 客户端应用后源码被毁。
        const declGrandparent = (
          path as unknown as {
            parentPath?: { parentPath?: { node?: { type?: string } } };
          }
        ).parentPath?.parentPath?.node?.type;
        if (
          isExportedBinding(
            declGrandparent,
            (binding?.referencePaths ?? []) as unknown as Array<{
              node: Node;
              parentPath?: { node?: Node };
            }>,
          )
        ) {
          return;
        }

        // Bug 738：被捕获的**自由变量**在「声明点 ↔ 使用点」之间取值必须不变
        const initPath = (path as unknown as { get(key: string): InitPathLike }).get(
          "init",
        );
        if (!freeVarsStable(initPath, d.id.name)) return;

        // 真正的使用点（过滤声明侧节点：ExportNamedDeclaration / ExportSpecifier）
        const refs: Hit["refs"] = [];
        for (const r of binding?.referencePaths ?? []) {
          if (r.node.type !== "Identifier") continue;
          const pt = r.parentPath?.node?.type;
          if (
            pt === "ExportSpecifier" ||
            pt === "ExportNamedDeclaration" ||
            pt === "ExportDefaultDeclaration"
          ) {
            continue;
          }
          const range = locRange(r.node);
          if (range) refs.push({ range });
        }

        const declRange =
          locRange(path.parent as unknown as Node) ?? locRange(d as unknown as Node);
        const initRange = locRange(d.init);
        if (!declRange || !initRange) return;
        const initSrc = textIn(source, initRange);
        // Bug 733 + Bug 970：删除 / 改写范围由 declarationEdit 统一裁决
        const declEdit = declarationEdit(
          source,
          path.parent as unknown as Node,
          d as unknown as Node,
          declRange,
        );
        if (!declEdit) return;

        hit = {
          name: d.id.name,
          initSrc: needsParens(d.init) ? `(${initSrc})` : initSrc,
          refs,
          declEdit,
        };
        path.stop();
      },
    });
  } catch {
    return { error: "parse error" };
  }

  if (!hit) return null;
  const h = hit as Hit;
  const edits: TextEdit[] = [];
  for (const r of h.refs) {
    edits.push({ range: r.range, newText: h.initSrc });
  }
  edits.push(h.declEdit);
  // Bug 744：同一 change 数组内的 TextEdit **不得重叠**（LSP 规范）——
  // 相交即放弃该动作，绝不产出非法 WorkspaceEdit。
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      if (rangesOverlap(edits[i]!.range, edits[j]!.range)) return null;
    }
  }

  return {
    title:
      h.refs.length === 0
        ? `Remove unused '${h.name}'`
        : `Inline variable '${h.name}' (${h.refs.length} use${h.refs.length === 1 ? "" : "s"})`,
    edits,
  };
}

/**
 * Bug 739 —— 该形参是否位于**无括号箭头形参**位。
 *
 * `items.map(v => …)` 的形参 `v` 没有括号包裹 ⇒ 把 `v = undefined` 直接塞进去会被
 * 重新解析成**赋值表达式**（`v = (undefined => …)`）⇒ 运行时 ReferenceError。
 *
 * 判据：形参区间之后（跳过空白）若是 `)` ⇒ 已被括号包裹；若是 `=>` ⇒ 无括号。
 * 判不出来时**保守补括号**（`(v = undefined) => …` 两种形态都合法）。
 */
function isBareArrowParam(source: string, parent: Node, range: TextEdit["range"]): boolean {
  if (parent.type !== "ArrowFunctionExpression") return false;
  const params = (parent as unknown as { params?: Node[] }).params ?? [];
  if (params.length !== 1) return false;
  const lines = source.split("\n");
  const lineText = lines[range.end.line] ?? "";
  const rest = lineText.slice(range.end.character);
  const m = /^[ \t]*(.)/.exec(rest);
  if (!m) return true; // 形参后面换行（`v =>` 折行）⇒ 仍是无括号形态
  if (m[1] === ")") return false; // 已被括号包裹
  if (m[1] === "=") return rest.slice(m[0].length).startsWith(">");
  return true; // 判不出来 ⇒ 保守补括号
}

/**
 * 签名修改：把形参改成可选（`x` → `x = undefined`）。
 * JS 侧调用点不必改；契约侧仍可 refine。
 *
 * - Bug 739：无括号箭头形参必须**补括号**（否则产出 `v = undefined => …`，被重新
 *   解析成赋值表达式 ⇒ 运行时 ReferenceError）。
 * - Bug 1024：剥 TS 时 `strip-types` 只删 `TSTypeAnnotation` 节点、**不改写
 *   `Identifier` 的 loc** ⇒ 区间仍是 `x: number` ⇒ 必须把类型标注**拼回**新文本
 *   （`x: number = undefined`），否则用户的类型标注被静默删掉。
 */
export function makeParamOptionalAt(
  source: string,
  line: number,
  column: number,
): { title: string; edits: TextEdit[] } | { error: string } | null {
  let ast: Node;
  try {
    ast = parse(source);
  } catch {
    return { error: "parse error" };
  }
  type Hit = { name: string; range: TextEdit["range"]; newText: string };
  let hit: Hit | null = null;
  try {
    traverseEsm()(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (loc.start.line !== line || loc.start.column > column || loc.end.column < column) {
          return;
        }
        const parent = path.parent;
        if (!parent) return;
        const isParam =
          (parent.type === "FunctionDeclaration" ||
            parent.type === "FunctionExpression" ||
            parent.type === "ArrowFunctionExpression") &&
          (parent as unknown as { params: Node[] }).params?.includes(path.node);
        if (!isParam) return;
        // 已是 AssignmentPattern 的 left 则已可选
        const gp = (path as unknown as { parentPath?: { node?: Node } }).parentPath?.node;
        if (gp && gp.type === "AssignmentPattern") return;
        const range = locRange(path.node);
        if (!range) return;
        // Bug 1024：形参文本（含 TS 类型标注）。剥 TS 后 `Identifier` 的 loc 仍覆盖
        // `x: number` ⇒ 类型标注就在这段文本里，必须原样带进新文本。
        const covered = textIn(source, range);
        const name = path.node.name;
        const typeText = (path.node as unknown as { nudoTypeText?: string })
          .nudoTypeText;
        let paramText: string;
        if (typeText) {
          paramText = `${name}: ${typeText}`;
        } else if (covered.startsWith(name) && covered.length > name.length) {
          // 有标注但旁路没挂上 ⇒ 用源码原文兜底（不丢用户写的类型）
          paramText = covered;
        } else {
          paramText = name;
        }
        // Bug 739：无括号箭头形参 ⇒ 必须补括号
        const bare = isBareArrowParam(source, parent, range);
        hit = {
          name,
          range,
          newText: bare ? `(${paramText} = undefined)` : `${paramText} = undefined`,
        };
        path.stop();
      },
    });
  } catch {
    return { error: "parse error" };
  }
  if (!hit) return null;
  const h = hit as Hit;
  return {
    title: `Change signature: make '${h.name}' optional`,
    edits: [{ range: h.range, newText: h.newText }],
  };
}
