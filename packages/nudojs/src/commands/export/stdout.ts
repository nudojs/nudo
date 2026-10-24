/**
 * export — stdout 拼装与平铺：投影面文本上屏。
 *
 * 平铺顺序：zod 模块 → standard 块 → guard 块 → dts 块；末尾附 dropped preds
 * 说明（仅当有丢弃项）。
 *
 * stdout 是**一个** TS 模块作用域 ⇒ 四方言平铺进同一作用域有两条硬约束：
 *
 * - **601**：standard 的每个 per-function 模块都是**完整模块**（自带一份
 *   `__nudoCheck` helper + banner）⇒ 平铺 N 份 = N 次同名声明（TS2393 /
 *   TS2300）⇒ helper 前导**只发一次**（公共前导 = 各块逐字相同的前缀）。
 * - **602 / 603**：zod 段与 standard 段对同一函数用**同一命名模板**
 *   （`<fn>Input` / `<fn>Output`）⇒ 平铺进同一作用域必然撞名（TS2451）⇒
 *   跨段标识符去重（先到先得，后段改名）。
 *
 * ⚠ 跨段改名是 **stdout 流内**的去重（`--out` 落盘时各方言各占一个文件 ⇒
 * 无冲突 ⇒ 产物文件名与导出名**不受影响**）。
 *
 * **命名规则的唯一产地** = `export/io.ts`（`DIALECT_SUFFIX` + `uniqueSegmentName`
 * + `ArtifactDialect`）—— 族 17 收口时把本文件原先的本地副本删掉，改为
 * import，避免「stdout 改名规则」与「落盘改名规则」分叉。
 */

import { uniqueSegmentName, type ArtifactDialect } from "./io.ts";

/** 待上屏的投影面产物。 */
export type ExportStdoutParts = {
  /** zod 模块源码（缺席 = 无 schema 产物） */
  schemaSource?: string;
  /** standard 面函数块 */
  standardChunks: readonly string[];
  /** guard 面函数块 */
  guardChunks: readonly string[];
  /** dts 面模块块 */
  dtsChunks: readonly string[];
  /** 未能投影的谓词说明 */
  droppedNotes: readonly string[];
};

/** 一个方言段（= 一个产物面的一块文本）。 */
type StdoutSegment = {
  /** 段的方言标签 */
  dialect: ArtifactDialect;
  /** 段文本 */
  text: string;
};

/** 尾部台账的**来源面**：standard 面（droppedNotes 只由 standard 面产生）。 */
const DROPPED_PREDS_SURFACE = "standard";

/** standard 块的段标题行（`// === <fn> Standard Schema ===`）。 */
const STANDARD_SEGMENT_HEADER = /^\/\/ === .* Standard Schema ===$/;

/**
 * 顶层导出声明（生成产物的形状）：`export const` / `export function` /
 * `export declare function` / `export declare class` …
 */
const TOP_LEVEL_EXPORT_DECL =
  /^export\s+(?:declare\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/** 段文本里声明的顶层标识符（有序、去重）。 */
function declaredIdentifiers(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = TOP_LEVEL_EXPORT_DECL.exec(line);
    if (m === null) continue;
    const name = m[1]!;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * 标识符边界（`$` 是标识符字符 ⇒ 不能用 `\b`）。
 *
 * 反向引用（lookbehind）保证 `alphaInput` 不会命中 `alphaInputOutput`。
 */
function identifierPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, "g");
}

/** 段内标识符改名（声明处 + 段内引用 + 注释里的同名提及）。 */
function renameIdentifier(text: string, from: string, to: string): string {
  return text.replace(identifierPattern(from), to);
}

/** standard 块 → 段标题行 + 模块行（模块行 = banner + helper + 导出体）。 */
function splitStandardChunk(chunk: string): { head: string[]; module: string[] } {
  const lines = chunk.split("\n");
  const idx = lines.findIndex((l) => STANDARD_SEGMENT_HEADER.test(l));
  if (idx < 0) return { head: [], module: lines };
  return { head: lines.slice(0, idx + 1), module: lines.slice(idx + 1) };
}

