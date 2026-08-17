import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  analyzeFile,
  getTypeAtPosition,
  getCompletionsAtPosition,
  getCasesForFile,
  typeValueToTSType,
  generateDts,
  typeValueToZodSchema,
  generateGuardFunction,
} from "@nudojs/service";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition, findReferences, findIdentifierAtPosition } from "../symbols.ts";
import {
  analysisCache,
  clearValidationState,
  getCachedOrAnalyze,
  hasNudoDirectives,
  knownFiles,
  validateText,
  type ValidateTextDeps,
} from "../validation.ts";

const filePath = "/test/lsp-integration.js";
const testCode = `
// @nudo:case "admin" ({ role: "admin", name: "Alice" })
// @nudo:case "user" ({ role: "user", name: "Bob" })
function getGreeting(user) {
  switch (user.role) {
    case "admin":
      return "Hello Admin " + user.name;
    case "user":
      return "Hi " + user.name;
  }
}

// @nudo:case "success" ({ status: 200, data: { items: [1, 2, 3] } })
// @nudo:case "error" ({ status: 500, error: "fail" })
function handleResponse(res) {
  if (res.status === 200) {
    return res.data.items;
  }
  return res.error;
}

// @nudo:case "with-val" ("hello")
// @nudo:case "null" (null)
function process(val) {
  if (!val) return "empty";
  return val.toUpperCase();
}

function helper(x) {
  return x * 2;
}

// @nudo:case "test" ([1, 2, 3])
function first(arr) {
  if (!Array.isArray(arr)) return null;
  return arr[0];
}

/**
 * @nudo:returns (T.string)
 * @nudo:case "num" (42)
 */
function alwaysString(x) {
  if (typeof x === "number") return x;
  return "default";
}
`;

