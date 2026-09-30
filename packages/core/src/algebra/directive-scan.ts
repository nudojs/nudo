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
import { stripStringsKeepComments } from "./code-text.ts";
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
  /** 绑定名：`f` / `C.m` / `default` / `<anonymous>` */
  name: string;
  node: Node;
  /** 该函数的前导注释块（comment.value 原文，文档序） */
  commentTexts: string[];
  /** commentTexts 清洗后的行 */
  commentLines: string[];
  /** 与 commentTexts 对齐的注释起始行号 */
  commentStartLines: number[];
  startLine: number;
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

type WalkCtx = { owner?: string };

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
  ): void => {
    out.push(
      buildScope(
        name,
        fnNode,
        wrapper,
        (commentNode as { leadingComments?: readonly Comment[] } | undefined)?.leadingComments,
        (wrapper as { leadingComments?: readonly Comment[] } | undefined)?.leadingComments,
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
        const name = n.id?.name ?? (ctx as { fallbackName?: string }).fallbackName ?? "<anonymous>";
        pushNamedFn(name, node, node as Node, (ctx as { wrapperNode?: Node }).wrapperNode);
        visit(n.body as Node, { owner: name });
        return;
      }
      case "FunctionExpression": {
        const name = n.id?.name ?? (ctx as { fallbackName?: string }).fallbackName ?? "<anonymous>";
        pushNamedFn(name, node, node as Node, (ctx as { wrapperNode?: Node }).wrapperNode);
        visit(n.body as Node, { owner: name });
        return;
      }
      case "ArrowFunctionExpression": {
        const name = (ctx as { fallbackName?: string }).fallbackName ?? "<anonymous>";
        pushNamedFn(name, node, (ctx as { commentHost?: Node }).commentHost ?? (node as Node), (ctx as { wrapperNode?: Node }).wrapperNode);
        visit(n.body as Node, { owner: name });
        return;
      }
      case "VariableDeclaration": {
        for (const d of (n.declarations as unknown[]) ?? []) {
          const decl = d as { id?: { type?: string; name?: string }; init?: Node | null };
          const idName = decl.id?.type === "Identifier" ? decl.id.name : undefined;
          if (isFnExpr(decl.init)) {
            const fn = decl.init!;
            // 注释带在 VariableDeclaration 上；函数名 = 变量名
            const scope = buildScope(
              idName ?? "<anonymous>",
              fn,
              (ctx as { wrapperNode?: Node }).wrapperNode,
              (node as { leadingComments?: readonly Comment[] }).leadingComments,
              ((ctx as { wrapperNode?: Node }).wrapperNode as { leadingComments?: readonly Comment[] } | undefined)?.leadingComments,
            );
            out.push(scope);
            visit(fn, { owner: idName });
          } else {
            // 非函数初始化：仍要递归进对象字面量里的 method / 嵌套函数
            visit(decl.init, { owner: idName, commentHost: node, wrapperNode: (ctx as { wrapperNode?: Node }).wrapperNode } as WalkCtx);
            // 对象方法注释带在 ObjectMethod 上，不在此处
          }
        }
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        const cname = n.id?.name ?? (ctx as { fallbackName?: string }).fallbackName ?? "<anonymous>";
        if (n.type === "ClassDeclaration") {
          // class 自身不是函数站点，但要递归 body
        }
        const body = (n.body as { body?: unknown[] })?.body ?? [];
        for (const m of body) visit(m as Node, { owner: cname });
        return;
      }
      case "ClassMethod":
      case "ClassPrivateMethod":
      case "ObjectMethod": {
        const key = keyNameOf(n.key);
        const owner = ctx.owner;
        const name = key ? (owner ? `${owner}.${key}` : key) : "<anonymous>";
        pushNamedFn(name, node, node as Node, undefined);
        visit(n.body as Node, { owner: name });
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
            ),
          );
          visit(val, { owner: name });
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
      case "AssignmentExpression":
        visit(n.left as Node, ctx);
        visit(n.right as Node, ctx);
        return;
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
        visit(n.expression as Node, ctx);
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
      pushNamedFn(name, decl, decl, wrapper);
      visit(d.body as Node, { owner: name });
      return;
    }
    if (d.type === "ClassDeclaration" || d.type === "ClassExpression") {
      const cname = d.id?.name ?? "<anonymous>";
      const body = (d.body as { body?: unknown[] })?.body ?? [];
      for (const m of body) visit(m as Node, { owner: cname });
      return;
    }
    if (d.type === "VariableDeclaration") {
      for (const raw of (d.declarations as unknown[]) ?? []) {
        const vd = raw as { id?: { type?: string; name?: string }; init?: Node | null };
        const idName = vd.id?.type === "Identifier" ? vd.id.name : undefined;
        if (isFnExpr(vd.init)) {
          const fn = vd.init!;
          out.push(
            buildScope(
              idName ?? "default",
              fn,
              wrapper,
              d.leadingComments,
              (wrapper as { leadingComments?: readonly Comment[] }).leadingComments,
            ),
          );
          visit(fn, { owner: idName });
        } else {
          visit(vd.init, {
            owner: idName,
            commentHost: decl,
            wrapperNode: wrapper,
          } as WalkCtx);
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
        ),
      );
      visit(d.body as Node, { owner: name });
      return;
    }
    visit(decl, { ...ctx, wrapperNode: wrapper } as WalkCtx);
  };

  for (const stmt of file.program.body) {
    visit(stmt as Node, {});
  }
  return out;
}

