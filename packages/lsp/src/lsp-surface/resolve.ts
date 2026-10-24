/**
 * LSP 表面 — 类型值解析域（定义解析 / 变量链接 / 参数投影 / 用例枚举）。
 *
 * owns：侧车类型值定义解析（resolveTypeValueDef：本地顶层声明 →
 * re-export 桥接 → re-export / import 递归，深度有界）、折叠展示的
 * 引用变量 markdown 链接（linkTypeVariables）、PolyFn 参数槽位投影
 * （projectParamAbs）、文件用例枚举（getCasesForFile / CaseInfo）。
 * 不 owns：判别窄化的过滤决策（narrowing.ts——消费解析结果）、
 * 位置映射与标识符走访（position.ts）。
 */
import { dirname } from "node:path";
import type { File, Identifier, Node } from "@babel/types";
import { abs, type Abs, type PolyFn } from "@nudojs/core";
import { extractDirectivesQuiet, parse } from "@nudojs/parser";
import { locFromNode, resolveModule, type LoadModule, type SourceLocation } from "@nudojs/service";
import { computeLineStarts, isNode, lineColToOffset } from "./position.ts";
export type CaseInfo = {
  functionName: string;
  caseName: string;
  caseIndex: number;
};

export function getCasesForFile(filePath: string, source: string): { functionName: string; cases: { name: string; index: number }[]; loc: SourceLocation }[] {
  const ast = parse(source);
  const functions = extractDirectivesQuiet(ast);
  return functions.map((fn) => {
    const cases = fn.directives
      .filter((d) => d.kind === "case")
      .map((d, i) => ({ name: d.name, index: i }));
    return { functionName: fn.name, cases, loc: locFromNode(fn.node) };
  });
}

/** 类型值变量链接段（display 文本内偏移 → markdown 链接目标） */
type TypeValueLink = { start: number; end: number; target: string };

/**
 * 类型值变量链接：折叠展示中的引用标识符（如 `nullable(astNode)`
 * 的 `astNode`）解析到其定义位置（侧车本地顶层声明 / import 表
 * / re-export 一级），在整行 `ident: display` 中包为
 * `[astNode](file://<定义>#L<行>)`（纯文本段为代码 span——
 * 代码块内链接不渲染，故调用方 plain markdown 推送）。
 * 纯 JS 表达式形态才解析（` ∧ ` 合并形态含非 JS 字符 → 放弃）；
 * 解析不出的名字（构建器如 `string`——非 import 非本地声明）
 * 不链接。无链接段 → undefined。
 */
export function linkTypeVariables(
  ident: string,
  display: string,
  sidecarPath: string,
  sidecarProgram: File["program"],
  sidecarSrc: string,
  loadModule: LoadModule | undefined,
): string | undefined {
  if (loadModule === undefined || display.includes(" ∧ ")) return undefined;
  let exprAst: File;
  try {
    exprAst = parse(display);
  } catch {
    return undefined;
  }
  const lineStarts = computeLineStarts(display);
  const links: TypeValueLink[] = [];
  for (const id of collectExprIdentifiers(exprAst)) {
    const loc = id.loc;
    if (!loc) continue;
    const def = resolveTypeValueDef(
      id.name,
      sidecarPath,
      sidecarProgram,
      sidecarSrc,
      loadModule,
      0,
    );
    if (def === null) continue;
    const start = lineColToOffset(lineStarts, loc.start);
    const end = lineColToOffset(lineStarts, loc.end);
    if (start === -1 || end === -1 || end <= start) continue;
    links.push({ start, end, target: `file://${def.path}#L${def.line}` });
  }
  if (links.length === 0) return undefined;
  links.sort((a, b) => a.start - b.start);
  // 整行渲染（ident 前缀并入首个纯文本段——避免相邻代码
  // span 之间出现空 span）
  const text = `${ident}: ${display}`;
  const shift = ident.length + 2;
  const parts: string[] = [];
  let pos = 0;
  for (const seg of links) {
    const start = seg.start + shift;
    const end = seg.end + shift;
    if (start < pos) continue;
    if (start > pos) parts.push(`\`${text.slice(pos, start)}\``);
    parts.push(`[${text.slice(start, end)}](${seg.target})`);
    pos = end;
  }
  if (pos < text.length) parts.push(`\`${text.slice(pos)}\``);
  return parts.join("");
}