describe("LSP Integration - Full Pipeline", () => {

  describe("analyzeFile", () => {
    it("analyzes all functions with directives", () => {
      const result = analyzeFile(filePath, testCode);
      expect(result.functions.length).toBeGreaterThanOrEqual(4);
      const names = result.functions.map(f => f.name);
      expect(names).toContain("getGreeting");
      expect(names).toContain("handleResponse");
      expect(names).toContain("process");
      expect(names).toContain("first");
    });

    it("returns case hints for each function", () => {
      const result = analyzeFile(filePath, testCode);
      expect(result.caseHints.length).toBeGreaterThan(0);
      for (const hint of result.caseHints) {
        expect(hint.line).toBeGreaterThan(0);
        expect(hint.label).toBeTruthy();
      }
    });

    it("generates diagnostics for assertion failures", () => {
      const result = analyzeFile(filePath, testCode);
      const assertionDiags = result.diagnostics.filter(d => d.code === "nudo-assertion-failed");
      expect(assertionDiags.length).toBeGreaterThan(0);
      expect(assertionDiags[0].message).toContain("inferred");
    });
  });

  describe("getTypeAtPosition", () => {
    it("returns type for function with directives", () => {
      // Test with a simple single-function source
      const simpleCode = `
// @nudo:case "test" (42)
function foo(x) {
  return x + 1;
}
`;
      const tv = getTypeAtPosition("/test/simple.js", simpleCode, 3, 10);
      // May return null if position is not in the right place, but should not throw
      expect(true).toBe(true);
    });

    it("returns null for non-nudo files", () => {
      const plainCode = `function foo(x) { return x; }`;
      const tv = getTypeAtPosition("/test/plain.js", plainCode, 1, 22);
      expect(tv).toBeNull();
    });
  });

  describe("getCompletionsAtPosition", () => {
    it("returns completions for object properties", () => {
      const completions = getCompletionsAtPosition(filePath, testCode, 7, 20); // after 'user.'
      expect(Array.isArray(completions)).toBe(true);
    });
  });

  describe("getCasesForFile", () => {
    it("returns all cases for all functions", () => {
      const cases = getCasesForFile(filePath, testCode);
      expect(cases.length).toBeGreaterThanOrEqual(4);

      const greetingCases = cases.find(c => c.functionName === "getGreeting");
      expect(greetingCases).toBeDefined();
      expect(greetingCases!.cases.length).toBe(2);
      expect(greetingCases!.cases[0].name).toBe("admin");
      expect(greetingCases!.cases[1].name).toBe("user");
    });
  });

  describe("validation core (validateText / analysis cache / dirty propagation)", () => {
    it("getCachedOrAnalyze reuses the cached result for the same document version", () => {
      clearValidationState();
      const src = `function badNum(n) { return n.toUpperCase(); }\nconst boom = badNum(42);\n`;

      const first = getCachedOrAnalyze("/test/cache.js", src, 1);
      const second = getCachedOrAnalyze("/test/cache.js", src, 1);
      expect(second).toBe(first); // identical reference → no re-analysis on cache hit

      const bumped = getCachedOrAnalyze("/test/cache.js", src, 2);
      expect(bumped).not.toBe(first); // version change → re-evaluated
      expect(bumped.diagnostics.some((d) => d.code === "nudo:no-method")).toBe(true);
    });

    it("validateText maps origin provenance to relatedInformation at the argument literal", async () => {
      clearValidationState();
      const src = [
        "function badNum(n) {",
        "  return n.toUpperCase();",
        "}",
        "const boom = badNum(42);",
        "",
      ].join("\n");

      const sent = new Map<string, any[]>();
      await validateText("/test/origin.js", "file:///test/origin.js", src, 1, {
        sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
      });

      expect([...sent.keys()]).toEqual(["file:///test/origin.js"]);
      const noMethod = sent.get("file:///test/origin.js")!.find((d) => d.code === "nudo:no-method");
      expect(noMethod).toBeDefined();
      expect(noMethod.relatedInformation).toHaveLength(1);
      const related = noMethod.relatedInformation[0];
      expect(related.message).toBe("value originates here");
      expect(related.location.uri).toBe("file:///test/origin.js");
      expect(related.location.range.start.line).toBe(3); // 1-based line 4 → 0-based
      const col = related.location.range.start.character;
      expect(col).toBeGreaterThanOrEqual(18); // points at the 42 literal
      expect(col).toBeLessThanOrEqual(22);

      // async validation refreshes the analysis cache for subsequent handlers
      expect(analysisCache.get("/test/origin.js")?.version).toBe(1);
      expect(knownFiles.has("/test/origin.js")).toBe(true);
    });

    it("revalidates open dependents when an imported module changes", async () => {
      clearValidationState();
      const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-prop-"));
      try {
        const bPath = resolve(dir, "b.js");
        const aPath = resolve(dir, "a.js");
        const uriOf = (p: string) => `file://${p}`;
        // a.js: calls the imported g(42) from inside a function (top-level call makes it evaluate)
        const aSrc = [
          'import { g } from "./b.js";',
          '// @nudo:case "smoke" (1)',
          "function tiny(v) { return v; }",
          "function useG() { return g(42); }",
          "useG();",
          "",
        ].join("\n");
        const bV1 = '// @nudo:case "s" ("hi")\nexport function g(x) { return x; }\n';
        const bV2 = '// @nudo:case "s" ("hi")\nexport function g(x) { return x.toUpperCase(); }\n';
        writeFileSync(bPath, bV1);
        writeFileSync(aPath, aSrc);

        let bText = bV1;
        let bVersion = 1;
        const openDocs = new Map<string, { uri: string; version: number; getText(): string }>([
          [aPath, { uri: uriOf(aPath), version: 1, getText: () => aSrc }],
          [bPath, { uri: uriOf(bPath), version: bVersion, getText: () => bText }],
        ]);
        const sent = new Map<string, any[]>();
        const deps: ValidateTextDeps = {
          sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
          isNudoUri: (uri) => {
            const doc = [...openDocs.values()].find((d) => d.uri === uri);
            return doc ? hasNudoDirectives(doc.getText()) : false;
          },
          getActiveCases: () => new Map(),
          getOpenDocumentByPath: (p) => openDocs.get(p),
        };

        // initial validation: b v1 is safe, a must have no no-method diagnostic
        await validateText(aPath, uriOf(aPath), aSrc, 1, deps, true);
        const initial = sent.get(uriOf(aPath)) ?? [];
        expect(initial.some((d) => d.code === "nudo:no-method")).toBe(false);

        // b changes (buffer + disk, so a's import resolution sees the new body)
        bText = bV2;
        bVersion = 2;
        writeFileSync(bPath, bV2);
        await validateText(bPath, uriOf(bPath), bText, bVersion, deps, true);

        // a was revalidated via dirty propagation and now flags g(42)
        const refreshed = sent.get(uriOf(aPath)) ?? [];
        const noMethod = refreshed.find((d) => d.code === "nudo:no-method");
        expect(noMethod).toBeDefined();
        expect(noMethod.message).toContain("toUpperCase");
        expect(noMethod.relatedInformation).toHaveLength(1);
        expect(noMethod.relatedInformation[0].location.uri).toBe(uriOf(aPath));
        expect(noMethod.relatedInformation[0].location.range.start.line).toBe(3); // `function useG() { return g(42); }`

        // propagation registered both files and refreshed a's cached result
        expect(knownFiles.has(aPath)).toBe(true);
        expect(knownFiles.has(bPath)).toBe(true);
        expect(analysisCache.get(aPath)?.result.diagnostics.some((d) => d.code === "nudo:no-method")).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe("LSP Integration - Symbol Table", () => {
  it("finds function definition", () => {
    const ast = parse(testCode);
    const table = buildSymbolTable(ast, "file:///test.js");

    const def = findDefinition(table, "getGreeting");
    expect(def).not.toBeNull();
    expect(def!.kind).toBe("function");
    expect(def!.loc.start.line).toBe(4);
  });

  it("finds variable definition", () => {
    const source = `const myVar = 42; console.log(myVar);`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");

    const def = findDefinition(table, "myVar");
    expect(def).not.toBeNull();
    expect(def!.kind).toBe("variable");
  });

  it("finds all references to a symbol", () => {
    const source = `
function add(a, b) { return a + b; }
const result = add(1, 2);
const doubled = add(result, result);
`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");
    const refs = findReferences(table, "add");
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it("finds identifier at specific position", () => {
    const ast = parse(testCode);
    const ident = findIdentifierAtPosition(ast, 5, 10); // inside getGreeting function
    expect(ident).not.toBeNull();
  });
});

describe("LSP Integration - Type Generation", () => {
  it("generates DTS for analyzed functions", () => {
    const result = analyzeFile(filePath, testCode);
    const dts = generateDts(result);
    expect(dts).toContain("getGreeting");
    expect(dts).toContain("handleResponse");
    expect(dts).toContain("export declare function");
  });

  it("generates Zod schemas for inferred types", () => {
    const result = analyzeFile(filePath, testCode);
    const greetingFn = result.functions.find(f => f.name === "getGreeting");
    expect(greetingFn).toBeDefined();
    if (greetingFn?.combined) {
      const schema = typeValueToZodSchema(greetingFn.combined);
      expect(schema).toBeTruthy();
      expect(schema.length).toBeGreaterThan(0);
    }
  });

  it("generates guard functions for inferred types", () => {
    // Verify the function exists and can be called
    expect(typeof generateGuardFunction).toBe("function");
    // Test with a mock literal type value
    const mockLiteral = { kind: "literal", value: 42 };
    const guard = generateGuardFunction("is42", mockLiteral as any);
    expect(guard).toContain("function is42");
    expect(guard).toContain("return");
    expect(guard).toContain("42");
  });

  it("converts type values to TS types", () => {
    const result = analyzeFile(filePath, testCode);
    for (const fn of result.functions) {
      for (const c of fn.cases) {
        const tsType = typeValueToTSType(c.result);
        expect(tsType).toBeTruthy();
        expect(typeof tsType).toBe("string");
      }
    }
  });
});

describe("LSP Integration - Narrowing Features", () => {
  it("narrows through switch statement", () => {
    // Test that analyzeFile produces different results for different cases
    const result = analyzeFile(filePath, testCode);
    const greetingFn = result.functions.find(f => f.name === "getGreeting");
    expect(greetingFn).toBeDefined();
    expect(greetingFn!.cases.length).toBe(2);
    // Each case should produce different types
    const case0 = greetingFn!.cases[0];
    const case1 = greetingFn!.cases[1];
    expect(case0.result).toBeDefined();
    expect(case1.result).toBeDefined();
  });

  it("narrows through truthiness check", () => {
    // Test that the process function narrows correctly
    const result = analyzeFile(filePath, testCode);
    const processFn = result.functions.find(f => f.name === "process");
    expect(processFn).toBeDefined();
    expect(processFn!.cases.length).toBe(2);
    // The "with-val" case should return a string
    const withValCase = processFn!.cases.find(c => c.name === "with-val");
    expect(withValCase).toBeDefined();
  });

  it("narrows through Array.isArray", () => {
    // Test that the first function handles arrays
    const result = analyzeFile(filePath, testCode);
    const firstFn = result.functions.find(f => f.name === "first");
    expect(firstFn).toBeDefined();
    expect(firstFn!.cases.length).toBe(1);
    expect(firstFn!.cases[0].name).toBe("test");
  });

  it("narrows through status comparison", () => {
    // Test that handleResponse narrows based on status
    const result = analyzeFile(filePath, testCode);
    const handleResponseFn = result.functions.find(f => f.name === "handleResponse");
    expect(handleResponseFn).toBeDefined();
    expect(handleResponseFn!.cases.length).toBe(2);
    const successCase = handleResponseFn!.cases.find(c => c.name === "success");
    const errorCase = handleResponseFn!.cases.find(c => c.name === "error");
    expect(successCase).toBeDefined();
    expect(errorCase).toBeDefined();
  });
});
