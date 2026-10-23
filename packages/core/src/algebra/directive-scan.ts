/**
 * 单源 `@nudo:` 指令文法 + G2 作用域绑定（D5=F1, D6=G2）。
 *
 * 作用域契约（G2）：函数级指令绑定 **AST 最近 Function** —— FunctionDeclaration /
 * VariableDeclarator 函数初始化 / FunctionExpression / ArrowFunctionExpression /
 * ClassMethod / ObjectMethod，含 nested function 与 class method。
 * 同一函数的 `@nudo:case` 与 `@nudo:contract` 必须同时可见（共用本模块的 scope 绑定）。
 *
 * 文法契约（前缀）：`//` 与 `///` 等价；只认行注释与 JSDoc 块注释；
 * 字符串/模板/块注释正文里的同形文本不是指令。文件级（env / mock-module / import）
 * 不绑函数；其余标签绑最近 Function。
 *
 * 抽取单源：实现住在 core（parser 依赖 core，反向会成包环）；`@nudojs/parser`
 * re-export 本模块的文本级 API 作为产品面。core refine / load-deps / check-case-scan
 * 与 nudojs CLI 只消费，不得再自带正则文法。
 */

import type { Comment, File, Node } from "@babel/types";
import { maskStringsKeepComments } from "./code-text.ts";
import { parseSource } from "./parse-source.ts";

// ---------------------------------------------------------------------------
// 前缀 / 行清洗
// ---------------------------------------------------------------------------

/**
 * 注释行清洗：去 JSDoc 续行 `*` 前缀、行注释 `///` 残留的单个 `/`。
 * `////`（Babel 值以 `//` 开头）不是指令前缀——不剥，后面标签匹配自然失败。
 */
export function cleanDirectiveLine(raw: string, kind: "line" | "block"): string {
  let s = raw;
  if (kind === "block") {
    s = s.replace(/^\s*\*\s?/, "");
  } else {
    // comment.value 已去掉 `//`；`///` 形态残留一个 `/`
    s = s.replace(/^\//, "");
  }
  return s.trim();
}

/** 注释块 → 清洗后的指令行（文档序） */
export function commentTextToLines(text: string, kind: "line" | "block"): string[] {
  return text.split("\n").map((line) => cleanDirectiveLine(line, kind));
}

// ---------------------------------------------------------------------------
// G2 作用域：AST 最近 Function
// ---------------------------------------------------------------------------

export type FnDirectiveScope = {
  /** 绑定名：`f` / `C.m` / `C.static.m` / `default` / `<anonymous>` */
  name: string;
  node: Node;
  /** 该函数的前导注释块（comment.value 原文，文档序） */
  commentTexts: string[];
  /** commentTexts 清洗后的行 */
  commentLines: string[];
  /** 与 commentTexts 对齐的注释起始行号 */
  commentStartLines: number[];
  startLine: number;
  /**
   * 词法嵌套深度：0 = 顶层函数 / 类成员；每进入一层函数体 +1。
   *
   * Bug 424：scope 名**不唯一**（同名遮蔽函数 / 嵌套函数）⇒「按名 + 文档序
   * 首个命中」会让**内层**同名函数抢走导出函数的注释块 ⇒ L2 门禁假绿 / 假红。
   * ⇒ 按名查找取**最浅**（depth 最小）的那个。
   */
  depth?: number;
  /** 宿主名（类名 / 外层函数名）；顶层为 undefined */
  owner?: string;
};

function commentKind(c: Comment): "line" | "block" {
  return c.type === "CommentLine" ? "line" : "block";
}

function buildScope(
  name: string,
  node: Node,
  wrapper: Node | undefined,
  comments: readonly Comment[] | undefined,
  wrapperComments: readonly Comment[] | undefined,
  depth = 0,
  owner?: string,
): FnDirectiveScope {
  const seen = new Set<Comment>();
  const texts: string[] = [];
  const startLines: number[] = [];
  const lines: string[] = [];
  for (const c of [...(wrapperComments ?? []), ...(comments ?? [])]) {
    if (seen.has(c)) continue;
    seen.add(c);
    texts.push(c.value);
    startLines.push((c as { loc?: { start?: { line?: number } } }).loc?.start?.line ?? 0);
    for (const line of commentTextToLines(c.value, commentKind(c))) lines.push(line);
  }
  const loc = (node as { loc?: { start?: { line?: number } } }).loc;
  return {
    name,
    node,
    commentTexts: texts,
    commentLines: lines,
    commentStartLines: startLines,
    startLine: loc?.start?.line ?? 0,
    depth,
    owner,
  };
}

function isFnExpr(n: Node | null | undefined): boolean {
  return (
    !!n &&
    (n.type === "ArrowFunctionExpression" ||
      n.type === "FunctionExpression" ||
      n.type === "FunctionDeclaration")
  );
}

function keyNameOf(key: Node | null | undefined): string | undefined {
  if (!key) return undefined;
  const k = key as { type?: string; name?: string; value?: string | number };
  if (k.type === "Identifier") return k.name;
  if (k.type === "StringLiteral" || k.type === "NumericLiteral") return String(k.value);
  return undefined;
}

/**
 * 注释宿主合并：函数节点**自身**的前导注释 + 语句宿主的前导注释。
 *
 * Bug 419：箭头函数初始化器上的**内联** JSDoc（写在 `=` 与 `() =>` 之间）
 * 挂在**函数节点**上，而语句级 JSDoc 挂在**声明语句**上 ⇒ 两者都要可见，
 * 且必须落在**同一个** scope（绑定名 `f`）上。
 */
function mergedLeadingComments(
  fnNode: Node,
  host: Node | undefined,
): readonly Comment[] | undefined {
  const own = (fnNode as { leadingComments?: readonly Comment[] }).leadingComments;
  if (!host || host === fnNode) return own;
  const hostComments = (host as { leadingComments?: readonly Comment[] }).leadingComments;
  if (!hostComments) return own;
  if (!own) return hostComments;
  return [...own, ...hostComments];
}

/**
 * CJS 导出槽名（绑定名）：
 *
 * - `exports.f = fn` → `f`
 * - `module.exports.f = fn` → `f`
 * - `module.exports = fn` → `default`
 *
 * 非 CJS 形态 ⇒ undefined。
 *
 * Bug 428：CJS 赋值形态**没有 AST 绑定名**可取（`exports.f` 的 `f` 不是绑定）
 * ⇒ 函数级指令落不到导出名上 ⇒ L1 契约静默失效 / `@nudo:throws` 不生效 /
 * `@nudo:case` 整条蒸发。⇒ 必须给这种形态一个绑定名（= 导出槽名）。
 */
function cjsExportSlotName(left: Node | null | undefined): string | undefined {
  const l = left as {
    type?: string;
    computed?: boolean;
    object?: Node | null;
    property?: Node | null;
  } | null | undefined;
  if (!l || l.type !== "MemberExpression" || l.computed === true) return undefined;
  const prop = keyNameOf(l.property);
  const obj = l.object as {
    type?: string;
    name?: string;
    object?: Node | null;
    property?: Node | null;
  } | null | undefined;
  // exports.f = fn
  if (obj?.type === "Identifier" && obj.name === "exports") return prop;
  // module.exports.f = fn
  if (
    obj?.type === "MemberExpression" &&
    obj.object?.type === "Identifier" &&
    (obj.object as { name?: string }).name === "module" &&
    obj.property?.type === "Identifier" &&
    (obj.property as { name?: string }).name === "exports"
  ) {
    return prop;
  }
  // module.exports = fn ⇒ 槽名 default（与 generalize 的 env.fns 登记口径一致）
  if (obj?.type === "Identifier" && obj.name === "module" && prop === "exports") {
    return "default";
  }
  return undefined;
}

/**
 * 类体里的**实例**方法键集合（ctor / get / set 不算）。
 *
 * Bug 425：static 与实例同名时，指令 scope 名必须区分 ⇒ 需要先知道
 * 「这个类里有没有同名实例方法」。
 */
function classInstanceKeys(body: readonly unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const m of body) {
    const mem = m as {
      type?: string;
      kind?: string;
      key?: Node | null;
      static?: boolean;
    };
    if (mem.type !== "ClassMethod" && mem.type !== "ClassPrivateMethod") continue;
    if (mem.kind && mem.kind !== "method") continue; // ctor / get / set
    if (mem.static === true) continue;
    const k = keyNameOf(mem.key);
    if (k) keys.add(k);
  }
  return keys;
}

