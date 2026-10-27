/**
 * 模块元数据 —— 从**源 AST**（单次解析）回收模块结构，供 host target 发射与
 * run.ts 的结构化接线使用。
 *
 * 口径约束：
 * - 静态声明导出名 / 顶层函数名**复用** export-names.ts 的同一实现
 *   （`staticExportDeclNamesOfProgram` / `topLevelFunctionNamesOfProgram`）——
 *   不得另写一套 AST 扫描，否则「发射口径」与「回收口径」会分叉；
 * - 本文件不解析源码、不发射代码：调用方把已解析的 File 交进来（
 *   `transpileModule` 保证 source 只 parse 一次）。
 */
import type { File, Node, Program, Statement } from "@babel/types";
import { VISITOR_KEYS } from "@babel/types";

import { DEFAULT_RUNTIME_IMPORT } from "./runtime-import.ts";
import type { TranspileMeta, TranspileOptions } from "./types.ts";
import {
  staticExportDeclNamesOfProgram,
  topLevelFunctionNamesOfProgram,
} from "../export-names.ts";
import { collectPatternNames, collectVarHoistNames } from "./helpers.ts";

/** ModuleExportName（Identifier | StringLiteral）→ 运行时字符串名。 */
function exportNameOf(name: { type?: string; name?: string; value?: string }): string {
  return name.type === "Identifier" ? (name.name ?? "") : (name.value ?? "");
}

/**
 * 解构导出（`export const { p } = o` / `export let [a, b] = xs`）的真实绑定名。
 * 静态声明名口径刻意**不收**内部临时名（Bug 156）；这些名字以显式导出面
 * （`export { p }` → `__nudoExportLazy("p", …)`）出现，故归入 explicit。
 */
function destructuredExportNames(decl: Statement): string[] {
  if (decl.type !== "VariableDeclaration") return [];
  const names = new Set<string>();
  for (const d of decl.declarations) {
    if (d.id.type === "Identifier") continue;
    collectPatternNames(d.id, names);
  }
  return [...names];
}

/** 顶层声明名（声明 / 解构 / import 本地名 + CJS 前导占用名）。 */
function declaredNamesOf(program: Program): string[] {
  const out = new Set<string>();
  const addDecl = (decl: Statement | null | undefined): void => {
    if (!decl) return;
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) collectPatternNames(d.id, out);
      return;
    }
    if (
      (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") &&
      decl.id
    ) {
      out.add(decl.id.name);
    }
  };
  for (const stmt of program.body) {
    if (stmt.type === "ImportDeclaration") {
      for (const spec of stmt.specifiers) out.add(spec.local.name);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      addDecl(stmt.declaration);
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      // 匿名 default 声明在源里没有绑定名（发射期合成名不属源声明面）。
      addDecl(stmt.declaration as Statement);
      continue;
    }
    addDecl(stmt);
  }
  // CJS 前导（run.ts 在模块体前拼入）占用的名字——撞名同样是重复声明。
  out.add("exports");
  out.add("module");
  out.add("__nudoCjsOrig");
  out.add("__nudoCjsThis");
  // 模块级 `var` 提升名：顶层块/if/for 内的 `var` 在发射产物里被提升为
  // 模块顶的 `let <名> = $lit(void 0)`（collectVarHoistNames 口径）——
  // 只扫 program.body 的声明会漏掉它们 ⇒ env/mock 注入同名单词 →
  // 重复词法声明 SyntaxError。函数/类体是独立作用域（helper 内部停降）。
  for (const n of collectVarHoistNames(program.body)) out.add(n);
  return [...out];
}

/** 类声明/表达式在**外层作用域**求值的子面（superClass / 计算键 / 装饰器）。 */
function walkClassOuterFaces(cls: Node, walk: (n: Node | null | undefined) => void): void {
  const c = cls as unknown as {
    superClass?: Node | null;
    decorators?: Node[] | null;
    body?: { body?: Array<{ computed?: boolean; key?: Node; decorators?: Node[] | null }> };
  };
  walk(c.superClass);
  for (const d of c.decorators ?? []) walk(d);
  for (const el of c.body?.body ?? []) {
    for (const d of el.decorators ?? []) walk(d);
    if (el.computed) walk(el.key);
  }
}

/**
 * 模块顶层 `this` 使用（或捕获它的顶层箭头函数）。
 *
 * 边界：非箭头的函数/方法体有自己的 this（停止）；类体 → 只走类外求值面
 * （extends / 计算键 / 装饰器），字段初始化器与静态块的 this 分别属于实例 /
 * 类构造器（停止）；箭头词法继承（下降）。`this` 的 CJS/ESM 口味判定与
 * run.ts 的顶层 this 绑定同一事实面。
 */