/** 各块模块行的公共前缀（banner + helper 逐字相同 ⇒ 前缀即前导）。 */
function commonPrefixLines(modules: readonly string[][]): string[] {
  if (modules.length === 0) return [];
  let prefix = modules[0]!.slice();
  for (let k = 1; k < modules.length; k++) {
    const m = modules[k]!;
    let i = 0;
    while (i < prefix.length && i < m.length && prefix[i] === m[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/**
 * standard 各块的公共前导（banner + helper）行数。
 *
 * **不得越过首个导出体行**（`export const ` 开头）：两个同形导出体（同名函
 * 数）会让公共前缀吃进导出体 ⇒ 那里本来就是撞名（另一族 bug，不在本片）。
 *
 * 前导 = 0（各块前导不同源，理论上不会发生）⇒ 不剥任何内容（宁可重复声明也
 * 不丢内容）。
 */
function preludeLineCount(modules: readonly string[][]): number {
  let n = commonPrefixLines(modules).length;
  for (const m of modules) {
    const first = m.findIndex((l) => l.startsWith("export const "));
    if (first >= 0) n = Math.min(n, first);
  }
  return n;
}

/**
 * standard 块 → 方言段：**前导只发一次**（601）。
 *
 * 第一块保留完整前导（banner + helper），其余块剥掉前导 ⇒ 同一 stdout 流里
 * helper 只声明一次（`--out` 落盘时每函数一份文件 ⇒ 各带一份 helper，互不
 * 冲突 ⇒ 不受影响）。
 */
function standardSegments(chunks: readonly string[]): StdoutSegment[] {
  const split = chunks.map(splitStandardChunk);
  const prelude = preludeLineCount(split.map((s) => s.module));
  return split.map((s, i) => ({
    dialect: "standard" as const,
    text: [...s.head, ...(i === 0 ? s.module : s.module.slice(prelude))].join("\n"),
  }));
}

/** stdout 流的方言段（有序：zod → standard → guard → dts）。 */
function stdoutSegments(parts: ExportStdoutParts): StdoutSegment[] {
  const segments: StdoutSegment[] = [];
  if (parts.schemaSource !== undefined) segments.push({ dialect: "zod", text: parts.schemaSource });
  segments.push(...standardSegments(parts.standardChunks));
  for (const g of parts.guardChunks) segments.push({ dialect: "guard", text: g });
  for (const d of parts.dtsChunks) segments.push({ dialect: "dts", text: d });
  return segments;
}

/** stdout 组装结果：上屏的块 + standard 段的跨段改名表。 */
type StdoutAssembly = {
  /** 上屏的块（有序） */
  chunks: string[];
  /** standard 段的跨段改名（原名 → 新名）——台账条目同源改名 */
  standardRenames: Map<string, string>;
};

/**
 * stdout 组装：段 → 跨段标识符去重（602 / 603）→ 上屏块。
 *
 * 去重规则：先出现的段保留原名；后出现的段若声明了**已占用**的标识符 ⇒ 该标
 * 识符在**本段内**改名（`<原名><方言后缀>`，仍占用则加数字后缀）。
 */
function assembleStdout(parts: ExportStdoutParts): StdoutAssembly {
  const used = new Set<string>();
  const standardRenames = new Map<string, string>();
  const chunks: string[] = [];
  for (const seg of stdoutSegments(parts)) {
    let text = seg.text;
    for (const name of declaredIdentifiers(text)) {
      if (!used.has(name)) {
        used.add(name);
        continue;
      }
      const next = uniqueSegmentName(name, seg.dialect, used);
      text = renameIdentifier(text, name, next);
      used.add(next);
      if (seg.dialect === "standard") standardRenames.set(name, next);
    }
    chunks.push(text);
  }
  return { chunks, standardRenames };
}

/**
 * 投影面文本块（有序）：zod → standard → guard → dts。
 *
 * 每块**独立**上屏（各自一行尾换行）——不是拼成一个大字符串。
 */
export function stdoutChunks(parts: ExportStdoutParts): string[] {
  return assembleStdout(parts).chunks;
}

/**
 * dropped preds 说明块（无丢弃项 ⇒ 无块）。
 *
 * 标题按**来源面**取名（standard）——不是按 schema 方言（恒 "zod"）：台账内容
 * 来自 standard 面的 dropped 记录，标题恒称 zod 会让 `--format standard`
 * （根本没产 zod 产物）也宣称「not projected into zod」（Bug 1050）。
 */
export function droppedPredsBlock(
  droppedNotes: readonly string[],
  surface: string = DROPPED_PREDS_SURFACE,
): string[] {
  if (droppedNotes.length === 0) return [];
  return [
    `\n// dropped preds (not projected into ${surface}):`,
    ...droppedNotes.map((n) => `//   ${n}`),
  ];
}

/** 投影面上屏（各块独立 `console.log`）。 */
export function printExportStdout(parts: ExportStdoutParts): void {
  const { chunks, standardRenames } = assembleStdout(parts);
  for (const chunk of chunks) {
    console.log(chunk);
  }
  // 台账条目与 standard 段的改名同源（改名后的导出名要对得上）
  const notes = parts.droppedNotes.map((n) => {
    let out = n;
    for (const [from, to] of standardRenames) out = renameIdentifier(out, from, to);
    return out;
  });
  for (const line of droppedPredsBlock(notes)) {
    console.log(line);
  }
}