type WalkCtx = {
  /** 宿主名（类名 / 外层函数名）；顶层 undefined */
  owner?: string;
  /** 词法嵌套深度（进入函数体的次数）：顶层函数 / 类成员 = 0 */
  depth?: number;
  /** 匿名函数表达式的**绑定名**（变量名 / 导出槽名）——Bug 419 / 428 */
  fallbackName?: string;
  /** 语句级注释宿主（内联 JSDoc / CJS 赋值形态） */
  commentHost?: Node;
  /** export 包装节点 */
  wrapperNode?: Node;
  /** 所在语句（ExpressionStatement）——CJS 赋值形态取语句级注释用 */
  stmtNode?: Node;
  /** 宿主类的**实例**方法键集合（static / 实例同名消歧——Bug 425） */
  instanceKeys?: ReadonlySet<string>;
};

/**
 * 全量 Function 站点：nested function、class method、object method 均可见。
 * 函数级指令绑「其前导注释块」；注释若带在非函数语句上则不绑（不留孤儿指令）。
 */
export function listFnDirectiveScopes(file: File): FnDirectiveScope[] {
  const out: FnDirectiveScope[] = [];

  const pushNamedFn = (
    name: string,
    fnNode: Node,
    commentNode: Node | undefined,
    wrapper: Node | undefined,
    depth = 0,
    owner?: string,
  ): void => {
    out.push(
      buildScope(
        name,
        fnNode,
        wrapper,
        // 注释宿主 = 函数节点自身 + 语句宿主（内联 JSDoc / CJS 赋值形态）
        mergedLeadingComments(fnNode, commentNode),
        (wrapper as { leadingComments?: readonly Comment[] } | undefined)?.leadingComments,
        depth,
        owner,
      ),
    );
  };

  const visit = (node: Node | null | undefined, ctx: WalkCtx): void => {
    if (!node || typeof node !== "object") return;
    const n = node as unknown as {
      type: string;
      leadingComments?: readonly Comment[];
      body?: unknown;
      program?: unknown;
      declaration?: Node | null;
      declarations?: unknown[];
      id?: { name?: string; type?: string } | null;
      key?: Node | null;
      params?: unknown[];
      init?: Node | null;
      value?: Node | null;
      argument?: Node | null;
      callee?: Node | null;
      properties?: unknown[];
      elements?: unknown[];
      expression?: Node | null;
      statements?: unknown[];
      cases?: unknown[];
      consequent?: unknown[];
      block?: Node | null;
      finalizer?: Node | null;
      object?: Node | null;
      property?: Node | null;
      left?: Node | null;
      right?: Node | null;
      superClass?: Node | null;
      typeParameters?: unknown;
      returnType?: unknown;
      static?: boolean;
      computed?: boolean;
      generator?: boolean;
      async?: boolean;
      kind?: string;
    };

    switch (n.type) {
      case "File":
        visit(n.program as Node, ctx);
        return;
      case "Program": {
        for (const s of (n.body as unknown[]) ?? []) visit(s as Node, ctx);
        return;
      }
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration": {
        const decl = n.declaration;
        if (!decl) return;
        // export 包装与内部声明的 leadingComments 都可能是指令注释
        const wrapCtx = { ...ctx, wrapperNode: node } as WalkCtx & { wrapperNode?: Node };
        // 具名函数/类/变量：注释合并 wrapper + decl
        visitWithWrapper(decl, node, wrapCtx);
        return;
      }
      case "FunctionDeclaration": {
        // 绑定名优先（fallbackName）：具名函数表达式的内层 id 不是绑定名
        const name = ctx.fallbackName ?? n.id?.name ?? "<anonymous>";
        pushNamedFn(name, node, node as Node, ctx.wrapperNode, ctx.depth ?? 0, ctx.owner);
        visit(n.body as Node, { owner: name, depth: (ctx.depth ?? 0) + 1 });
        return;
      }
      case "FunctionExpression": {
        // 绑定名优先（fallbackName）：变量名 / 导出槽名（Bug 419 / 428）
        const name = ctx.fallbackName ?? n.id?.name ?? "<anonymous>";
        pushNamedFn(
          name,
          node,
          ctx.commentHost ?? (node as Node),
          ctx.wrapperNode,
          ctx.depth ?? 0,
          ctx.owner,
        );
        visit(n.body as Node, { owner: name, depth: (ctx.depth ?? 0) + 1 });
        return;
      }
      case "ArrowFunctionExpression": {
        const name = ctx.fallbackName ?? "<anonymous>";
        pushNamedFn(
          name,
          node,
          ctx.commentHost ?? (node as Node),
          ctx.wrapperNode,
          ctx.depth ?? 0,
          ctx.owner,
        );
        visit(n.body as Node, { owner: name, depth: (ctx.depth ?? 0) + 1 });
        return;
      }
      case "VariableDeclaration": {
        const decls = (n.declarations as unknown[]) ?? [];
        for (let i = 0; i < decls.length; i++) {
          const decl = decls[i] as { id?: { type?: string; name?: string }; init?: Node | null };
          const idName = decl.id?.type === "Identifier" ? decl.id.name : undefined;
          if (isFnExpr(decl.init)) {
            // Bug 418：语句级 JSDoc 只绑**首个** declarator（TS 口径）⇒ 同一条
            // 见证不会被重放到后续 declarator 上。
            // Bug 419：初始化器上的**内联** JSDoc 绑到**绑定名**上（不再落
            // `<anonymous>`）⇒ 委托给函数分支建**唯一** scope（名字 = 变量名）。
            visit(decl.init, {
              owner: ctx.owner,
              fallbackName: idName ?? "<anonymous>",
              commentHost: i === 0 ? node : undefined,
              wrapperNode: ctx.wrapperNode,
              depth: ctx.depth ?? 0,
            });
          } else {
            // 非函数初始化：仍要递归进对象字面量里的 method / 嵌套函数
            visit(decl.init, {
              owner: idName,
              commentHost: node,
              wrapperNode: ctx.wrapperNode,
              depth: ctx.depth ?? 0,
            });
            // 对象方法注释带在 ObjectMethod 上，不在此处
          }
        }
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        const cname = n.id?.name ?? ctx.fallbackName ?? "<anonymous>";
        if (n.type === "ClassDeclaration") {
          // class 自身不是函数站点，但要递归 body
        }
        const body = (n.body as { body?: unknown[] })?.body ?? [];
        // Bug 425：static 与实例**同名** ⇒ scope 名必须区分。族 11 的普查口径
        // （`scan-top-functions.ts` 的 `collectClassMethods`）是「同名时只登记
        // **实例**方法」⇒ 指令侧同口径：实例方法保名 `C.m`，静态方法改名
        // `C.static.m`（类里没有同名实例方法时静态方法仍是 `C.m`——与普查面同名）。
        const instanceKeys = classInstanceKeys(body);
        for (const m of body) {
          visit(m as Node, { owner: cname, depth: ctx.depth ?? 0, instanceKeys });
        }
        return;
      }
      case "ClassMethod":
      case "ClassPrivateMethod":
      case "ObjectMethod": {
        const key = keyNameOf(n.key);
        const owner = ctx.owner;
        // Bug 425：static 与实例同名 ⇒ 静态方法改名（`C.static.m`），实例方法
        // 保名（`C.m`）⇒ 两条 `@nudo:contract` 不再互相顶替。
        const isStatic = n.type !== "ObjectMethod" && n.static === true;
        const collides = isStatic && key !== undefined && (ctx.instanceKeys?.has(key) ?? false);
        const name = key
          ? owner
            ? collides
              ? `${owner}.static.${key}`
              : `${owner}.${key}`
            : key
          : "<anonymous>";
        pushNamedFn(name, node, node as Node, undefined, ctx.depth ?? 0, owner);
        visit(n.body as Node, { owner: name, depth: (ctx.depth ?? 0) + 1 });
        return;
      }
      case "ObjectProperty":
      case "ClassProperty":
      case "ClassPrivateProperty": {
        const key = keyNameOf(n.key);
        const val = (n.value ?? n.init) as Node | null | undefined;
        if (isFnExpr(val)) {
          const owner = ctx.owner;
          const name = key ? (owner ? `${owner}.${key}` : key) : "<anonymous>";
          out.push(
            buildScope(
              name,
              val!,
              undefined,
              (val as { leadingComments?: readonly Comment[] }).leadingComments ??
                (node as { leadingComments?: readonly Comment[] }).leadingComments,
              undefined,
              ctx.depth ?? 0,
              owner,
            ),
          );
          visit(val, { owner: name, depth: ctx.depth ?? 0 });
          return;
        }
        visit(val, ctx);
        return;
      }
      case "ReturnStatement":
      case "ThrowStatement":
      case "AwaitExpression":
      case "SpreadElement":
      case "RestElement":
        visit(n.argument as Node, ctx);
        return;
      case "UnaryExpression":
      case "UpdateExpression":
        visit(n.argument as Node, ctx);
        return;
      case "BinaryExpression":
      case "LogicalExpression":
        visit(n.left as Node, ctx);
        visit(n.right as Node, ctx);
        return;
      case "AssignmentExpression": {
        // Bug 428：CJS 赋值形态（`exports.f = fn` / `module.exports.f = fn`）
        // 没有 AST 绑定名可取 ⇒ 函数级指令落不到导出名上 ⇒ L1 契约静默失效 /
        // `@nudo:throws` 不生效 / `@nudo:case` 整条蒸发。
        // ⇒ 给这种形态一个绑定名（导出槽名），并把**语句级**注释挂上去。
        const slot = cjsExportSlotName(n.left as Node | null | undefined);
        if (slot !== undefined && isFnExpr(n.right)) {
          // 裸 `module.exports = fn` **没有槽名** ⇒ 回退内层 id（普查面同口径：
          // 槽名缺失才回退内层 id——内层 id 不是导出槽名，槽名优先）。
          const innerId = (n.right as { id?: { name?: string } | null })?.id?.name;
          visit(n.right, {
            owner: ctx.owner,
            fallbackName: slot === "default" ? (innerId ?? "default") : slot,
            commentHost: ctx.stmtNode,
            wrapperNode: ctx.wrapperNode,
            depth: ctx.depth ?? 0,
          });
          return;
        }
        visit(n.left as Node, ctx);
        visit(n.right as Node, ctx);
        return;
      }
      case "MemberExpression":
      case "OptionalMemberExpression":
        visit(n.object as Node, ctx);
        visit(n.property as Node, ctx);
        return;
      case "CallExpression":
      case "OptionalCallExpression":
      case "NewExpression": {
        visit(n.callee as Node, ctx);
        for (const a of (n as { arguments?: unknown[] }).arguments ?? []) visit(a as Node, ctx);
        return;
      }
      case "ConditionalExpression":
        visit((n as { test?: Node }).test, ctx);
        visit((n as { consequent?: Node }).consequent, ctx);
        visit((n as { alternate?: Node }).alternate, ctx);
        return;
      case "ArrayExpression": {
        for (const e of (n.elements as unknown[]) ?? []) visit(e as Node, ctx);
        return;
      }
      case "ObjectExpression": {
        for (const p of (n.properties as unknown[]) ?? []) visit(p as Node, ctx);
        return;
      }
      case "SequenceExpression": {
        for (const e of (n as { expressions?: unknown[] }).expressions ?? []) visit(e as Node, ctx);
        return;
      }
      case "ParenthesizedExpression":
        visit(n.expression as Node, ctx);
        return;
      case "ExpressionStatement":
        // 语句级注释宿主（CJS 赋值形态取用）——见 Bug 428
        visit(n.expression as Node, { ...ctx, stmtNode: node });
        return;
      case "BlockStatement": {
        for (const s of (n.body as unknown[]) ?? []) visit(s as Node, ctx);
        return;
      }
      case "IfStatement":
        visit((n as { test?: Node }).test, ctx);
        visit((n as { consequent?: Node }).consequent, ctx);
        visit((n as { alternate?: Node }).alternate, ctx);
        return;
      case "ForStatement":
        visit((n as { init?: Node }).init, ctx);
        visit((n as { test?: Node }).test, ctx);
        visit((n as { update?: Node }).update, ctx);
        visit((n as { body?: Node }).body, ctx);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        visit((n as { left?: Node }).left, ctx);
        visit((n as { right?: Node }).right, ctx);
        visit((n as { body?: Node }).body, ctx);
        return;
      case "WhileStatement":
      case "DoWhileStatement":
        visit((n as { test?: Node }).test, ctx);
        visit((n as { body?: Node }).body, ctx);
        return;
      case "TryStatement":
        visit((n as { block?: Node }).block, ctx);
        visit((n as { handler?: Node }).handler, ctx);
        visit((n as { finalizer?: Node }).finalizer, ctx);
        return;
      case "CatchClause":
        visit((n as { body?: Node }).body, ctx);
        return;
      case "SwitchStatement":
        visit((n as { discriminant?: Node }).discriminant, ctx);
        for (const c of (n.cases as unknown[]) ?? []) visit(c as Node, ctx);
        return;
      case "SwitchCase":
        visit((n as { test?: Node }).test, ctx);
        for (const s of (n as { consequent?: unknown[] }).consequent ?? []) visit(s as Node, ctx);
        return;
      case "LabeledStatement":
        visit((n as { body?: Node }).body, ctx);
        return;
      default: {
        // 兜底：递归常见子键，避免漏 nested function
        for (const key of [
          "body",
          "expression",
          "init",
          "value",
          "argument",
          "declaration",
          "left",
          "right",
          "test",
          "consequent",
          "alternate",
          "block",
          "handler",
          "finalizer",
          "callee",
          "object",
          "property",
          "argument",
        ] as const) {
          const v = (n as Record<string, unknown>)[key];
          if (Array.isArray(v)) v.forEach((x) => visit(x as Node, ctx));
          else if (v && typeof v === "object" && "type" in (v as object)) visit(v as Node, ctx);
        }
        for (const key of ["declarations", "properties", "elements", "arguments", "cases", "params"] as const) {
          const v = (n as Record<string, unknown>)[key];
          if (Array.isArray(v)) v.forEach((x) => visit(x as Node, ctx));
        }
        return;
      }
    }
  };

  /**
   * export 包装：把 wrapper 的 leadingComments 合并进内部声明的 scope。
   * 内部是函数/变量/类时走正常 visit，但 commentHost / wrapperNode 注入。
   */
  const visitWithWrapper = (decl: Node, wrapper: Node, ctx: WalkCtx): void => {
    const d = decl as {
      type: string;
      leadingComments?: readonly Comment[];
      id?: { name?: string } | null;
      body?: unknown;
      declarations?: unknown[];
      key?: Node | null;
    };
    if (d.type === "FunctionDeclaration" || d.type === "FunctionExpression") {
      const name = d.id?.name ?? "default";
      pushNamedFn(name, decl, decl, wrapper, ctx.depth ?? 0, ctx.owner);
      visit(d.body as Node, { owner: name, depth: (ctx.depth ?? 0) + 1 });
      return;
    }
    if (d.type === "ClassDeclaration" || d.type === "ClassExpression") {
      const cname = d.id?.name ?? "<anonymous>";
      const body = (d.body as { body?: unknown[] })?.body ?? [];
      // Bug 425：同 `visit` 的 ClassDeclaration 分支（static / 实例同名消歧）
      const instanceKeys = classInstanceKeys(body);
      for (const m of body) {
        visit(m as Node, { owner: cname, depth: ctx.depth ?? 0, instanceKeys });
      }
      return;
    }
    if (d.type === "VariableDeclaration") {
      const decls = (d.declarations as unknown[]) ?? [];
      for (let i = 0; i < decls.length; i++) {
        const vd = decls[i] as { id?: { type?: string; name?: string }; init?: Node | null };
        const idName = vd.id?.type === "Identifier" ? vd.id.name : undefined;
        if (isFnExpr(vd.init)) {
          // Bug 418：语句级 JSDoc 只绑**首个** declarator（TS 口径）。
          // Bug 419：内联 JSDoc 绑到**绑定名**上（`export const f = …`）。
          visit(vd.init, {
            owner: ctx.owner,
            fallbackName: idName ?? "default",
            commentHost: i === 0 ? decl : undefined,
            wrapperNode: wrapper,
            depth: ctx.depth ?? 0,
          });
        } else {
          visit(vd.init, {
            owner: idName,
            commentHost: decl,
            wrapperNode: wrapper,
            depth: ctx.depth ?? 0,
          });
        }
      }
      return;
    }
    // export default 箭头/函数表达式
    if (d.type === "ArrowFunctionExpression" || d.type === "FunctionExpression") {
      const name = "default";
      out.push(
        buildScope(
          name,
          decl,
          wrapper,
          d.leadingComments,
          (wrapper as { leadingComments?: readonly Comment[] }).leadingComments,
          ctx.depth ?? 0,
          ctx.owner,
        ),
      );
      visit(d.body as Node, { owner: name, depth: (ctx.depth ?? 0) + 1 });
      return;
    }
    visit(decl, { ...ctx, wrapperNode: wrapper } as WalkCtx);
  };

  for (const stmt of file.program.body) {
    visit(stmt as Node, {});
  }
  return out;
}

