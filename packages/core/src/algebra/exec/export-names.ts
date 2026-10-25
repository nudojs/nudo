/**
 * 静态声明导出名回收 —— 源 AST 口径（transpile/meta）与历史文本口径（回归
 * 测试）共用同一套名字判定。
 *
 * 生产消费方：`transpile/meta.ts` 的 `staticExportDeclNamesOfProgram` /
 * `topLevelFunctionNamesOfProgram`（单次 parse 的 TranspileMeta）——run.ts 已
 * 改吃 meta，**不再**从转译产物文本回收任何名字。
 *
 * 文本口径（`stripStaticExportDecls` / `sourceStaticExportNames`）保留为
 * 回归测试面：它锁定历史发射约定（顶层 function 只在源导出名命中时带
 * `export ` 前缀；export const/let/class 以 `export (const|let) <name>` 发射）
 * 与多声明符/解构导出的名字回收结果（Bug 156 / 280 / 287 / 1121）。
 *
 * 本模块刻意不进 exec/index.ts 桶导出（不属公开面），仅 transpile/meta.ts +
 * 测试引用。
 */

import type { FunctionDeclaration, Statement } from "@babel/types";

import { parseSource } from "../parse-source.ts";

/**
 * JS 标识符名模式源（ES2022 标识符）：`$` / `_` / Unicode ID_Start 开头，
 * 后续可接 ID_Continue（含 ZWNJ/ZWJ）。
 *
 * **不能**用 `\w`——`\w` 是 ASCII-only ⇒ 任何含 `$` 或非 ASCII（中文等）的
 * 导出名整条被丢（Bug 287）：导出函数**从不被分析** ⇒ 签名塌 `unknown` ⇒
 * 追加**假** `nudo:unknown-inference` ⇒ L2 门禁**假绿**。
 *
 * 本模块与 run.ts 的 `export * as` 捕获组共用此模式源（同一口径）。
 */
export const IDENT_NAME_SRC = "[$_\\p{ID_Start}][$_\\u200C\\u200D\\p{ID_Continue}]*";

/** `export function <名>`（名字含 `$` / 非 ASCII 也算——Bug 287）。 */
function exportFunctionRe(): RegExp {
  return new RegExp(`^export function (${IDENT_NAME_SRC})`, "gmu");
}

/** `export (const|let) <名>`（名字含 `$` / 非 ASCII 也算——Bug 287）。 */
function exportConstRe(): RegExp {
  return new RegExp(`^export (?:const|let) (${IDENT_NAME_SRC})`, "gmu");
}

/**
 * 收集静态声明导出名（`export function` / `export (const|let)`）并剥掉 export
 * 关键字（→ `function` / `let`），使这些声明成为可被返回对象简写引用的局部绑定。
 * 去重顺序沿旧口径：先全部 function 名，后全部 const/let 名。
 *
 * `source`（可选）＝原始源码文本。**多声明符**导出（`export const a = 1, b = 2`）
 * 的第 2+ 个声明符在转译产物里**丢了 `export ` 前缀**（转译器只给首个声明符
 * 加）——而「多声明符导出」与「独立声明 + 独立 export」的转译产物**逐字相同**
 * ⇒ 文本上不可区分 ⇒ 只能回**源 AST** 回收第 2+ 个声明符的名字（Bug 280：
 * `b` 不是导出 ⇒ 签名 `unknown` / 跨模块 import `unknown`）。
 */
export function stripStaticExportDecls(
  js: string,
  source?: string,
): { names: string[]; js: string } {
  const exportFns = [...js.matchAll(exportFunctionRe())].map((m) => m[1]!);
  js = js.replace(/^export function /gm, "function ");
  const exportConsts = [...js.matchAll(exportConstRe())].map((m) => m[1]!);
  js = js.replace(/^export (?:const|let) /gm, "let ");
  const names = [...new Set([...exportFns, ...exportConsts])];
  if (source !== undefined) {
    for (const n of sourceStaticExportNames(source)) {
      if (!names.includes(n)) names.push(n);
    }
  }
  return { names, js };
}

/**
 * 源 AST 的静态声明导出名：`export function|class|const|let|var` 的**全部**
 * 声明名（多声明符全收）。与 collectAbsExports（abs-modules.ts）同口径：
 * 解构声明不收内部名（Bug 156）。
 *
 * 解析失败（语法错 / 超限）→ 空名单（调用方按「文本口径」降级，不抛）。
 */
export function sourceStaticExportNames(source: string): string[] {
  try {
    return staticExportDeclNamesOfProgram(parseSource(source).program);
  } catch {
    return [];
  }
}

/**
 * 程序体（源 AST）的静态声明导出名。transpileFile 用它决定顶层
 * FunctionDeclaration 是否发 `export ` 前缀——与 `sourceStaticExportNames`
 * 同源（后者只是解析 + 本函数），避免「发射口径」与「回收口径」分叉。
 */
export function staticExportDeclNamesOfProgram(program: {
  body: readonly Statement[];
}): string[] {
  const out: string[] = [];
  for (const stmt of program.body) {
    if (stmt.type !== "ExportNamedDeclaration") continue;
    const decl = stmt.declaration;
    if (!decl) continue;
    if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
      if (decl.id) out.push(decl.id.name);
      continue;
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier") out.push(d.id.name);
      }
    }
  }
  return out;
}

/** 程序体的顶层函数声明名（源序去重；export / default 包裹展开）。 */
export function topLevelFunctionNamesOfProgram(program: {
  body: readonly Statement[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (decl: FunctionDeclaration | null | undefined): void => {
    if (!decl?.id?.name) return;
    if (seen.has(decl.id.name)) return;
    seen.add(decl.id.name);
    out.push(decl.id.name);
  };
  for (const stmt of program.body) {
    if (stmt.type === "FunctionDeclaration") push(stmt);
    else if (
      (stmt.type === "ExportNamedDeclaration" ||
        stmt.type === "ExportDefaultDeclaration") &&
      stmt.declaration?.type === "FunctionDeclaration"
    ) {
      push(stmt.declaration);
    }
  }
  return out;
}
