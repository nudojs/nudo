/**
 * Public API freeze regression — @nudojs/core.
 *
 * Collects export names from `src/algebra/index.ts`, `src/index.ts`, and
 * `src/internal.ts` via the TypeScript compiler API and compares them to
 * `public-api.snapshot.json`. Unplanned add / remove / rename fails CI.
 * Intentional changes must edit the snapshot in the same PR
 * (see packages/core/PUBLIC_API.md).
 *
 * The snapshot freezes the product face (`.` / algebra) and the engine
 * machinery face (`./internal`) separately. Removing a `.` export is **major**;
 * `./internal` may churn in minor.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const corePkgRoot = resolve(here, "..", "..");
const snapshotPath = join(corePkgRoot, "public-api.snapshot.json");
const publicApiMdPath = join(corePkgRoot, "PUBLIC_API.md");

type Kind = "value" | "type";
type Snapshot = {
  package: string;
  subpaths: string[];
  algebra: { values: string[]; types: string[] };
  core: { values: string[]; types: string[] };
  internal: { values: string[]; types: string[] };
};

function isTypeOnlySymbol(checker: ts.TypeChecker, sym: ts.Symbol): boolean {
  const resolved =
    (sym.getFlags() & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(sym)
      : sym;
  const decls = resolved.getDeclarations() ?? [];
  if (decls.length === 0) return false;
  return decls.every(
    (d) => ts.isTypeAliasDeclaration(d) || ts.isInterfaceDeclaration(d),
  );
}

function collectExports(entryRel: string): { values: string[]; types: string[] } {
  const entry = join(corePkgRoot, entryRel);
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entry);
  if (!sf) throw new Error(`source file not found: ${entry}`);
  const sym = checker.getSymbolAtLocation(sf);
  if (!sym) throw new Error(`module symbol not found: ${entry}`);
  const values: string[] = [];
  const types: string[] = [];
  for (const s of checker.getExportsOfModule(sym)) {
    const n = s.getName();
    if (n.startsWith("__")) continue;
    (isTypeOnlySymbol(checker, s) ? types : values).push(n);
  }
  values.sort();
  types.sort();
  return { values, types };
}

function loadSnapshot(): Snapshot {
  return JSON.parse(readFileSync(snapshotPath, "utf-8")) as Snapshot;
}

describe("public-api freeze — export name snapshot", () => {
  // Each collectExports builds a full TS program; CI runners under 4 workers
  // routinely exceed the default 5s.
  it("src/algebra/index.ts export names match the snapshot", { timeout: 60_000 }, () => {
    const snap = loadSnapshot();
    const actual = collectExports("src/algebra/index.ts");
    expect(actual.values).toEqual(snap.algebra.values);
    expect(actual.types).toEqual(snap.algebra.types);
  });

  it("src/index.ts export names match the snapshot", { timeout: 60_000 }, () => {
    const snap = loadSnapshot();
    const actual = collectExports("src/index.ts");
    expect(actual.values).toEqual(snap.core.values);
    expect(actual.types).toEqual(snap.core.types);
  });

  it("src/internal.ts export names match the snapshot", { timeout: 60_000 }, () => {
    const snap = loadSnapshot();
    const actual = collectExports("src/internal.ts");
    expect(actual.values).toEqual(snap.internal.values);
    expect(actual.types).toEqual(snap.internal.types);
  });

  it("product face does not leak engine machinery names", () => {
    const snap = loadSnapshot();
    const leaked = snap.core.values.filter((n) => snap.internal.values.includes(n));
    // Allowed overlap: none — internal is a disjoint face. Host may re-export
    // nothing from internal on `.` after the 3.0 reduction.
    expect(leaked).toEqual([]);
    const leakedTypes = snap.core.types.filter((n) => snap.internal.types.includes(n));
    expect(leakedTypes).toEqual([]);
  });

  it("core barrel adds only the documented host surface over algebra", () => {
    const snap = loadSnapshot();
    const algebraValues = new Set(snap.algebra.values);
    const extraValues = snap.core.values.filter((n) => !algebraValues.has(n));
    // host-only: environment + mock helpers + stripTypes (PUBLIC_API.md §2.1)
    expect(new Set(extraValues)).toEqual(
      new Set(["createEnvironment", "stub", "spy", "mock", "stripTypes"]),
    );
    const algebraTypes = new Set(snap.algebra.types);
    const extraTypes = snap.core.types.filter((n) => !algebraTypes.has(n));
    expect(new Set(extraTypes)).toEqual(new Set(["Environment", "MockHelper"]));
  });

  it("snapshot stays sorted and duplicate-free", () => {
    const snap = loadSnapshot();
    for (const list of [
      snap.algebra.values,
      snap.algebra.types,
      snap.core.values,
      snap.core.types,
      snap.internal.values,
      snap.internal.types,
    ]) {
      expect(list).toEqual([...list].sort());
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("PUBLIC_API.md documents the package name and all subpaths", () => {
    const md = readFileSync(publicApiMdPath, "utf-8");
    expect(md).toContain("@nudojs/core");
    expect(md).toContain("./exec");
    expect(md).toContain("./internal");
    expect(md).toContain("public-api.snapshot.json");
    // curated contract rows must stay documented
    for (const row of [
      "checkSource",
      "transpile",
      "runTranspiled",
      "serializeCheckJson",
      "createEnvironment",
    ]) {
      expect(md).toContain(row);
    }
  });
});