function usesTopLevelThisOf(program: Program): boolean {
  let found = false;
  const walk = (n: Node | null | undefined): void => {
    if (found || !n || typeof n !== "object") return;
    switch (n.type) {
      case "ThisExpression":
        found = true;
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ClassPrivateMethod":
      case "StaticBlock":
        return;
      case "ObjectMethod":
      case "ClassMethod": {
        // 计算键在**外层作用域**求值（方法体/字段值才有自己的 this）。
        const m = n as unknown as { computed?: boolean; key?: Node };
        if (m.computed) walk(m.key);
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression":
        walkClassOuterFaces(n, walk);
        return;
      default:
        break;
    }
    for (const key of VISITOR_KEYS[n.type] ?? []) {
      const child = (n as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === "object") walk(c as Node);
        }
      } else if (child && typeof child === "object") {
        walk(child as Node);
      }
    }
  };
  for (const stmt of program.body) walk(stmt);
  return found;
}

/**
 * 源含 ESM 语法：顶层静态 import/export（语法上只能出现在顶层）或任意位置的
 * `import.meta`。动态 `import()` 不算（CJS 也能用），与 code-text.ts 的
 * `sourceHasEsmSyntax` 同口径（那边是剥离注释/字符串后的文本判定）。
 */
function isEsmProgram(program: Program): boolean {
  const walk = (n: Node): boolean => {
    if (
      n.type === "ImportDeclaration" ||
      n.type === "ExportNamedDeclaration" ||
      n.type === "ExportDefaultDeclaration" ||
      n.type === "ExportAllDeclaration"
    ) {
      return true;
    }
    if (n.type === "MetaProperty" && n.meta.name === "import") return true;
    for (const key of VISITOR_KEYS[n.type] ?? []) {
      const child = (n as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === "object" && walk(c as Node)) return true;
        }
      } else if (child && typeof child === "object" && walk(child as Node)) {
        return true;
      }
    }
    return false;
  };
  return walk(program);
}

/** 源码 AST → TranspileMeta（一次顶层扫描 + 两个共享 helper）。 */
export function computeTranspileMeta(
  file: File,
  opts: TranspileOptions = {},
): TranspileMeta {
  const program = file.program;
  const imports: TranspileMeta["imports"] = [];
  const explicitExportNames: string[] = [];
  const seenExplicit = new Set<string>();
  const pushExplicit = (name: string): void => {
    if (seenExplicit.has(name)) return;
    seenExplicit.add(name);
    explicitExportNames.push(name);
  };
  const exportStars: string[] = [];
  let hasDefault = false;

  for (const stmt of program.body) {
    switch (stmt.type) {
      case "ImportDeclaration": {
        const spec = stmt.source.value;
        if (stmt.specifiers.length === 0) {
          imports.push({ spec, kind: "side" });
          break;
        }
        for (const s of stmt.specifiers) {
          if (s.type === "ImportDefaultSpecifier") {
            imports.push({ spec, kind: "default", local: s.local.name });
          } else if (s.type === "ImportNamespaceSpecifier") {
            imports.push({ spec, kind: "namespace", local: s.local.name });
          } else {
            imports.push({
              spec,
              kind: "named",
              imported: exportNameOf(s.imported),
              local: s.local.name,
            });
          }
        }
        break;
      }
      case "ExportAllDeclaration":
        exportStars.push(stmt.source.value);
        break;
      case "ExportDefaultDeclaration":
        hasDefault = true;
        break;
      case "ExportNamedDeclaration": {
        const decl = stmt.declaration;
        if (decl) {
          for (const n of destructuredExportNames(decl)) pushExplicit(n);
          break;
        }
        for (const s of stmt.specifiers) {
          if (s.type === "ExportNamespaceSpecifier") {
            pushExplicit(exportNameOf(s.exported));
          } else if (s.type === "ExportSpecifier") {
            // re-export 的 local 是来源模块导出名；local export 的 local 是
            // 本模块绑定名——两种形态 exported 都是对外的显式导出名。
            pushExplicit(exportNameOf(s.exported));
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const runtimeImportName =
    opts.target === "host" || opts.runtimeImport === null
      ? null
      : (opts.runtimeImport ?? DEFAULT_RUNTIME_IMPORT);

  return {
    imports,
    staticExportNames: staticExportDeclNamesOfProgram(program),
    explicitExportNames,
    exportStars,
    hasDefault,
    topLevelFnNames: topLevelFunctionNamesOfProgram(program),
    declaredNames: declaredNamesOf(program),
    usesTopLevelThis: usesTopLevelThisOf(program),
    isEsm: isEsmProgram(program),
    runtimeImportName,
  };
}
