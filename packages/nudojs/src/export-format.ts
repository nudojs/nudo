/**
 * export 格式/方言决策（纯）。
 */

export type ExportFormat = "schema" | "standard" | "guard" | "dts" | "all";
export const EXPORT_FORMATS: ExportFormat[] = ["schema", "standard", "guard", "dts", "all"];

export type SchemaDialectName = "zod";
export const SCHEMA_DIALECTS: SchemaDialectName[] = ["zod"];

export function normalizeExportFormat(raw: string): ExportFormat | undefined {
  return EXPORT_FORMATS.includes(raw as ExportFormat) ? (raw as ExportFormat) : undefined;
}

export function normalizeDialect(raw: string | undefined): SchemaDialectName | undefined {
  if (raw === undefined) return undefined;
  return SCHEMA_DIALECTS.includes(raw as SchemaDialectName)
    ? (raw as SchemaDialectName)
    : undefined;
}

export function wantsSchema(format: ExportFormat): boolean {
  return format === "schema" || format === "all";
}

export function wantsStandard(format: ExportFormat): boolean {
  return format === "standard" || format === "all";
}

/**
 * 本次导出的 **schema 方言**（= schema 产物的口径词）。
 *
 * 作用域 = **schema 产物**（`--format schema|all`）：它只喂给 schema 产物文件名
 * （`schemaFileName`）⇒ 没有 schema 产物时这个值不参与任何产物命名。
 *
 * ⚠ 它**不是** stdout `dropped preds` 台账的口径词：台账内容（dropped 记录）
 * 来自 **standard** 面 ⇒ 标题按**来源面**取名（stdout 面，`export/stdout.ts`），
 * 否则 `--format standard`（根本没产 zod 产物）也会宣称「not projected into
 * zod」（Bug 1050）。
 */
export function schemaDialectOf(
  _format: ExportFormat,
  dialect: SchemaDialectName | undefined,
): SchemaDialectName {
  return dialect ?? "zod";
}

export function schemaFileName(stem: string, dialect: SchemaDialectName): string {
  return `${stem}.nudo.schema.${dialect}.ts`;
}