/**
 * 按绑定名找函数 scope。
 *
 * Bug 424：scope 名**不保证唯一**（同名遮蔽函数 / 嵌套同名函数）⇒ 此前
 * 「文档序**首个**命中」让**内层**同名函数抢走导出函数的注释块 ⇒
 * 导出函数继承内层的 `@nudo:throws` ⇒ **L2 门禁假绿 / 假红**。
 *
 * ⇒ 同名时取**词法最浅**的那个（`depth` 最小：顶层函数 / 类成员 = 0，
 * 每进入一层函数体 +1）；同深度取文档序第一个。
 * 口径与**分析面**一致：顶层函数先登记（`generalize.ts` 的 env.fns），
 * 嵌套同名者被跳过 ⇒ 分析面问到的「同名函数」就是最浅的那个。
 */
export function findFnDirectiveScope(
  file: File,
  fnName: string,
): FnDirectiveScope | undefined {
  let best: FnDirectiveScope | undefined;
  for (const s of listFnDirectiveScopes(file)) {
    if (s.name !== fnName) continue;
    if (!best || (s.depth ?? 0) < (best.depth ?? 0)) best = s;
  }
  return best;
}

/**
 * 源文本级函数前导指令行（refine / throws / budget 的消费口）。
 * 与 case 扫描共用同一 scope 绑定，保证 case+contract 同时可见。
 */