/** 表达式中的引用标识符（跳过成员属性 / 对象键 / 调用 callee） */
function collectExprIdentifiers(ast: File): Identifier[] {
  const out: Identifier[] = [];
  const walk = (node: Node, parent: Node | null): void => {
    for (const key of Object.keys(node)) {
      if (
        key === "loc" ||
        key === "extra" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments"
      ) {
        continue;
      }
      const v = (node as unknown as Record<string, unknown>)[key];
      const visit = (el: unknown, keyName: string): void => {
        if (!isNode(el)) return;
        if (el.type === "Identifier") {
          const skip =
            (keyName === "property" &&
              (parent as unknown as { computed?: boolean } | null)?.computed !==
                true) ||
            (keyName === "key" &&
              (parent as unknown as { computed?: boolean } | null)?.computed !==
                true) ||
            (keyName === "callee" && parent !== null);
          if (!skip) out.push(el as Identifier);
          return;
        }
        walk(el, node);
      };
      if (Array.isArray(v)) {
        for (const el of v) visit(el, key);
      } else {
        visit(v, key);
      }
    }
  };
  walk(ast, null);
  return out;
}

/** 类型值定义（定义位置 + 定义表达式 + 所在源码） */
type TypeValueDef = {
  path: string;
  line: number;
  /** 定义表达式（VariableDeclarator.init / 函数声明
   *  / default 声明）——判别窄化（union 臂过滤）用 */
  node?: Node;
  /** 定义所在文件源码（臂文本切片用） */
  src: string;
};

/**
 * 类型值定义解析：侧车本地顶层声明 → re-export 桥接
 * （`export { a as b }`）→ re-export（`export { x } from`
 * 递归依赖）→ import 表（递归依赖）。深度上限 2
 * （re-export / import 链有界）。依赖经 resolveModule
 * 解析（相对 spec + 目录 → 路径 + AST），源码经
 * loadModule 读（臂切片用）。
 */
export function resolveTypeValueDef(
  name: string,
  filePath: string,
  program: File["program"],
  src: string,
  loadModule: LoadModule,
  depth: number,
): TypeValueDef | null {
  if (depth > 2) return null;
  const locals = new Map<string, { line: number; node?: Node }>();
  const imports = new Map<string, { imported: string; spec: string }>();
  const bridges = new Map<string, string>();
  const reexports = new Map<string, { local: string; spec: string }>();
  for (const stmt of program.body) {
    const t = stmt as unknown as {
      type: string;
      source?: { value: string };
      specifiers?: Node[];
      declaration?: Node;
      loc?: { start: { line: number } };
    };
    if (t.type === "ImportDeclaration" && t.specifiers && t.source) {
      for (const sp of t.specifiers) {
        const s = sp as unknown as {
          type: string;
          local: Identifier;
          imported?: Identifier;
        };
        if (s.type === "ImportSpecifier") {
          imports.set(s.local.name, {
            imported: s.imported?.name ?? "default",
            spec: t.source.value,
          });
        } else if (s.type === "ImportDefaultSpecifier") {
          imports.set(s.local.name, { imported: "default", spec: t.source.value });
        }
      }
    } else if (t.type === "VariableDeclaration" && t.declaration === undefined) {
      for (const d of (stmt as unknown as { declarations: Node[] }).declarations) {
        const dd = d as unknown as { id: Node; init?: Node };
        if (dd.id.type === "Identifier") {
          locals.set(dd.id.name, {
            line: stmt.loc?.start.line ?? 1,
            node: dd.init,
          });
        }
      }
    } else if (
      t.type === "FunctionDeclaration" &&
      (stmt as unknown as { id?: Identifier }).id
    ) {
      locals.set((stmt as unknown as { id: Identifier }).id.name, {
        line: stmt.loc?.start.line ?? 1,
        node: stmt,
      });
    } else if (t.type === "ExportNamedDeclaration") {
      const decl = t.declaration;
      if (decl) {
        if (decl.type === "VariableDeclaration") {
          for (const d of (decl as unknown as { declarations: Node[] }).declarations) {
            const dd = d as unknown as { id: Node; init?: Node };
            if (dd.id.type === "Identifier") {
              locals.set(dd.id.name, {
                line: decl.loc?.start.line ?? 1,
                node: dd.init,
              });
            }
          }
        } else if (
          decl.type === "FunctionDeclaration" &&
          (decl as unknown as { id?: Identifier }).id
        ) {
          locals.set((decl as unknown as { id: Identifier }).id.name, {
            line: decl.loc?.start.line ?? 1,
            node: decl,
          });
        }
      } else if (t.specifiers) {
        for (const sp of t.specifiers) {
          const s = sp as unknown as {
            type: string;
            local: Identifier;
            exported: Identifier;
          };
          if (s.type !== "ExportSpecifier") continue;
          const exported = s.exported.name;
          const local = s.local.name;
          if (t.source) {
            reexports.set(exported, { local, spec: t.source.value });
          } else {
            bridges.set(exported, local);
          }
        }
      }
    } else if (t.type === "ExportDefaultDeclaration") {
      locals.set("default", {
        line: stmt.loc?.start.line ?? 1,
        node: (stmt as unknown as { declaration?: Node }).declaration,
      });
    }
  }
  const viaLocal = (l: { line: number; node?: Node }): TypeValueDef => ({
    path: filePath,
    line: l.line,
    ...(l.node !== undefined ? { node: l.node } : {}),
    src,
  });
  // 1. 本地顶层声明（含 export 声明）
  const local = locals.get(name);
  if (local !== undefined) return viaLocal(local);
  // 2. re-export 桥接（export { a as b }）→ 本地 a 的声明
  const bridged = bridges.get(name);
  if (bridged !== undefined) {
    const viaB = locals.get(bridged);
    if (viaB !== undefined) return viaLocal(viaB);
  }
  // 3/4. re-export（export { x } from）/ import 表 → 依赖递归
  const viaDep = (localName: string, spec: string): TypeValueDef | null => {
    let dep: ReturnType<typeof resolveModule>;
    try {
      dep = resolveModule(spec, dirname(filePath));
    } catch {
      return null;
    }
    if (dep === null) return null;
    let depSrc: string | undefined;
    try {
      depSrc = loadModule(dep.filePath, filePath);
    } catch {
      return null;
    }
    if (depSrc === undefined) return null;
    return resolveTypeValueDef(
      localName,
      dep.filePath,
      dep.ast.program,
      depSrc,
      loadModule,
      depth + 1,
    );
  };
  const re = reexports.get(name);
  if (re !== undefined) {
    const inner = viaDep(re.local, re.spec);
    if (inner !== null) return inner;
  }
  const imp = imports.get(name);
  if (imp !== undefined) {
    return viaDep(imp.imported, imp.spec);
  }
  return null;
}

