/**
 * 生成段扫描的共享原语（emit 单一实现）。
 *
 * `interface-emitter.ts`（`collectGeneratedSections`）与
 * `interface-derivation-emit.ts`（`collectGeneratedSectionsRaw`）两套段收集器
 * 的逐字重合部分在此单源化。两边的段**探测**口径是真实差异、留在各自文件：
 * 派生路径按 `@generated` 注释行偏移回扫（headerPos），主路径沿段内链回扫
 * 注释块起点（generatedCommentBlockStart）。
 *
 * 与 core `scan-named-exports.ts`（isGeneratedMarkerLine / sectionChain* 四件套，
 * 经 `@nudojs/core/internal` 复用）同一层的段扫描纯函数助手。
 */
import type { ProgramStmts } from "@nudojs/core/internal";

/** 顶层 export 语句（`export const/let`、`export function/class`、`export {}`） */
type ExportStmt = Extract<ProgramStmts[number], { type: "ExportNamedDeclaration" }>;

/**
 * 顶层 export 语句 → { 身份名, 绑定名 }（段收集器的提取段，两路同源）：
 * - 声明形态（export const/let、export function/class）：身份 = 绑定 = 声明名；
 * - 别名段尾（DESIGN-003）：export 子句无声明——身份 = 导出名（含 string 名），
 *   绑定 = specifier local（const 在 header 与子句之间，已入段切片）。
 * 提不出名字 ⇒ 两数组皆空（调用方跳过该段）。
 */
export function exportNamesBindings(stmt: ExportStmt): { names: string[]; bindings: string[] } {
  const names: string[] = [];
  const bindings: string[] = [];
  const d = stmt.declaration;
  if (d) {
    if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id.type === "Identifier") {
          names.push(decl.id.name);
          bindings.push(decl.id.name);
        }
      }
    } else if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") {
      if (d.id) {
        names.push(d.id.name);
        bindings.push(d.id.name);
      }
    }
  } else {
    for (const spec of stmt.specifiers) {
      if (spec.type !== "ExportSpecifier") continue;
      names.push(
        spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value,
      );
      if (spec.local.type === "Identifier") bindings.push(spec.local.name);
    }
  }
  return { names, bindings };
}

/**
 * 从源文本中切除若干段（区间 [start, end)，按 start 升序；重叠段取并集，
 * 段外字节逐字保留）。结构化参数兼容两路的段类型（RawSection /
 * GeneratedSection——都带 { start, end }），不改任何调用方行为。
 */
export function stripSections(
  src: string,
  sections: ReadonlyArray<{ start: number; end: number }>,
): string {
  if (sections.length === 0) return src;
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  let out = "";
  let pos = 0;
  for (const s of sorted) {
    out += src.slice(pos, s.start);
    pos = Math.max(pos, s.end);
  }
  out += src.slice(pos);
  return out;
}