export function fnDirectiveCommentLines(source: string, fnName: string): string[] {
  let file: File;
  try {
    file = parseSource(source);
  } catch {
    return [];
  }
  return findFnDirectiveScope(file, fnName)?.commentLines ?? [];
}

// ---------------------------------------------------------------------------
// 载荷文法（单源）：env / mock-module / import
// ---------------------------------------------------------------------------

const isPathLikeEnv = (s: string): boolean =>
  /^[^\s]+$/.test(s) &&
  (s.startsWith("./") ||
    s.startsWith("../") ||
    s.startsWith("/") ||
    /\.(ts|js|mjs|cjs|tsx|jsx)$/.test(s));

/**
 * `@nudo:env` 载荷 → 命名 env token。只收 `\w+` 或 path-like
 * （拒绝 `node";` 这类截断捕获）。
 *
 * Bug 417：此前**只按 `,` 切分** ⇒ 空格分隔列表（`node web`）被切成**一个**
 * token 后整条滤掉 ⇒ 零诊断地丢掉整条列表（env 未解析 ⇒ 全局 `unknown`）。
 * ⇒ 逗号**与**空白两种分隔符都认；尾随的注释先剥掉（行尾注释是最自然的
 * 写法：`/// @nudo:env node // 只需要 node`）。
 */
export function parseEnvPayload(payload: string): string[] {
  const out: string[] = [];
  for (const segment of payload.split(",")) {
    // 剥尾随注释：行尾 `// …` 与块注释 `/* … */`
    const withoutComments = segment
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const token of withoutComments.split(/\s+/)) {
      const name = token.trim().replace(/^['"]|['"]$/g, "");
      if (name && (/^\w+$/.test(name) || isPathLikeEnv(name))) out.push(name);
    }
  }
  return out;
}

export type MockModuleRecord = {
  source: string;
  names?: string[];
  fromPath: string;
};

/**
 * `@nudo:mock-module "src" [ { a, b } ] from "path"` 载荷解析。
 * 名表 `{ … }` 可选；单源文法（parser / load-deps 共用）。
 *
 * Bug 415：两条正则原**硬编码双引号** ⇒ 单引号载荷（`'axios' from './m.js'`）
 * 两条都不匹配 ⇒ 返回 `undefined` ⇒ 上游既不落诊断也不落记录 ⇒ 指令
 * **静默蒸发**（mock 不生效、门禁照常绿）。⇒ 单引号与双引号**都认**
 * （同一对引号必须自洽；source 与 path 的引号种类可不同）。
 */
export function parseMockModulePayload(payload: string): MockModuleRecord | undefined {
  const partial = payload.match(
    /^\s*(?:"([^"]+)"|'([^']+)')\s*\{([^}]+)\}\s*from\s*(?:"([^"]+)"|'([^']+)')\s*$/,
  );
  if (partial) {
    const names = partial[3]!.split(",").map((n) => n.trim()).filter(Boolean);
    return { source: partial[1] ?? partial[2]!, names, fromPath: partial[4] ?? partial[5]! };
  }
  const full = payload.match(
    /^\s*(?:"([^"]+)"|'([^']+)')\s+from\s*(?:"([^"]+)"|'([^']+)')\s*$/,
  );
  if (full) {
    return { source: full[1] ?? full[2]!, fromPath: full[3] ?? full[4]! };
  }
  return undefined;
}

export type NudoImportRecord = {
  /** 本地绑定名（`a as b` 的 `b`，@nudo:contract 的引用名）；namespace 记 `*ns` */
  names: string[];
  /** local → 侧车原始导出名（`a as b` 的 `a`）；未写别名的名字不进表 */
  importedOfLocal: Record<string, string>;
  spec: string;
};

/**
 * `@nudo:import` 载荷里的标识符文法（Unicode 合法，如 `命名空间` / `$x`）。
 * Bug 350：旧口径 `\w+` 只收 ASCII ⇒ Unicode 绑定名被判 malformed。
 */
const IMPORT_IDENT = "[\\p{ID_Start}$_][\\p{ID_Continue}$]*";

/**
 * `@nudo:import` 载荷：named `{ a, b as c }` / namespace `* as ns`。
 * default 等未识别形态返回 `malformed`（由消费方发诊断）。
 * import 绑定语义 local ← imported：`a as b` 两个名字都保留——只留 local
 * 会让查表用错名字（`exports[b]` miss，BUG-016）。
 *
 * Bug 422：**空载荷**（「标签命中但没写载荷」）此前返回 `undefined`
 * （=「没有这条指令」）⇒ 畸形扫描器**永远看不到它** ⇒ 零诊断。
 * ⇒ 空载荷是「这条指令写坏了」⇒ 返回 `malformed`，让既有的
 * `nudo:contract-syntax` 通道自然接管。
 */
export function parseNudoImportPayload(
  payload: string,
): NudoImportRecord | "malformed-default" | "malformed" | undefined {
  const s = payload.trim();
  if (s === "") return "malformed";
  const named = s.match(/^\{([^}]+)\}\s*from\s*["']([^"']+)["']$/);
  if (named) {
    const names: string[] = [];
    const importedOfLocal: Record<string, string> = {};
    for (const x of named[1]!
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/\/?\s?/, "").trim())
      .join("\n")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      const seg = x.split(/\s+as\s+/);
      const local = seg[seg.length - 1]!.trim();
      names.push(local);
      if (seg.length > 1) importedOfLocal[local] = seg[0]!.trim();
    }
    return { names, importedOfLocal, spec: named[2]! };
  }
  const ns = new RegExp(
    `^\\*\\s+as\\s+(${IMPORT_IDENT})\\s+from\\s*["']([^"']+)["']$`,
    "u",
  ).exec(s);
  if (ns) {
    return { names: [`*${ns[1]}`], importedOfLocal: {}, spec: ns[2]! };
  }
  if (
    new RegExp(`^${IMPORT_IDENT}\\s+from\\b`, "u").test(s) ||
    new RegExp(`^${IMPORT_IDENT}\\s*,`, "u").test(s)
  ) {
    return "malformed-default";
  }
  return "malformed";
}

