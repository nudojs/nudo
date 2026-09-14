/**
 * documentSymbol + 跨文件 definition / references / rename 的纯函数测试
 * （不启 live LSP connection）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import {
  documentSymbols,
  findIdentifierAtPosition,
  resolveDefinition,
  resolveReferences,
  collectImportBindings,
  findExportDefinition,
} from "../symbols.ts";

let dir: string;
let decidePath: string;
let scorecardPath: string;

const scorecardSrc = `export function computeScorecard(row) {
  return { score: row.id };
}
export const LIMIT = 10;
`;

const decideSrc = `import { computeScorecard, LIMIT } from "./scorecard.js";

export function decide(row) {
  const card = computeScorecard(row);
  if (LIMIT > 0) return card;
  return null;
}
`;

/** 依赖注入风格：computeScorecard 是参数而非 import —— workspace fallback 场景 */
const scanSrc = `export function runScan({ computeScorecard }) {
  return computeScorecard({ id: 1 });
}
`;

let scanPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-lsp-nav-"));
  scorecardPath = join(dir, "scorecard.js");
  decidePath = join(dir, "decide.js");
  scanPath = join(dir, "scan.js");
  writeFileSync(scorecardPath, scorecardSrc, "utf-8");
  writeFileSync(decidePath, decideSrc, "utf-8");
  writeFileSync(scanPath, scanSrc, "utf-8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("documentSymbols", () => {
  it("lists top-level functions with kind Function", () => {
    const ast = parse(scorecardSrc);
    const syms = documentSymbols(ast);
    const fn = syms.find((s) => s.name === "computeScorecard");
    expect(fn).toBeDefined();
    expect(fn!.kind).toBe(12); // SymbolKind.Function
    expect(fn!.detail).toContain("row");
  });

  it("lists exported const", () => {
    const ast = parse(scorecardSrc);
    const syms = documentSymbols(ast);
    const lim = syms.find((s) => s.name === "LIMIT");
    expect(lim).toBeDefined();
    expect(lim!.detail).toContain("export");
  });
});

describe("cross-file definition", () => {
  it("resolves import binding to target file export", () => {
    // computeScorecard at line 4 col 16 of decideSrc
    const ast = parse(decideSrc);
    const ident = findIdentifierAtPosition(ast, 4, 16);
    expect(ident).toBe("computeScorecard");
    const def = resolveDefinition(decidePath, decideSrc, ident!);
    expect(def).not.toBeNull();
    expect(def!.filePath).toBe(scorecardPath);
    expect(def!.name).toBe("computeScorecard");
    expect(def!.loc.start.line).toBe(1);
  });

  it("local definition stays in file", () => {
    const ast = parse(decideSrc);
    // decide at line 3
    const ident = findIdentifierAtPosition(ast, 3, 16);
    expect(ident).toBe("decide");
    const def = resolveDefinition(decidePath, decideSrc, ident!);
    expect(def!.filePath).toBe(decidePath);
  });
});

describe("workspace fallback definition", () => {
  it("resolves DI-param usage to same-name export in sibling file when fallback enabled", () => {
    const ast = parse(scanSrc);
    const ident = findIdentifierAtPosition(ast, 2, 9);
    expect(ident).toBe("computeScorecard");
    const def = resolveDefinition(scanPath, scanSrc, ident!, { workspaceFallback: true });
    expect(def).not.toBeNull();
    expect(def!.filePath).toBe(scorecardPath);
    expect(def!.name).toBe("computeScorecard");
    expect(def!.loc.start.line).toBe(1);
  });

  it("without fallback (rename path) DI-param usage stays unresolved", () => {
    const def = resolveDefinition(scanPath, scanSrc, "computeScorecard");
    expect(def).toBeNull();
  });

  it("import binding wins over fallback", () => {
    const def = resolveDefinition(decidePath, decideSrc, "computeScorecard", { workspaceFallback: true });
    expect(def!.filePath).toBe(scorecardPath);
    expect(def!.loc.start.line).toBe(1);
  });

  it("unknown name still resolves to null", () => {
    const def = resolveDefinition(scanPath, scanSrc, "noSuchNameAnywhere", { workspaceFallback: true });
    expect(def).toBeNull();
  });
});

describe("cross-file references", () => {
  it("finds importer call sites for exported function", () => {
    const ast = parse(scorecardSrc);
    // computeScorecard at definition
    const ident = findIdentifierAtPosition(ast, 1, 16);
    expect(ident).toBe("computeScorecard");
    const refs = resolveReferences(scorecardPath, scorecardSrc, ident!);
    const inDecide = refs.filter((r) => r.uri === decidePath);
    expect(inDecide.length).toBeGreaterThan(0);
  });

  it("from importer side, references include definition file + importer sites", () => {
    const ast = parse(decideSrc);
    const ident = findIdentifierAtPosition(ast, 4, 16);
    const refs = resolveReferences(decidePath, decideSrc, ident!);
    // 定义位置（scorecard.js L1）
    const inScorecard = refs.filter((r) => r.uri === scorecardPath);
    expect(inScorecard.length).toBeGreaterThan(0);
    expect(inScorecard[0]!.loc.start.line).toBe(1);
    // 调用点（decide.js）
    const inDecide = refs.filter((r) => r.uri === decidePath);
    expect(inDecide.length).toBeGreaterThan(0);
  });
});

describe("import bindings", () => {
  it("collects named imports", () => {
    const ast = parse(decideSrc);
    const bindings = collectImportBindings(ast, decidePath);
    expect(bindings.get("computeScorecard")?.importedName).toBe("computeScorecard");
    expect(bindings.get("LIMIT")?.resolvedPath).toBe(scorecardPath);
  });

  it("finds export definition by name", () => {
    const def = findExportDefinition(scorecardSrc, "LIMIT");
    expect(def).not.toBeNull();
    expect(def!.loc.start.line).toBe(4);
  });
});