/** 按绑定名找函数 scope（文档序第一个命中） */
export function findFnDirectiveScope(
  file: File,
  fnName: string,
): FnDirectiveScope | undefined {
  return listFnDirectiveScopes(file).find((s) => s.name === fnName);
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
 */
export function parseEnvPayload(payload: string): string[] {
  return payload
    .split(",")
    .map((e) => e.trim().replace(/^['"]|['"]$/g, ""))
    .filter((e) => e && (/^\w+$/.test(e) || isPathLikeEnv(e)));
}

export type MockModuleRecord = {
  source: string;
  names?: string[];
  fromPath: string;
};

/**
 * `@nudo:mock-module "src" [ { a, b } ] from "path"` 载荷解析。
 * 名表 `{ … }` 可选；单源文法（parser / load-deps 共用）。
 */
export function parseMockModulePayload(payload: string): MockModuleRecord | undefined {
  const partial = payload.match(/^\s*"([^"]+)"\s*\{([^}]+)\}\s*from\s*"([^"]+)"\s*$/);
  if (partial) {
    const names = partial[2]!.split(",").map((n) => n.trim()).filter(Boolean);
    return { source: partial[1]!, names, fromPath: partial[3]! };
  }
  const full = payload.match(/^\s*"([^"]+)"\s+from\s*"([^"]+)"\s*$/);
  if (full) {
    return { source: full[1]!, fromPath: full[2]! };
  }
  return undefined;
}

export type NudoImportRecord = {
  names: string[];
  spec: string;
};

/**
 * `@nudo:import` 载荷：named `{ a, b as c }` / namespace `* as ns`。
 * default 等未识别形态返回 `malformed`（由消费方发诊断）。
 */
export function parseNudoImportPayload(
  payload: string,
): NudoImportRecord | "malformed-default" | "malformed" | undefined {
  const s = payload.trim();
  if (s === "") return undefined;
  const named = s.match(/^\{([^}]+)\}\s*from\s*["']([^"']+)["']$/);
  if (named) {
    const names = named[1]!
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/\/?\s?/, "").trim())
      .join("\n")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.split(/\s+as\s+/).pop()!.trim());
    return { names, spec: named[2]! };
  }
  const ns = s.match(/^\*\s+as\s+(\w+)\s+from\s*["']([^"']+)["']$/);
  if (ns) {
    return { names: [`*${ns[1]}`], spec: ns[2]! };
  }
  if (/^[\w$]+\s+from\b/.test(s) || /^[\w$]+\s*,/.test(s)) return "malformed-default";
  return "malformed";
}

// ---------------------------------------------------------------------------
// 文本级文件级抽取（nudojs / load-deps 消费口；与 parser AST 路径同文法）
// ---------------------------------------------------------------------------

/** 行注释前缀：`//` 或 `///`；排除 `////` 与 `http://` 伪起点 */
const LINE_COMMENT_PREFIX = "(?:^|[^/:])\\/\\/\\/?";