// ---------------------------------------------------------------------------
// 文本级文件级抽取（nudojs / load-deps 消费口；与 parser AST 路径同文法）
// ---------------------------------------------------------------------------

/** 行注释前缀：`//` 或 `///`；排除 `////` 与 `http://` 伪起点 */
const LINE_COMMENT_PREFIX = "(?:^|[^/:])\\/\\/\\/?";

function fileDirectiveVisibleText(source: string): string {
  // 剥字符串 + 块注释：只留 `//` / `///` 行注释可见
  // 等长掩码（字符串→空格、块注释→空格）：下标与原文一一对应 ⇒ 位置闸门可比
  return maskStringsKeepComments(source).replace(/\/\*[\s\S]*?\*\//g, (m) =>
    " ".repeat(m.length),
  );
}

/**
 * 函数体区间（顶层判定用）：文件级指令（`@nudo:env` / `@nudo:mock-module` /
 * `@nudo:import`）**不得**落在任何函数体内——函数体里的 `/// @nudo:env node`
 * 不是「本函数用 node env」，此前文本路径**只看文本不看位置** ⇒ 对**整份文件**
 * 生效（Bug 847）。
 *
 * 与 parser 的 AST 路径（`file-directives.ts` 的 `functionBodyRanges`）同口径：
 * 两条路径都用「不在函数体内」判定，顶层位置（文件头 / `export` 行 / 语句之间）
 * 一律放行。
 *
 * 解析失败（源码语法错误）⇒ 无区间 ⇒ 退化为旧行为（不闸门），不抛。
 */
function functionBodyRanges(source: string): [number, number][] {
  try {
    return listFnDirectiveScopes(parseSource(source)).map((scope) => [
      scope.node.start ?? 0,
      scope.node.end ?? 0,
    ]);
  } catch {
    return [];
  }
}

/** 偏移是否落在某个函数体内 */
function inFunctionBody(ranges: [number, number][], offset: number): boolean {
  return ranges.some(([s, e]) => offset >= s && offset < e);
}

export function extractFileEnvNames(source: string): string[] {
  const text = fileDirectiveVisibleText(source);
  // S4-004 同族：标签/载荷同行分隔——`\s*`/`\s+` 跨行会把非注释行的
  // `@nudo:env` 或下一行载荷粘进上一条行注释
  const re = new RegExp(`${LINE_COMMENT_PREFIX}[ \\t]*@nudo:env[ \\t]+([^\\n*]+)`, "g");
  // Bug 847：位置闸门——函数体里的文件级 env 不再对整份文件生效
  const fnRanges = functionBodyRanges(source);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const commentStart = m.index + m[0].indexOf("//");
    if (inFunctionBody(fnRanges, commentStart)) continue;
    out.push(...parseEnvPayload(m[1]!));
  }
  return out;
}

export function extractMockModuleRecords(source: string): MockModuleRecord[] {
  const text = fileDirectiveVisibleText(source);
  const re = new RegExp(
    `${LINE_COMMENT_PREFIX}[ \\t]*@nudo:mock-module[ \\t]+([^\\n]+)`,
    "g",
  );
  // Bug 847：位置闸门——函数体里的文件级 mock-module 不再对整份文件生效
  const fnRanges = functionBodyRanges(source);
  const out: MockModuleRecord[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const commentStart = m.index + m[0].indexOf("//");
    if (inFunctionBody(fnRanges, commentStart)) continue;
    const rec = parseMockModulePayload(m[1]!);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * 指令只认**注释行首**（`//` / `///` / 块注释 `*` 续行清洗后以 `@nudo:` 开头）。
 * 句中散文提及（「无 @nudo:import 同名约束时…」）不是指令。
 * 字符串正文里的同形文本不是指令（scanSource 已遮罩）。
 * 返回清洗后的注释行（文档序）+ **是否在函数体外**（位置闸门用，Bug 847）
 * + **注释种类**（行注释 / 块注释；Bug 416）。
 *
 * Bug 416：此前行注释与块注释被**拍平成同一个列表**且 `kind` 被丢弃 ⇒
 * 块注释里的 `@nudo:import` **真的生效**（与 `@nudo:env` /
 * `@nudo:mock-module` 在块注释里被忽略并告警的 AST 口径**相反**）。
 * ⇒ 保留 `kind`，由消费方分档（行注释生效 / 块注释忽略并告警）。
 */
function directiveCommentLinesRaw(
  source: string,
): Array<{ text: string; inHeader: boolean; kind: "line" | "block" }> {
  // 等长掩码（字符串→空格、注释原文保留）：下标与原文一一对应 ⇒ 位置闸门可比
  const src = maskStringsKeepComments(source);
  const out: Array<{ text: string; inHeader: boolean; kind: "line" | "block" }> = [];
  // Bug 847：位置闸门——函数体里的文件级指令不再对整份文件生效
  const fnRanges = functionBodyRanges(source);
  // 行注释（// 或 ///；排除 ////——Babel 值以 // 开头时 cleanDirectiveLine 不剥）
  const lineRe = /(?:^|[^/:])\/\/\/?([^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(src))) {
    const commentStart = m.index + m[0].indexOf("//");
    out.push({
      text: cleanDirectiveLine(m[1]!, "line"),
      inHeader: !inFunctionBody(fnRanges, commentStart),
      kind: "line",
    });
  }
  // 块注释（含 JSDoc）
  const blockRe = /\/\*([\s\S]*?)\*\//g;
  while ((m = blockRe.exec(src))) {
    for (const line of commentTextToLines(m[1]!, "block")) {
      out.push({ text: line, inHeader: true, kind: "block" });
    }
  }
  return out;
}

/**
 * `@nudo:import` 载荷行（行首锚定 + 多行 `{ … }` 续行拼接）。
 * 散文句中提及不产出；续行只拼「未闭合 `{` 之后的同批注释行」。
 *
 * Bug 416：只认**行注释**形态（与 parser AST 通道同口径：块注释形态被
 * 忽略并告警）。
 * Bug 422：标签命中但**载荷为空**也必须产出一条载荷（空串）⇒ 畸形扫描器
 * 看得到它 ⇒ 发 `nudo:contract-syntax`（不再静默丢弃）。
 */
function nudoImportPayloads(source: string): string[] {
  const lines = directiveCommentLinesRaw(source);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i]!;
    const line = entry.text;
    // Bug 847：位置闸门——行注释形态的 `@nudo:import` 不得落在**函数体内**；
    // 函数体里的 import 不再对整份文件生效。
    if (!entry.inHeader) continue;
    // Bug 416：块注释形态的文件级指令不生效（AST 通道口径）
    if (entry.kind !== "line") continue;
    // `\b` 防 `@nudo:imports`；标签后**无空白**也算命中（Bug 422：空载荷
    // 必须可见）⇒ 载荷取标签后的剩余文本（可能为空串）。
    if (!/^@nudo:import\b/.test(line)) continue;
    let payload = line.replace(/^@nudo:import[ \t]*/, "").trim();
    // 多行 named：`{` 未闭合时拼后续注释行（直到 `}` / from "path"）
    if (payload.startsWith("{")) {
      let depth = 0;
      for (const ch of payload) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      while (depth > 0 && i + 1 < lines.length) {
        i += 1;
        // 续行也必须来自行注释（块注释形态的文件级指令不生效）
        if (lines[i]!.kind !== "line") {
          i -= 1;
          break;
        }
        const cont = lines[i]!.text;
        if (/^@nudo:/.test(cont)) {
          i -= 1;
          break;
        }
        payload += `\n${cont}`;
        for (const ch of cont) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
      }
    }
    out.push(payload);
  }
  return out;
}

/** `@nudo:import` 命名/namespace 记录（refine 与 load-deps 共用单源） */
export function extractNudoImportRecords(source: string): NudoImportRecord[] {
  const out: NudoImportRecord[] = [];
  for (const payload of nudoImportPayloads(source)) {
    const rec = parseNudoImportPayload(payload);
    if (rec && rec !== "malformed" && rec !== "malformed-default") out.push(rec);
  }
  return out;
}

