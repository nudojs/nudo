/**
 * export — stdout 拼装与平铺：投影面文本上屏。
 *
 * 平铺顺序：zod 模块 → standard 块 → guard 块 → dts 块；末尾附 dropped preds
 * 说明（仅当有丢弃项）。
 */

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
  /** schema 方言（dropped preds 说明里的口径词） */
  dialect: string;
};

/**
 * 投影面文本块（有序）：zod → standard → guard → dts。
 *
 * 每块**独立**上屏（各自一行尾换行）——不是拼成一个大字符串。
 */
export function stdoutChunks(parts: ExportStdoutParts): string[] {
  const chunks: string[] = [];
  if (parts.schemaSource !== undefined) chunks.push(parts.schemaSource);
  chunks.push(...parts.standardChunks, ...parts.guardChunks, ...parts.dtsChunks);
  return chunks;
}

/** dropped preds 说明块（无丢弃项 ⇒ 无块）。 */
export function droppedPredsBlock(
  droppedNotes: readonly string[],
  dialect: string,
): string[] {
  if (droppedNotes.length === 0) return [];
  return [
    `\n// dropped preds (not projected into ${dialect}):`,
    ...droppedNotes.map((n) => `//   ${n}`),
  ];
}

/** 投影面上屏（各块独立 `console.log`）。 */
export function printExportStdout(parts: ExportStdoutParts): void {
  for (const chunk of stdoutChunks(parts)) {
    console.log(chunk);
  }
  for (const line of droppedPredsBlock(parts.droppedNotes, parts.dialect)) {
    console.log(line);
  }
}
