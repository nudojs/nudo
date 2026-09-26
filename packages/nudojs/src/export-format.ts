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

export function schemaDialectOf(
  _format: ExportFormat,
  dialect: SchemaDialectName | undefined,
): SchemaDialectName {
  return dialect ?? "zod";
}

export function schemaFileName(stem: string, dialect: SchemaDialectName): string {
  return `${stem}.nudo.schema.${dialect}.ts`;
}