/** 未识别的 `@nudo:import` 形态（default 等）——供消费方发诊断 */
export function scanMalformedNudoImports(
  source: string,
): Array<"malformed-default" | "malformed"> {
  const out: Array<"malformed-default" | "malformed"> = [];
  for (const payload of nudoImportPayloads(source)) {
    const rec = parseNudoImportPayload(payload);
    if (rec === "malformed-default" || rec === "malformed") out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 函数级标签行扫描（case / contract / throws / budget）
// ---------------------------------------------------------------------------

/**
 * 平衡括号摘取（字符串感知；`\` 不是转义——与 case 实参原样 slice 一致）。
 * 返回括号内文本；无平衡括号 → null。
 *
 * ⚠ Bug 420：**配平扫描**优先按 JS 转义语义走——串里的 `\"` / `\'` 不再提前
 * 结束字符串 ⇒ 括号配平正确 ⇒ 含转义引号的 case 不再被**整条丢弃**，诊断也不再
 * 错误归因为「unclosed argument list」。
 * ⚠ 串**未闭合**（如 `"a\", -1`——非法 JS 串）时**回退**宽松口径（`\` 不是
 * 转义）——Bug 1009 钉住的实参切分口径必须保持不变（两个面看到同一个世界）。
 */
export function extractBalancedParens(text: string, startIdx: number): string | null {
  // 优先：转义感知（JS 语义）
  const escaped = extractBalancedParensScan(text, startIdx, true);
  if (escaped !== null) return escaped;
  // 回退：宽松口径（`\` 不是转义）——串未闭合时仍能找到右括号
  return extractBalancedParensScan(text, startIdx, false);
}

/** 配平扫描（`escapeAware` = 串内 `\` 是否当转义）。 */
function extractBalancedParensScan(
  text: string,
  startIdx: number,
  escapeAware: boolean,
): string | null {
  if (text[startIdx] !== "(") return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      // Bug 420：转义感知口径下，串内 `\` 是转义 ⇒ 下一个字符（哪怕是引号）
      // 不结束字符串
      if (escapeAware && ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0) return text.slice(startIdx + 1, i);
  }
  return null;
}

export type CaseTag = {
  name: string;
  /** 括号内实参原文（未清洗续行 `*`） */
  argsText: string;
  /** `=> expected` 表达式原文（同行/续行 `=>`；已剥 `!! throws` 后缀与冗余括号） */
  expectedText?: string;
  /** 期望**写了却抽不出**的原因（消费方发 nudo:directive-syntax；Bug 918） */
  expectedIssue?: string;
  /** 标签在 comment.value 中的下标 */
  tagOffset: number;
};

// S4-004：标签与载荷只允许同行分隔（`[ \t]`，不跨行）。`\s+` 会把下一行内容
// 粘进上一标签（空 `@nudo:case` 吞下一行的 `"evil" (1)` 成合法 case）。
// 多行实参由 extractBalancedParens 单独处理，不需要正则跨行。
// 名字 `"([^"\n]+)"` 禁跨行：未闭合名引号曾把下一行粘进名字（错误归因）。
// 前缀镜像 cleanDirectiveLine：块 `*` 续行 / 行注释 `///` 残留的**单个** `/`
// （旧 `\/\/\/?` 要两个斜杠——只匹配 `////` 残留，既漏 `///` 又违反
// 「//// 不是指令前缀」契约）。
const CASE_NAME_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:case[ \t]+"([^"\n]+)"[ \t]*\(/g;
// ⚠ Bug 978：宽松标签正则**捕获分隔空白**（m[1]）——粘连写法（`@nudo:case"c1"`）
// 在抽取侧（`CASE_NAME_REGEX` 要求 `[ \t]+`）**不匹配** ⇒ 整条 case 会**静默
// 蒸发** ⇒ 诊断面必须**看得见**它（口径与族 28 的 Bug 980 一致）。
// `\b` 防 `@nudo:cases`；载荷 `[^\n]*` 让空标签（行尾无载荷）也可被
// 消费方诊断，不再静默漏过。
// m[2] = 标签后的载荷文本（与旧 m[1] 同内容）。
const CASE_TAG_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:case\b([ \t]*)([^\n]*)/g;

/** case 行上的 `!! throws [Kind]` 后缀（文档化形态）——行首 / 行尾两处都要认。 */
const CASE_THROWS_SUFFIX_LEAD_RE = /^\s*!!\s*throws(?:\s+[A-Za-z*][\w*|,\s]*)?/i;
const CASE_THROWS_SUFFIX_TAIL_RE = /!!\s*throws(?:\s+[A-Za-z*][\w*|,\s]*)?\s*$/i;

/**
 * 剥掉 case 行上的 `!! throws [Kind]` 后缀（**只在这里剥**）。
 *
 * ⚠ 硬规则（族 10 片 3 / Bug 426）：只在**期望表达式文本的局部副本**上剥，
 * **绝不改写 case 行 / 注释原文** ⇒ 函数级 `!! throws` 申报（`scanThrowsDecl`
 * 读的是原文行）仍然看得到后缀 ⇒ 两条语义互不干扰。
 */
function stripCaseThrowsSuffix(line: string): string {
  return line.replace(CASE_THROWS_SUFFIX_LEAD_RE, "");
}

/** 剥掉**行尾**的 `!! throws [Kind]` 后缀（期望表达式文本用）。 */
function stripTrailingCaseThrowsSuffix(text: string): string {
  return text.replace(CASE_THROWS_SUFFIX_TAIL_RE, "").trim();
}

/**
 * 剥掉期望表达式**外层**的冗余括号（`(999)` / `("a")` / `([1])` / `({ b: 1 })`）——
 * 与实参侧（`extractBalancedParens` 剥外层括号）**同口径**。
 *
 * 只剥「整段被一对括号包住」的情形 ⇒ 箭头函数（`(x) => y`）不受影响。
 */
function stripRedundantParens(text: string): string {
  let cur = text.trim();
  while (cur.startsWith("(") && cur.endsWith(")")) {
    const inner = extractBalancedParens(cur, 0);
    if (inner === null) break;
    // 括号不包住整段（`inner` 短于「去掉首尾括号」的长度）⇒ 不是冗余层
    if (inner.length + 2 !== cur.length) break;
    cur = inner.trim();
  }
  return cur;
}

/** 注释续行前缀（块 ` * ` / 行注释 `///`）剥离（与 fn-directives 同口径）。 */
function stripCaseCommentPrefix(line: string, index: number): string {
  if (index <= 0) return line;
  return line.replace(/^\s*\*\s?/, "").replace(/^\s*\/\/\/?\s?/, "");
}

/** `=>` 之后**下一行**的期望值（Bug 918 形态 A：`=>` 后换行）。 */
function findCaseExpectedOnNextLine(lines: string[], from: number): string | undefined {
  for (let j = from; j < lines.length; j++) {
    const cont = stripCaseThrowsSuffix(stripCaseCommentPrefix(lines[j]!, j));
    if (/^\s*@nudo:/.test(cont)) return undefined;
    if (cont.trim() === "") continue;
    const arrow = cont.match(/^\s*=>\s*(.*)$/);
    if (!arrow) return cont.trim();
    const tail = arrow[1]!.trim();
    if (tail === "") continue;
    return tail;
  }
  return undefined;
}

/**
 * `)` 之后的 `=> expected` 表达式文本。允许 `=>` 出现在续行（剥块注释续行
 * ` * ` 前缀）；不吞下一个 `@nudo:` 标签。
 *
 * - Bug 423：CRLF 安全（切行按 `\r?\n`）——旧实现用 `.` 匹配行尾，`\r` 吃不掉
 *   ⇒ CRLF 源文件里期望被**整条吞掉**（判 unchecked ⇒ 断言不执法）。
 * - Bug 426：`!! throws [Kind]` 后缀（行首 / 行尾两处）从**期望文本**里剥掉
 *   ⇒ 期望不再被后缀顶掉（后缀在 `=>` 之前）或被腐蚀（后缀在 `=>` 之后）。
 * - Bug 427：期望文本剥**一层冗余括号**（与实参侧同口径）。
 * - Bug 918：`=>` 后为空时**往下找一行**（形态 A）；确实没有值时给出行首锚的
 *   语法错（形态 B）——不再静默判「无期望」。
 */
