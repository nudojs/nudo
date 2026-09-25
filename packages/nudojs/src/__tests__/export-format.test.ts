/**
 * export 格式/方言决策纯函数。
 */
import { describe, it, expect } from "vitest";
import {
  EXPORT_FORMATS,
  SCHEMA_DIALECTS,
  normalizeDialect,
  normalizeExportFormat,
  schemaDialectOf,
  schemaFileName,
  wantsSchema,
  wantsStandard,
} from "../export-format.ts";

describe("normalizeExportFormat", () => {
  it.each(EXPORT_FORMATS)("accepts %s", (f) => {
    expect(normalizeExportFormat(f)).toBe(f);
  });

  it.each(["", "Schema", "dts2", "alll", "json"])("rejects %s", (f) => {
    expect(normalizeExportFormat(f)).toBeUndefined();
  });
});

describe("normalizeDialect", () => {
  it("undefined → undefined", () => {
    expect(normalizeDialect(undefined)).toBeUndefined();
  });

  it.each(SCHEMA_DIALECTS)("accepts %s", (d) => {
    expect(normalizeDialect(d)).toBe(d);
  });

  it.each(["", "Zod", "json-schema", "foo"])("rejects %s", (d) => {
    expect(normalizeDialect(d)).toBeUndefined();
  });
});

describe("wantsSchema / wantsStandard", () => {
  it("schema and all want schema", () => {
    expect(wantsSchema("schema")).toBe(true);
    expect(wantsSchema("all")).toBe(true);
    expect(wantsSchema("standard")).toBe(false);
    expect(wantsSchema("guard")).toBe(false);
    expect(wantsSchema("dts")).toBe(false);
  });

  it("standard and all want standard", () => {
    expect(wantsStandard("standard")).toBe(true);
    expect(wantsStandard("all")).toBe(true);
    expect(wantsStandard("schema")).toBe(false);
    expect(wantsStandard("guard")).toBe(false);
    expect(wantsStandard("dts")).toBe(false);
  });
});

describe("schemaDialectOf", () => {
  it("defaults to zod when dialect omitted", () => {
    expect(schemaDialectOf("schema", undefined)).toBe("zod");
    expect(schemaDialectOf("all", undefined)).toBe("zod");
  });

  it("keeps explicit dialect", () => {
    expect(schemaDialectOf("schema", "zod")).toBe("zod");
  });
});

describe("schemaFileName", () => {
  it("builds dialect-suffixed name", () => {
    expect(schemaFileName("app", "zod")).toBe("app.nudo.schema.zod.ts");
  });
});