function fileDirectiveVisibleText(source: string): string {
  // 剥字符串 + 块注释：只留 `//` / `///` 行注释可见
  return stripStringsKeepComments(source).replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function extractFileEnvNames(source: string): string[] {
  const text = fileDirectiveVisibleText(source);
  const re = new RegExp(`${LINE_COMMENT_PREFIX}\\s*@nudo:env\\s+([^\\n*]+)`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(...parseEnvPayload(m[1]!));
  }
  return out;
}

export function extractMockModuleRecords(source: string): MockModuleRecord[] {
  const text = fileDirectiveVisibleText(source);
  const re = new RegExp(
    `${LINE_COMMENT_PREFIX}\\s*@nudo:mock-module\\s+([^\\n]+)`,
    "g",
  );
  const out: MockModuleRecord[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rec = parseMockModulePayload(m[1]!);
    if (rec) out.push(rec);
  }
  return out;
}

/**
 * 指令只认**注释行首**（`//` / `///` / 块注释 `*` 续行清洗后以 `@nudo:` 开头）。
 * 句中散文提及（「无 @nudo:import 同名约束时…」）不是指令。
 * 字符串正文里的同形文本不是指令（scanSource 已遮罩）。
 * 返回清洗后的注释行（文档序）。
 */
function directiveCommentLinesRaw(source: string): string[] {
  const src = stripStringsKeepComments(source);
  const out: string[] = [];
  // 行注释（// 或 ///；排除 ////——Babel 值以 // 开头时 cleanDirectiveLine 不剥）
  const lineRe = /(?:^|[^/:])\/\/\/?([^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(src))) {
    out.push(cleanDirectiveLine(m[1]!, "line"));
  }
  // 块注释（含 JSDoc）
  const blockRe = /\/\*([\s\S]*?)\*\//g;
  while ((m = blockRe.exec(src))) {
    out.push(...commentTextToLines(m[1]!, "block"));
  }
  return out;
}

/**
 * `@nudo:import` 载荷行（行首锚定 + 多行 `{ … }` 续行拼接）。
 * 散文句中提及不产出；续行只拼「未闭合 `{` 之后的同批注释行」。
 */
function nudoImportPayloads(source: string): string[] {
  const lines = directiveCommentLinesRaw(source);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^@nudo:import\s/.test(line)) continue;
    let payload = line.replace(/^@nudo:import\s+/, "");
    // 多行 named：`{` 未闭合时拼后续注释行（直到 `}` / from "path"）
    if (payload.startsWith("{")) {
      let depth = 0;
      for (const ch of payload) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      while (depth > 0 && i + 1 < lines.length) {
        i += 1;
        const cont = lines[i]!;
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
 */
export function extractBalancedParens(text: string, startIdx: number): string | null {
  if (text[startIdx] !== "(") return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
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
  /** `=> expected` 表达式原文（同行/续行 `=>`） */
  expectedText?: string;
  /** 标签在 comment.value 中的下标 */
  tagOffset: number;
};

const CASE_NAME_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/\/\/?\s*)?@nudo:case\s+"([^"]+)"\s*\(/g;
const CASE_TAG_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/\/\/?\s*)?@nudo:case\s+([^\n]+)/g;

/**
 * `)` 之后的 `=> expected` 表达式文本。允许 `=>` 出现在续行（剥块注释续行
 * ` * ` 前缀）；不吞下一个 `@nudo:` 标签。期望取 `=>` 所在行的同行剩余。
 */
function extractCaseExpectedExpr(text: string, afterParen: number): string | undefined {
  const lines = text.slice(afterParen).split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (i > 0) line = line.replace(/^\s*\*\s?/, "").replace(/^\s*\/\/\/?\s?/, "");
    if (/^\s*@nudo:/.test(line)) return undefined;
    const arrow = line.match(/^\s*=>\s*(\S.*)$/);
    if (arrow) return arrow[1]!.trim();
    if (line.trim() !== "") return undefined;
  }
  return undefined;
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
    const expectedText = extractCaseExpectedExpr(text, afterParen);
    out.push({ name: m[1]!, argsText: argsStr, expectedText, tagOffset });
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
    const rest = m[1]!.trim();
    if (/^"[^"]+"\s*\(/.test(rest)) continue;
    out.push(rest);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 函数级标签行扫描（contract / throws / budget）
// ---------------------------------------------------------------------------

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
 * `@nudo:throws …` / case 行 `!! throws …`。
 * 返回 `*` = 申报任意；字符串 = 逗号/空白分隔的 kind 列表；undefined = 无申报。
 */
export function scanThrowsDecl(lines: string[]): string | undefined {
  const kinds = new Set<string>();
  let any = false;
  for (const line of lines) {
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
    const cs = line.match(/!!\s*throws(?:\s+([A-Za-z*][\w*|,\s]*))?/i);
    if (cs) {
      const spec = (cs[1] ?? "*").trim();
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