function extractCaseExpectedExpr(
  text: string,
  afterParen: number,
): { text?: string; issue?: string } {
  const lines = text.slice(afterParen).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripCaseThrowsSuffix(stripCaseCommentPrefix(lines[i]!, i));
    if (/^\s*@nudo:/.test(line)) break;
    if (line.trim() === "") continue;
    const arrow = line.match(/^\s*=>\s*(.*)$/);
    if (!arrow) break;
    const tail = stripTrailingCaseThrowsSuffix(arrow[1]!);
    if (tail !== "") return { text: stripRedundantParens(tail) };
    // `=>` 后本行为空 ⇒ 往下找一行（Bug 918 形态 A）
    const next = findCaseExpectedOnNextLine(lines, i + 1);
    if (next !== undefined) {
      const stripped = stripTrailingCaseThrowsSuffix(next);
      if (stripped === "") break;
      return { text: stripRedundantParens(stripped) };
    }
    // `=>` 之后什么都没有 ⇒ 语法错（Bug 918 形态 B）
    return { issue: "missing expected expression after '=>'" };
  }
  return {};
}

/**
 * `@nudo:case` 标签扫描（单源）：多行实参、实参区间遮罩、`=> expected`。
 * 供 parser（Abs 解释）与 check-case-scan（见证检查）共用。
 * 非法名形态由消费方用 `scanMalformedCaseTagRests` 诊断。
 */
export function scanCaseTags(text: string): CaseTag[] {
  const caseArgSpans: [number, number][] = [];
  const out: CaseTag[] = [];
  CASE_NAME_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CASE_NAME_REGEX.exec(text)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    const argsStr = extractBalancedParens(text, parenStart);
    if (argsStr === null) continue;
    const afterParen = parenStart + argsStr.length + 2;
    // 嵌套 case：标签落在已有实参区间内 → 数据，不产出指令
    if (caseArgSpans.some(([s, e]) => m!.index >= s && m!.index < e)) continue;
    caseArgSpans.push([m.index, afterParen]);
    const tagOffset = m.index + m[0].indexOf("@nudo:case");
    const expected = extractCaseExpectedExpr(text, afterParen);
    out.push({
      name: m[1]!,
      argsText: argsStr,
      expectedText: expected.text,
      expectedIssue: expected.issue,
      tagOffset,
    });
  }
  return out;
}

/** case 实参区间（供其它标签做遮罩） */
export function scanCaseArgSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  CASE_NAME_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CASE_NAME_REGEX.exec(text)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    const argsStr = extractBalancedParens(text, parenStart);
    if (argsStr === null) continue;
    const afterParen = parenStart + argsStr.length + 2;
    if (spans.some(([s, e]) => m!.index >= s && m!.index < e)) continue;
    spans.push([m.index, afterParen]);
  }
  // Bug 846：**畸形** case 标签（单引号名 / 空名 / 缺实参括号…）也有实参区间——
  // 此前只登记合法形态的区间 ⇒ 畸形 case 的实参里写的 `@nudo:mock` / `@nudo:skip`
  // **泄漏**成真指令（假红 / d.ts 丢方法）。
  // 只遮罩**实参区间**（不含标签本身）：标签本身仍要报「畸形 case 名」诊断。
  CASE_TAG_REGEX.lastIndex = 0;
  while ((m = CASE_TAG_REGEX.exec(text)) !== null) {
    if (spans.some(([s, e]) => m!.index >= s && m!.index < e)) continue;
    const rest = m[2]!;
    const rel = rest.indexOf("(");
    if (rel === -1) continue;
    const parenStart = m.index + m[0].length - rest.length + rel;
    const argsStr = extractBalancedParens(text, parenStart);
    if (argsStr === null) continue;
    const afterParen = parenStart + argsStr.length + 2;
    spans.push([parenStart, afterParen]);
  }
  return spans;
}

/** 非法 case 名形态的标签剩余文本（消费方发 nudo:directive-syntax） */
export function scanMalformedCaseTagRests(
  text: string,
  caseArgSpans: [number, number][] = scanCaseArgSpans(text),
): string[] {
  const out: string[] = [];
  const inCaseArgs = (idx: number): boolean =>
    caseArgSpans.some(([s, e]) => idx >= s && idx < e);
  CASE_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CASE_TAG_REGEX.exec(text)) !== null) {
    if (inCaseArgs(m.index)) continue;
    const separator = m[1]!;
    const rest = m[2]!.trim();
    // ⚠ Bug 978：标签与名字之间**无空白**（粘连写法 `@nudo:case"c1"`）——
    // 抽取侧（`CASE_NAME_REGEX` 要求 `[ \t]+`）**不匹配** ⇒ 整条 case 会被
    // **静默蒸发** ⇒ 诊断面必须**看得见**它（口径与族 28 的 Bug 980 一致）。
    if (separator === "" && rest.startsWith('"')) {
      out.push(rest);
      continue;
    }
    if (/^"[^"]+"\s*\(/.test(rest)) continue;
    out.push(rest);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 函数级标签行扫描（case / contract / assume / throws / budget）
// ---------------------------------------------------------------------------

/**
 * 标签形态（行首锚定 + 严格 / 宽松两档）。
 *
 * - ok：标签 + 分隔空白 + 非空载荷（**唯一可执行形态**）
 * - glued：标签后**没有**分隔空白就接了别的字符（标签名被延长）
 * - empty：标签单独成行（载荷为空）
 *
 * Bug 981 / 1032：`@nudo:contractx p n` / `@nudo:assumed d <= max` /
 * `@nudo:invariantdp >= 0` / `@nudo:throwsTypeError` 此前**整行不匹配**严格
 * 正则且**无 else 分支** ⇒ **零诊断**地蒸发（契约整条蒸发；公理蒸发 ⇒ 返回
 * 契约从「已证明」退回「未证明」，而唯一信号是**归因错误**的
 * nudo:unproven-return）。
 *
 * 口径（与族 28 的 Bug 980 同款）：**严格文法仍要求分隔空白**——`@nudo:mockfetch`
 * 不能被当成合法的 `@nudo:mock`；「宽松形态」只用于**诊断**。
 */
type DirectiveTagForm =
  | { kind: "ok"; payload: string }
  | { kind: "glued"; rest: string }
  | { kind: "empty" };

/**
 * 行首标签形态判定：不是本标签 ⇒ undefined。
 * @param ignoreCase 标签大小写不敏感（仅 `@nudo:throws` 历史上如此）
 */
function directiveTagForm(
  line: string,
  tag: string,
  ignoreCase = false,
): DirectiveTagForm | undefined {
  const hit = ignoreCase
    ? line.slice(0, tag.length).toLowerCase() === tag.toLowerCase()
    : line.startsWith(tag);
  if (!hit) return undefined;
  const rest = line.slice(tag.length);
  if (rest === "") return { kind: "empty" };
  if (/^\s/.test(rest)) {
    const payload = rest.trim().replace(/\*\/$/, "").trim();
    return payload === "" ? { kind: "empty" } : { kind: "ok", payload };
  }
  return { kind: "glued", rest };
}

/** 畸形指令段（标签层）：粘连 / 空载荷 */
export type MalformedDirectiveSegment = {
  /** 指令标签（`@nudo:contract` / `@nudo:throws` …） */
  tag: string;
  /** 畸形原因：glued = 标签后缺分隔空白（标签名被延长）；empty = 标签无载荷 */
  reason: "glued" | "empty";
  /** 原始行文本（诊断文案 + 定位用） */
  raw: string;
};

/**
 * 畸形指令段扫描（粘连 / 空载荷）。
 *
 * 严格文法（`scanContractSegments` / `scanAssumeSegments` …）只收
 * 「标签 + 分隔空白 + 载荷」；本函数只报另外两种形态——此前它们**零诊断**地
 * 蒸发（Bug 981 / 1032 / 421）。
 *
 * 消费方（refine）按族发**既有**诊断码（`nudo:contract-syntax` /
 * `nudo:directive-syntax` / `nudo:assume-invalid` / `nudo:invariant-invalid`），
 * **不另造新码**。
 *
 * @param tags 只扫这些标签（引理 / 不变量两族走**坏段通道**，不由本函数服务）
 */
export function scanMalformedDirectiveSegments(
  lines: string[],
  tags: readonly string[],
): MalformedDirectiveSegment[] {
  const out: MalformedDirectiveSegment[] = [];
  for (const line of lines) {
    for (const tag of tags) {
      const form = directiveTagForm(line, tag, tag === "@nudo:throws");
      if (!form || form.kind === "ok") continue;
      out.push({ tag, reason: form.kind, raw: line });
    }
  }
  return out;
}

/**
 * `@nudo:contract <param> <name>` / `@nudo:contract return <name>` 行。
 * 支持 `&&` / 逗号连接的多段；返回原始段文本。
 */
export function scanContractSegments(lines: string[]): string[] {
  const reqs: string[] = [];
  for (const line of lines) {
    // 行首锚定：句中散文「声明 @nudo:contract p xy 后…」不是指令
    const m = line.match(/^@nudo:contract\s+(.+)$/);
    if (m) reqs.push(m[1]!.trim().replace(/\*\/$/, "").trim());
  }
  return reqs;
}

/**
 * `@nudo:assume <ident> <= <ident>` 行（issue #152 用户引理前提）。
 * 同时接受 `>=`（构造时翻转为 le）；一函数可多行。返回原始段文本，
 * 文法/操作符/形参校验由消费方（check）发 nudo:assume-invalid。
 *
 * Bug 421 / 1032：**空载荷**（`@nudo:assume` 单独成行）与**粘连**形态
 * （`@nudo:assumed d <= max`——标签名被延长）此前**整行不匹配**严格正则且
 * **无 else 分支** ⇒ 段列表为空 ⇒ **零诊断** ⇒ 用户的引理无声丢失（返回契约
 * 从「已证明」退回「未证明」，唯一信号是**归因错误**的 nudo:unproven-return）。
 * ⇒ 这两种形态各产出一条**坏段**（raw = 原始行文本）⇒ 既有的
 * `nudo:assume-invalid` 通道自然接管（不另造新码）。
 */
export function scanAssumeSegments(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    // 行首锚定：句中散文「声明 @nudo:assume p q 后…」不是指令
    const m = line.match(/^@nudo:assume\s+(.+)$/);
    if (m) {
      out.push(m[1]!.trim().replace(/\*\/$/, "").trim());
      continue;
    }
    const form = directiveTagForm(line, "@nudo:assume");
    if (!form || form.kind === "ok") continue;
    // 空载荷 ⇒ 空串段；粘连 ⇒ 原始行整段（消息里能看见用户真写的形态）
    out.push(form.kind === "empty" ? "" : line);
  }
  return out;
}