/**
 * 无约束形参的 Abs（design §2：入口无约束 = `any`；真 `unknown` 才表示
 * 「推断失败」）。形参位 hover 的兜底面（Bug 774）：无契约的形参在
 * 声明形态面（entryReqs.display）与投影面（entryShapes）上都没有条目
 * ⇒ 此前两条路都空 ⇒ 形参位 hover **完全为空**（同一 hover 的函数名面
 * 却显示 `x: any`）。这里给出与函数名面同口径的 `any`。
 */
function unconstrainedAnyAbs(): Abs {
  return abs({ k: "any" }, undefined, undefined, "path");
}

/**
 * 参数 Abs 投影：光标在参数声明/引用上时，从 enclosing 函数的 PolyFn 面
 * （entryShapes + formals）解析标识符：
 * - 直接形参（id/default）→ entryShapes[name]
 * - 解构形参（pattern）→ bound 名经 propKey 投影到 placeholder 对象 slot
 * （rename `{a: b}` 时契约可写 a 或 b，Abs 对象只有 slot a）
 * 与函数名 hover 同源（契约种子 + 模块图在此生效）。
 *
 * **无契约形参的兜底（Bug 774）**：命中形参但没有契约条目（entryShapes
 * 缺席 / 该形参未契约）⇒ 回落 `any`（design §2），不再返回 undefined
 * 让形参位 hover 空掉。**非形参**标识符仍返回 undefined（诚实无信息）。
 */
export function projectParamAbs(g: PolyFn, ident: string): Abs | undefined {
  const entry = g.entryShapes;
  const formals = g.formals ?? [];
  for (const f of formals) {
    if ((f.kind === "id" || f.kind === "default") && f.name === ident) {
      return entry?.get(f.name)?.abs ?? unconstrainedAnyAbs();
    }
    if (f.kind === "rest" && (f.name === ident || f.display === ident)) {
      return (
        entry?.get(f.name)?.abs ??
        entry?.get(f.display)?.abs ??
        unconstrainedAnyAbs()
      );
    }
    if (f.kind === "pattern" && f.bound.includes(ident)) {
      const abs = entry?.get(f.placeholder)?.abs;
      const key = f.propKey[ident] ?? ident;
      if (abs?.shape.k === "obj") {
        return abs.shape.slots[key]?.value ?? unconstrainedAnyAbs();
      }
      return unconstrainedAnyAbs();
    }
  }
  // formals 缺席（generalize 未产出形参表）时按 params 名单兜底
  if (formals.length === 0 && (g.params ?? []).includes(ident)) {
    return entry?.get(ident)?.abs ?? unconstrainedAnyAbs();
  }
  return undefined;
}
