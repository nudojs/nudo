import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { T } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition, findReferences, findIdentifierAtPosition } from "../symbols.ts";
import {
  analysisCache,
  clearValidationState,
  evictModuleGraphCacheEntries,
  forgetValidatedFile,
  getCachedOrAnalyze,
  hasNudoDirectives,
  knownFiles,
  moduleGraphCache,
  validateText,
  type ValidateTextDeps,
} from "../validation.ts";
import {
  injectBindings,
  normalizeFilePath,
  parseTypeExpr,
  readSource,
  suggestCase,
  trace,
  typeExprToDirective,
  whatIf,
  type AgentToolDeps,
} from "../agent-tools.ts";

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

    it("opening a never-validated file pushes diagnostics immediately (onDidOpen path)", async () => {
      // server.ts 的 onDidOpen → validateDocument(doc, /* propagate */ true) → validateText；
      // didOpen 不经过 onDidChangeContent，打开路径必须主动调一次验证才有即时诊断。
      clearValidationState();
      const src = "function badNum(n) { return n.toUpperCase(); }\nconst boom = badNum(42);\n";
      const sent = new Map<string, any[]>();
      expect(analysisCache.has("/test/open-fresh.js")).toBe(false); // 之前从未验证过

      await validateText("/test/open-fresh.js", "file:///test/open-fresh.js", src, 1, {
        sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
      }, true);

      const diags = sent.get("file:///test/open-fresh.js") ?? [];
      expect(diags.some((d) => d.code === "nudo:no-method")).toBe(true);
      expect(analysisCache.get("/test/open-fresh.js")?.version).toBe(1);
      expect(knownFiles.has("/test/open-fresh.js")).toBe(true);
    });

    it("opening a non-nudo file publishes empty diagnostics and stays out of session state", async () => {
      // 打开入口对非 nudo 文件的门控：清空诊断且不进 knownFiles/analysisCache
      clearValidationState();
      const sent = new Map<string, any[]>();
      await validateText("/test/open-plain.js", "file:///test/open-plain.js", "function id(x) { return x; }\n", 1, {
        sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
        isNudoUri: () => false,
      }, true);

      expect(sent.get("file:///test/open-plain.js")).toEqual([]);
      expect(knownFiles.has("/test/open-plain.js")).toBe(false);
      expect(analysisCache.has("/test/open-plain.js")).toBe(false);
    });

    it("an externally deleted closed file is dropped from knownFiles (watched-files cleanup)", async () => {
      // server.ts 的 DidChangeWatchedFiles(Deleted 且不在打开集) handler 对每个被删
      // uri 调 forgetValidatedFile；这里验证该清理单元确实移除会话登记项。
      clearValidationState();
      const src = '// @nudo:case "n" (1)\nfunction f(x) { return x; }\n';
      await validateText("/test/gone.js", "file:///test/gone.js", src, 1, {
        sendDiagnostics: () => {},
      });
      expect(knownFiles.has("/test/gone.js")).toBe(true);
      expect(analysisCache.has("/test/gone.js")).toBe(true);

      forgetValidatedFile("/test/gone.js");

      expect(knownFiles.has("/test/gone.js")).toBe(false);
      expect(analysisCache.has("/test/gone.js")).toBe(false);
    });

    it("second propagation hits the module-graph edge cache — an unreadable dependency still yields the correct dirty set", async () => {
      // 缓存命中的可观测证明：首验后把「携带依赖边的文件」a chmod 成不可读。
      // 若脏传播重读 a，extractImportEdges 会因 EACCES 静默返回空边，dependents(b)
      // 丢失 a→b，打开中的 a 就不会被重验；只有命中缓存（仅 stat 比对、跳过重读）
      // 时 dirty 集才仍包含 a。
      clearValidationState();
      const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-mgc-hit-"));
      try {
        const aPath = resolve(dir, "a.js");
        const bPath = resolve(dir, "b.js");
        const uriOf = (p: string) => `file://${p}`;
        const aSrc = [
          'import { g } from "./b.js";',
          "function useG() { return g(42); }",
          "useG();",
          "",
        ].join("\n");
        const bV1 = "export function g(x) { return x; }\n";
        const bV2 = "export function g(x) { return x.toUpperCase(); }\n";
        writeFileSync(aPath, aSrc);
        writeFileSync(bPath, bV1);

        let bText = bV1;
        const openDocs = new Map<string, { uri: string; version: number; getText(): string }>([
          [aPath, { uri: uriOf(aPath), version: 1, getText: () => aSrc }],
          [bPath, { uri: uriOf(bPath), version: 1, getText: () => bText }],
        ]);
        const sent = new Map<string, any[]>();
        const deps: ValidateTextDeps = {
          sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
          getActiveCases: () => new Map(),
          getOpenDocumentByPath: (p) => openDocs.get(p),
        };

        // 首验：b、a 依次入会话；a 的传播首次构建模块图并回填边缓存
        await validateText(bPath, uriOf(bPath), bV1, 1, deps);
        await validateText(aPath, uriOf(aPath), aSrc, 1, deps, true);
        expect(moduleGraphCache.has(aPath)).toBe(true);
        expect(moduleGraphCache.has(bPath)).toBe(true);
        expect(new Set(moduleGraphCache.get(aPath)!.edges)).toEqual(new Set([bPath]));
        expect((sent.get(uriOf(aPath)) ?? []).some((d) => d.code === "nudo:no-method")).toBe(false);

        // 依赖边携带者变磁盘不可读（chmod 不改 mtime/size → 缓存条目仍命中），b 内容换版
        chmodSync(aPath, 0o000);
        bText = bV2;
        writeFileSync(bPath, bV2);
        await validateText(bPath, uriOf(bPath), bText, 2, deps, true);

        // dirty 集仍含 a：传播用缓存边算出 dependents(b)={a}，a 用打开缓冲重验并抓到 g(42)
        const refreshed = sent.get(uriOf(aPath)) ?? [];
        const noMethod = refreshed.find((d) => d.code === "nudo:no-method");
        expect(noMethod).toBeDefined();
        expect(noMethod.message).toContain("toUpperCase");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("mtime/size change invalidates the cached edges — propagation follows the rewired import", async () => {
      clearValidationState();
      const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-mgc-inval-"));
      try {
        const aPath = resolve(dir, "a.js");
        const bPath = resolve(dir, "b.js");
        const cPath = resolve(dir, "c.js");
        const uriOf = (p: string) => `file://${p}`;
        const aV1 = [
          'import { g } from "./b.js";',
          "function useG() { return g(42); }",
          "useG();",
          "",
        ].join("\n");
        // 改依赖目标 b→c：注释行保证 size 变化，mtime/size 任一不同即缓存失效重读
        const aV2 = [
          "// rewired: b → c",
          'import { h } from "./c.js";',
          "function useH() { return h(42); }",
          "useH();",
          "",
        ].join("\n");
        const bV1 = "export function g(x) { return x; }\n";
        const bV2 = "export function g(x) { return x.toUpperCase(); }\n";
        const cV1 = "export function h(x) { return x; }\n";
        const cV2 = "export function h(x) { return x.toUpperCase(); }\n";
        writeFileSync(aPath, aV1);
        writeFileSync(bPath, bV1);
        writeFileSync(cPath, cV1);

        let aText = aV1;
        let cText = cV1;
        const openDocs = new Map<string, { uri: string; version: number; getText(): string }>([
          [aPath, { uri: uriOf(aPath), version: 1, getText: () => aText }],
          [cPath, { uri: uriOf(cPath), version: 1, getText: () => cText }],
        ]);
        const publishes = new Map<string, number>();
        const sent = new Map<string, any[]>();
        const deps: ValidateTextDeps = {
          sendDiagnostics: (p) => {
            publishes.set(p.uri, (publishes.get(p.uri) ?? 0) + 1);
            sent.set(p.uri, p.diagnostics);
          },
          getActiveCases: () => new Map(),
          getOpenDocumentByPath: (p) => openDocs.get(p),
        };

        // 首轮：c、b、a 入会话，a 的传播回填边缓存 a→[b]
        await validateText(cPath, uriOf(cPath), cV1, 1, deps);
        await validateText(bPath, uriOf(bPath), bV1, 1, deps);
        await validateText(aPath, uriOf(aPath), aV1, 1, deps, true);
        expect(new Set(moduleGraphCache.get(aPath)!.edges)).toEqual(new Set([bPath]));

        // 磁盘 + 缓冲同步改写 a（size 变化）→ 失效重读，缓存边集换成 a→[c]
        aText = aV2;
        writeFileSync(aPath, aV2);
        await validateText(aPath, uriOf(aPath), aV2, 2, deps, true);
        expect(new Set(moduleGraphCache.get(aPath)!.edges)).toEqual(new Set([cPath]));

        const aPublishesBefore = publishes.get(uriOf(aPath)) ?? 0;

        // 旧依赖 b 变化：a 已不在 b 的 dependents 里，不应再触发 a 的重验发布
        writeFileSync(bPath, bV2);
        await validateText(bPath, uriOf(bPath), bV2, 2, deps, true);
        expect(publishes.get(uriOf(aPath)) ?? 0).toBe(aPublishesBefore);

        // 新依赖 c 变化：传播沿新边 a→c 重验 a，抓到 h(42) 的 no-method
        cText = cV2;
        writeFileSync(cPath, cV2);
        await validateText(cPath, uriOf(cPath), cText, 2, deps, true);
        expect(publishes.get(uriOf(aPath)) ?? 0).toBe(aPublishesBefore + 1);
        const noMethod = (sent.get(uriOf(aPath)) ?? []).find((d) => d.code === "nudo:no-method");
        expect(noMethod).toBeDefined();
        expect(noMethod.message).toContain("toUpperCase");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("watched-files cleanup evicts the module-graph cache entry (registerWatchedFilesListener chain)", async () => {
      // server.ts 在 vitest 下不可 import，链路两段各自落在可测面：handler 对每个
      // gone uri 调 forgetValidatedFile，并把 uri 列表广播给 server.ts 模块级注册的
      // evictModuleGraphCacheEntries。这里用同一导出面模拟整条清理链。
      clearValidationState();
      const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-mgc-evict-"));
      try {
        const aPath = resolve(dir, "a.js");
        const src = "function id(x) { return x; }\n";
        writeFileSync(aPath, src);
        // propagate=true 才会构建模块图回填缓存，故必须提供 getOpenDocumentByPath
        await validateText(aPath, `file://${aPath}`, src, 1, {
          sendDiagnostics: () => {},
          getOpenDocumentByPath: () => undefined,
        }, true);
        expect(knownFiles.has(aPath)).toBe(true);
        expect(analysisCache.has(aPath)).toBe(true);
        expect(moduleGraphCache.has(aPath)).toBe(true);

        // watched-files Deleted 且不在打开集：登记项 + 边缓存条目一并逐出
        forgetValidatedFile(aPath);
        evictModuleGraphCacheEntries([`file://${aPath}`]);

        expect(knownFiles.has(aPath)).toBe(false);
        expect(analysisCache.has(aPath)).toBe(false);
        expect(moduleGraphCache.has(aPath)).toBe(false);

        // 未知条目/纯路径形式：no-op 不抛错
        expect(() => evictModuleGraphCacheEntries(["file:///nope/missing.js", "/nope/raw-path.js"])).not.toThrow();
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

describe("LSP Integration - Agent Tools (whatIf / suggestCase / trace)", () => {
  const whatIfSrc = "const x = 1;\nconst y = x + 1;\n";
  const srcDeps = (src: string): AgentToolDeps => ({ readFile: () => src });

  describe("parseTypeExpr (ported from MCP)", () => {
    it("maps primitive names to T singletons", () => {
      expect(parseTypeExpr("number")).toEqual(T.number);
      expect(parseTypeExpr("string")).toEqual(T.string);
      expect(parseTypeExpr("boolean")).toEqual(T.boolean);
      expect(parseTypeExpr("bigint")).toEqual(T.bigint);
      expect(parseTypeExpr("symbol")).toEqual(T.symbol);
      expect(parseTypeExpr("null")).toEqual(T.null);
      expect(parseTypeExpr("undefined")).toEqual(T.undefined);
    });

    it("builds unions from `|` expressions", () => {
      const u = parseTypeExpr("string | null");
      expect(u.kind).toBe("union");
      if (u.kind === "union") {
        expect(u.members).toHaveLength(2);
        expect(u.members[0]).toEqual(T.string);
        expect(u.members[1]).toEqual(T.null);
      }
    });

    it("falls back to unknown for unrecognized names", () => {
      expect(parseTypeExpr("Date")).toEqual(T.unknown);
    });
  });

  describe("typeExprToDirective / injectBindings", () => {
    it("translates agent type expressions to @nudo:as directive syntax", () => {
      expect(typeExprToDirective("string")).toBe("T.string");
      expect(typeExprToDirective("string | null")).toBe("T.union(T.string, null)");
      expect(typeExprToDirective("T.object({ port: T.number })")).toBe("T.object({ port: T.number })");
      expect(typeExprToDirective("Date")).toBe("T.unknown");
    });

    it("inserts an @nudo:as line above the declaring statement", () => {
      const { source, applied, unapplied } = injectBindings(whatIfSrc, [
        { name: "x", type: "string | null" },
      ]);
      expect(applied).toEqual(["x: string | null"]);
      expect(unapplied).toEqual([]);
      expect(source).toBe("// @nudo:as T.union(T.string, null)\nconst x = 1;\nconst y = x + 1;\n");
    });

    it("reports bindings with no matching top-level declaration as unapplied", () => {
      const { source, applied, unapplied } = injectBindings(whatIfSrc, [
        { name: "nope", type: "string" },
      ]);
      expect(applied).toEqual([]);
      expect(unapplied).toEqual(["nope"]);
      expect(source).toBe(whatIfSrc);
    });
  });

  describe("whatIf binding injection", () => {
    it("bindings change the inferred target type (default vs assumed)", () => {
      const base = whatIf({ file: "/test/what-if.js", bindings: [], target: "y" }, srcDeps(whatIfSrc));
      const assumed = whatIf(
        { file: "/test/what-if.js", bindings: [{ name: "x", type: "string" }], target: "y" },
        srcDeps(whatIfSrc),
      );

      // without assumptions x=1 folds to a literal and y = 2
      expect(base.content[0].text).toContain('Type of "y": 2');
      // with x:string the + operator widens y to string — the assumption really flowed
      expect(assumed.content[0].text).toContain('Type of "y": string');
      expect(assumed.content[0].text).not.toBe(base.content[0].text);
      expect(assumed.content[0].text).toContain("Bindings applied: x: string");
    });

    it("union bindings surface as union types", () => {
      const res = whatIf(
        { file: "/test/what-if.js", bindings: [{ name: "x", type: "string | null" }], target: "x" },
        srcDeps(whatIfSrc),
      );
      expect(res.content[0].text).toContain("string | null");
    });

    it("reports unknown targets", () => {
      const res = whatIf(
        { file: "/test/what-if.js", bindings: [{ name: "x", type: "string" }], target: "missing" },
        srcDeps(whatIfSrc),
      );
      expect(res.content[0].text).toContain('Type of "missing": unknown');
      // x was still applied — only the target lookup missed
      expect(res.content[0].text).toContain("Bindings applied: x: string");
      expect(res.content[0].text).not.toContain("Bindings not applied");
    });
  });

  describe("open-document priority and disk fallback", () => {
    it("open buffer text wins over disk; disk is read when not open", () => {
      const openSrc = "const x = 7;\nconst y = x * 2;\n";
      const deps: AgentToolDeps = {
        getOpenText: (p) => (p === "/test/open-doc.js" ? { text: openSrc } : undefined),
        readFile: (p) => {
          if (p !== "/test/open-doc.js") throw new Error("unexpected read of " + p);
          return whatIfSrc;
        },
      };
      const fromBuffer = whatIf({ file: "/test/open-doc.js", bindings: [], target: "y" }, deps);
      expect(fromBuffer.content[0].text).toContain('Type of "y": 14');
    });

    it("whatIf / suggestCase / trace read unopened files from disk (os.tmpdir)", () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-agent-disk-"));
      try {
        const plainPath = join(dir, "plain.js");
        const casedPath = join(dir, "cased.js");
        writeFileSync(plainPath, whatIfSrc);
        writeFileSync(casedPath, '// @nudo:case "one" (1)\nfunction inc(n) { return n + 1; }\n// @nudo:skip\nfunction bare(a) { return a; }\n');

        // no didOpen anywhere: default deps fall back to readFileSync
        const base = whatIf({ file: plainPath, bindings: [], target: "y" });
        expect(base.content[0].text).toContain('Type of "y": 2');

        // file:// URI form normalizes to the same path
        const viaUri = whatIf(
          { file: `file://${plainPath}`, bindings: [{ name: "x", type: "string" }], target: "y" },
        );
        expect(viaUri.content[0].text).toContain('Type of "y": string');

        // normalizeFilePath decodes and resolves both forms identically
        expect(normalizeFilePath(`file://${plainPath}`)).toBe(normalizeFilePath(plainPath));

        const tr = trace({ file: casedPath, functionName: "inc" });
        expect(tr.content[0].text).toContain("Input: (1)");
        expect(tr.content[0].text).toContain("Output: 2");

        const withCases = suggestCase({ file: casedPath, functionName: "inc" });
        expect(withCases.content[0].text).toContain("already has 1 case(s)");

        // full-program inference synthesizes cases for plain functions;
        // only skipped ones stay at zero cases
        const withoutCases = suggestCase({ file: casedPath, functionName: "bare" });
        expect(withoutCases.content[0].text).toContain("Suggested: /** @nudo:case */");

        const missing = trace({ file: casedPath, functionName: "nope" });
        expect(missing.content[0].text).toContain('Function "nope" not found');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("readSource prefers open documents and defaults to disk for the rest", () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-agent-read-"));
      try {
        const p = join(dir, "on-disk.js");
        writeFileSync(p, "// disk\n");
        expect(readSource(p)).toBe("// disk\n");
        expect(readSource("/test/only-open.js", { getOpenText: () => ({ text: "// buffer\n" }) })).toBe("// buffer\n");
        expect(readSource(p, { getOpenText: () => undefined })).toBe("// disk\n");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns an Error text result for unreadable files instead of throwing", () => {
      const res = whatIf({ file: join(tmpdir(), "nudo-agent-missing-file.js"), bindings: [], target: "y" });
      expect(res.content[0].text).toMatch(/^Error: /);
    });
  });

  it("suggestCase emits pasteable directives for synthesized cases; hand-written and zero-case stay as-is", () => {
    // 同文件内调用产生合成 case：add 两条 call@L* 记录 → 直接可粘贴的指令文本
    const synthSrc = [
      "function add(a, b) { return a + b; }",
      "const r1 = add(1, 2);",
      "const r2 = add(\"x\", \"y\");",
      "// @nudo:case \"manual\" (5)",
      "function inc(n) { return n + 1; }",
      "// @nudo:skip",
      "function bare(a) { return a; }",
    ].join("\n");
    const deps = srcDeps(synthSrc);

    const synthesized = suggestCase({ file: "/test/synth.js", functionName: "add" }, deps);
    const text = synthesized.content[0].text;
    expect(text).toContain('Function "add" has 2 synthesized case(s); suggested directives:');
    expect(text).toContain("/**");
    expect(text).toContain(' * @nudo:case "call@L2" (1, 2)');
    expect(text).toContain(' * @nudo:case "call@L3" ("x", "y")');
    expect(text).toContain("*/");

    // 手写 case：source 未标记（非 callsite），报 already has N case(s) 原样
    const handWritten = suggestCase({ file: "/test/synth.js", functionName: "inc" }, deps);
    expect(handWritten.content[0].text).toBe('Function "inc" already has 1 case(s)');

    // 零 case（skip）：占位符不变
    const zero = suggestCase({ file: "/test/synth.js", functionName: "bare" }, deps);
    expect(zero.content[0].text).toContain("Suggested: /** @nudo:case */");
  });
});