/**
 * `@nudo:invariant <name><path> <rel> <number>` 行（issue #176 循环携带
 * 界）。path = `[*]` / `.ident` 序列（可空 = 标量绑定）；rel ∈ >= <= > <；
 * 数字允许负号。一函数可多行；返回原始段文本，文法/绑定名校验由消费方
 * （check）发 nudo:invariant-invalid。
 *
 * Bug 421 / 1032：同 `@nudo:assume`——空载荷 / 粘连形态此前**零诊断**地蒸发
 * ⇒ 产出**坏段** ⇒ `nudo:invariant-invalid` 通道接管。
 */
export function scanInvariantSegments(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    // 行首锚定：句中散文「声明 @nudo:invariant dp >= 0 后…」不是指令
    const m = line.match(/^@nudo:invariant\s+(.+)$/);
    if (m) {
      out.push(m[1]!.trim().replace(/\*\/$/, "").trim());
      continue;
    }
    const form = directiveTagForm(line, "@nudo:invariant");
    if (!form || form.kind === "ok") continue;
    out.push(form.kind === "empty" ? "" : line);
  }
  return out;
}

/**
 * case 行的 `!! throws [Kind]` **后缀**（文档化形态：`@nudo:case "neg" (0) !! throws`）。
 *
 * ⚠ Bug 1033（位置锚收紧）：此前 `scanThrowsDecl` 对**任意**注释行做**无锚**
 * 子串匹配 `!!\s*throws` ⇒ 散文行（"Note: this helper uses !! throws"）、case
 * **名字**字符串内部（`@nudo:case "regression: !! throws" (1)`）都被读成
 * **函数级**抛错申报 ⇒ `filterGateThrows` 把实际抛错**全部放行** ⇒ L2
 * `nudo:entry-may-throw` 门禁被**静默关掉**（假绿、零诊断），而签名面仍打印
 * `throws TypeError` ⇒ 两面打架。
 *
 * 收紧后的口径（两档位置锚，`!! throws` 都必须落在**指令位置**上）：
 * 1. **同行后缀**：本行是 `@nudo:case` 行，`!! throws` 落在**实参括号闭合之后**
 *    （case 名 / 实参内部的同形文本不算）；
 * 2. **续行**：本行以 `!!` 开头，且**上一行是 case 行**（case 行的下一行单独
 *    写 `!! throws [Kind]`）。
 *
 * 兜底口径：只有**显式** `!! throws`（无 kind）才产出「任意 throw」（`*`）⇒
 * `"*"` 不再来自误读。
 */
const CASE_THROWS_SUFFIX_RE =
  /^@nudo:case\b[ \t]*"[^"\n]*"[ \t]*\([^\n]*\)[ \t]*!![ \t]*throws\b(?:[ \t]+([A-Za-z*][\w*|,\s]*))?/i;
/** case 续行形态：单独一行 `!! throws [Kind]`（上一行必须是 case 行） */
const CASE_THROWS_CONT_RE = /^!![ \t]*throws\b(?:[ \t]+([A-Za-z*][\w*|,\s]*))?/i;

/**
 * 本行的 `!! throws` **后缀申报**（kind 文本；无 kind ⇒ 空串 = 任意）。
 * 不是指令位置上的 `!! throws` ⇒ undefined（**不产出任何申报**）。
 *
 * @param prevLine 上一行（续行形态的锚：上一行必须是 case 行）
 */
function caseThrowsSuffixSpec(line: string, prevLine: string | undefined): string | undefined {
  const m = line.match(CASE_THROWS_SUFFIX_RE);
  if (m) return (m[1] ?? "").trim();
  if (prevLine !== undefined && /^\s*@nudo:case\b/.test(prevLine)) {
    const c = line.match(CASE_THROWS_CONT_RE);
    if (c) return (c[1] ?? "").trim();
  }
  return undefined;
}

/**
 * `@nudo:throws …` / case 行 `!! throws …`。
 * 返回 `*` = 申报任意；字符串 = 逗号/空白分隔的 kind 列表；undefined = 无申报。
 *
 * Bug 1033：`!! throws` 只在**指令位置**上采信（见 `caseThrowsSuffixSpec`）⇒
 * 散文行 / case 名内部的同形文本不再被读成**函数级**申报 ⇒ L2 门禁照常执法。
 */
export function scanThrowsDecl(lines: string[]): string | undefined {
  const kinds = new Set<string>();
  let any = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const th = line.match(/^@nudo:throws\s+(.+)$/i);
    if (th) {
      const spec = th[1]!.trim();
      if (spec === "*") any = true;
      else {
        for (const k of spec.split(/[,\s|]+/).map((s) => s.trim()).filter(Boolean)) {
          if (k === "*") any = true;
          else kinds.add(k);
        }
      }
    }
    // Bug 1033：位置锚（case 行后缀 / 其续行）——误读形态不再产出申报
    const cs = caseThrowsSuffixSpec(line, i > 0 ? lines[i - 1] : undefined);
    if (cs !== undefined) {
      const spec = cs;
      if (spec === "" || spec === "*") any = true;
      else {
        for (const k of spec.split(/[,\s|]+/).map((s) => s.trim()).filter(Boolean)) {
          if (k === "*") any = true;
          else kinds.add(k);
        }
      }
    }
  }
  if (any) return "*";
  if (kinds.size > 0) return [...kinds].join(",");
  return undefined;
}

/** `@nudo:budget forks=… calls=… depth=…` → 声明的维度 */
export function scanBudgetDecl(
  lines: string[],
): { forks?: number; calls?: number; depth?: number } | undefined {
  const out: { forks?: number; calls?: number; depth?: number } = {};
  for (const line of lines) {
    const bd = line.match(/^@nudo:budget\s+(.+)$/i);
    if (!bd) continue;
    for (const part of bd[1]!.split(/[,\s|]+/).map((s) => s.trim()).filter(Boolean)) {
      const kv = part.match(/^(forks|calls|depth)\s*=\s*(\d+)$/i);
      if (kv) {
        const num = Number(kv[2]);
        if (Number.isFinite(num) && num >= 1) {
          out[kv[1]!.toLowerCase() as "forks" | "calls" | "depth"] = Math.floor(num);
        }
      }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
