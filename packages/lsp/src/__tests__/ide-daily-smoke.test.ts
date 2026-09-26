/**
 * A6 — IDE daily smoke without a live VS Code / LSP connection.
 * Exercises the service-level path an editor hits on open: file gate,
 * analysis, hover, inlays, sidecar go-to-definition.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeFile,
  shouldAnalyzeFile,
  DEFAULT_ANALYSIS_MODE,
} from "@nudojs/service";
import { getHoverAtPosition } from "../lsp-surface.ts";
import { collectAbsInlays } from "@nudojs/core/internal";
import { parse } from "@nudojs/parser";
import {
  buildSymbolTable,
  findDefinition,
  findIdentifierAtPosition,
  resolveDefinitionLocations,
} from "../symbols.ts";
import { hoverTool } from "../agent-tools.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const EXPORT_SRC = `export function add2(x) {
  return x + 2;
}
`;

describe("A6 IDE daily smoke — file gate + analysis", () => {
  it("defaults analyze an export-bearing .js fixture", () => {
    expect(DEFAULT_ANALYSIS_MODE).toBe("exports");
    expect(shouldAnalyzeFile("/smoke/add2.js", EXPORT_SRC)).toBe(true);
    const result = analyzeFile("/smoke/add2.js", EXPORT_SRC);
    expect(result.functions.length).toBeGreaterThan(0);
    const names = result.functions.map((f) => f.name);
    expect(names).toContain("add2");
  });

  it("non-export plain JS stays quiet under defaults", () => {
    expect(shouldAnalyzeFile("/smoke/plain.js", "function f(){ return 1 }\n")).toBe(false);
  });
});

describe("A6 IDE daily smoke — hover + inlay (service pure path)", () => {
  it("hover returns type info on an export function name", () => {
    // line 1, column 16 sits on `add2` (same pin as agent-hover-interface-tier)
    const hover = getHoverAtPosition("/smoke/add2.js", EXPORT_SRC, 1, 16, undefined, {});
    expect(hover).not.toBeNull();
    const text = hover!.intension ?? hover!.typeText ?? "";
    expect(text).toBeTruthy();
    expect(hover!.interfaceSource).toBe("implicit");
  });

  it("collectAbsInlays yields inlays for analyzed export source", () => {
    const inlays = collectAbsInlays(EXPORT_SRC, { fromFile: "/smoke/add2.js" });
    expect(Array.isArray(inlays)).toBe(true);
    expect(inlays.length).toBeGreaterThan(0);
  });

  it("agent hover tool (same daily path for MCP bridges) returns abs payload", () => {
    const r = hoverTool(
      { file: "/smoke/add2.js", line: 1, column: 16, source: EXPORT_SRC, includeInlays: true },
      { readFile: () => EXPORT_SRC },
    );
    expect(r.isError).not.toBe(true);
    const payload = JSON.parse(r.content[0].text);
    expect(payload.abs).toBeDefined();
    expect(payload.interfaceSource).toBe("implicit");
  });
});

describe("A6 IDE daily smoke — sidecar go-to-definition", () => {
  it("local definition resolves for exported function", () => {
    const ast = parse(EXPORT_SRC);
    const table = buildSymbolTable(ast, "file:///smoke/add2.js");
    const def = findDefinition(table, "add2");
    expect(def).not.toBeNull();
    expect(def!.kind).toBe("function");
  });

  it("resolveDefinitionLocations includes sidecar contract export", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-a6-smoke-"));
    dirs.push(dir);
    const srcPath = join(dir, "add2.js");
    const sidecarPath = join(dir, "add2.nudo.js");
    writeFileSync(srcPath, EXPORT_SRC);
    writeFileSync(sidecarPath, "export const add2 = number().int();\n");
    const ident = findIdentifierAtPosition(parse(EXPORT_SRC), 1, 16);
    expect(ident).toBe("add2");
    const locs = resolveDefinitionLocations(srcPath, EXPORT_SRC, "add2");
    const files = locs.map((d) => d.filePath);
    expect(files).toContain(srcPath);
    expect(files).toContain(sidecarPath);
  });
});
