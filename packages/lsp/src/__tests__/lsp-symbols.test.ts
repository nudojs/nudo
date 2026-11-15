/**
 * 模块套件：documentSymbol / workspaceSymbol 面（跨文件/解构/let-var/default/类成员）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { documentSymbols, findIdentifierAtPosition, resolveDefinition, resolveReferences, collectImportBindings, findExportDefinition } from "../symbols.ts";
import { withLspServer, withLspServerCapabilities, createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

// ---------------------------------------------------------------------------
// documentSymbols
// ---------------------------------------------------------------------------
describe("[lsp-] documentSymbols", () => {
/**
 * documentSymbol + 跨文件 definition / references / rename 的纯函数测试
 * （不启 live LSP connection）。
 */







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
  it("DI-param usage resolves to the local param binding (rename-safe)", () => {
    const ast = parse(scanSrc);
    const ident = findIdentifierAtPosition(ast, 2, 9);
    expect(ident).toBe("computeScorecard");
    // 形参是真实绑定：定义落在 scan.js 的 `{ computeScorecard }` 参数位
    const def = resolveDefinition(scanPath, scanSrc, ident!, { workspaceFallback: true });
    expect(def).not.toBeNull();
    expect(def!.filePath).toBe(scanPath);
    expect(def!.name).toBe("computeScorecard");
  });

  it("without fallback DI-param still resolves to local param (not workspace)", () => {
    const def = resolveDefinition(scanPath, scanSrc, "computeScorecard");
    expect(def).not.toBeNull();
    expect(def!.filePath).toBe(scanPath);
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
});

// ---------------------------------------------------------------------------
// Bug 749 — documentSymbol 按客户端能力作答（形状 + SymbolKind 取值）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 749 — documentSymbol 按客户端能力作答（形状 + SymbolKind 取值）", () => {
/**
 * Bug 749 —— `textDocument/documentSymbol` **完全无视客户端 capabilities**
 * ⇒ 客户端声明「不支持层级式」却收到 `DocumentSymbol[]`（**形状违规**），
 * 且返回的 `SymbolKind` 超出客户端声明的 `valueSet`（**取值违规**）。
 *
 * 根因：`onInitialize` 只回**自己**的能力声明、**从不保存** `params.capabilities`
 * ⇒ `onDocumentSymbol` 永远按「层级式 + 全量 SymbolKind」输出。
 *
 * 本钉钉住**输出侧**（片 B）：能力**读取侧**在 `server.ts`（片 C），
 * 见 `lsp-client-capabilities.test.ts`。
 *
 * 契约（片 C → B）：
 * · `deps.clientCapabilities?: () => ClientCapabilities | undefined`
 *   ——返回客户端在 `initialize` 里声明的 `params.capabilities` **原对象**。
 * · **缺省**（`undefined`，老客户端可能根本不发该段）⇒ **必须走默认**：
 *   **层级式 `DocumentSymbol[]` + 全量 `SymbolKind`**（**不得因拿不到能力就退化**）。
 * · `hierarchicalDocumentSymbolSupport === false` ⇒ 回 **`SymbolInformation[]`**
 *   （`location` 而非 `range` / `selectionRange` / `children`；层级关系用
 *   `containerName` 表达）。
 * · `symbolKind.valueSet` 存在 ⇒ 不在集合内的 kind **夹到集合内的安全值**
 *   （建议 `SymbolKind.Variable` = 13）并保留 `detail` 降级提示。
 */



/** 夹具：类（含方法）+ 顶层函数 + 顶层变量（kind 各不相同 ⇒ 可验夹取）。 */
const SRC = `export class Kls {
  alphaMethod() {}
}
export function gammaFn() {}
export const deltaVar = 1;
`;

/** 客户端声明：不要层级式 + 只接受 [Function(12), Variable(13)]。 */
const FLAT_CAPS = {
  textDocument: {
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: false,
      symbolKind: { valueSet: [12, 13] },
    },
  },
};

type Sym = {
  name: string;
  kind: number;
  detail?: string;
  range?: unknown;
  selectionRange?: unknown;
  children?: unknown;
  containerName?: string;
  location?: { uri: string; range: unknown };
};

const keysOf = (s: Sym): string[] => Object.keys(s).sort();

describe("Bug 749 — documentSymbol 按客户端能力作答（形状 + SymbolKind 取值）", () => {
  it("缺省（客户端没发能力段）⇒ 层级式 + 全量 SymbolKind（不得退化）", async () => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Sym[];
      expect(syms.length).toBeGreaterThan(0);
      const cls = syms.find((s) => s.name === "Kls");
      expect(cls, "缺省时没有 Kls").toBeTruthy();
      expect(keysOf(cls!)).toEqual(["children", "detail", "kind", "name", "range", "selectionRange"]);
      expect(cls!.kind, "缺省时 kind 应是 Class(5)（全量取值，不夹取）").toBe(5);
      expect((cls!.children as Sym[]).map((c) => c.name)).toEqual(["alphaMethod"]);
      expect((cls!.children as Sym[])[0].kind, "缺省时方法 kind 应是 Method(6)").toBe(6);
    });
  });

  it("hierarchicalDocumentSymbolSupport=false ⇒ 回 SymbolInformation[]（location 形态）", async () => {
    await withLspServerCapabilities({ "a.js": SRC }, FLAT_CAPS, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Sym[];
      expect(syms.length).toBeGreaterThan(0);
      for (const s of syms) {
        expect(s.location, `扁平形态缺 location：${s.name}`).toBeTruthy();
        expect(s.range, `扁平形态不应有 range：${s.name}`).toBeUndefined();
        expect(s.selectionRange, `扁平形态不应有 selectionRange：${s.name}`).toBeUndefined();
        expect(s.children, `扁平形态不应有 children：${s.name}`).toBeUndefined();
      }
      // 层级关系用 containerName 表达（类成员被摊平到同一层）
      const method = syms.find((s) => s.name === "alphaMethod");
      expect(method, "类成员没被摊平进扁平结果").toBeTruthy();
      expect(method!.containerName, "类成员应带 containerName").toBe("Kls");
    });
  });

  it("symbolKind.valueSet ⇒ 不在集合内的 kind 被夹到集合内（并留 detail 降级提示）", async () => {
    await withLspServerCapabilities({ "a.js": SRC }, FLAT_CAPS, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("a.js") },
      }) as Sym[];
      for (const s of syms) {
        expect([12, 13], `kind ${s.kind} 超出客户端 valueSet [12,13]`).toContain(s.kind);
      }
      const cls = syms.find((s) => s.name === "Kls");
      // Class(5) 不在 [12,13] ⇒ 夹到 Variable(13)（客户端声明的集合内）
      expect(cls!.kind, "Class(5) 应被夹到集合内的安全值").toBe(13);
      expect(cls!.detail, "夹取后应留 detail 降级提示").toContain("kind clamped to 13");
    });
  });

  it("valueSet 缺省 ⇒ 不夹取（全量 kind）", async () => {
    await withLspServerCapabilities(
      { "a.js": SRC },
      { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
      async ({ req, uri }) => {
        const syms = req("textDocument/documentSymbol")({
          textDocument: { uri: uri("a.js") },
        }) as Sym[];
        const cls = syms.find((s) => s.name === "Kls");
        expect(cls!.kind, "valueSet 缺省时不应夹取").toBe(5);
        expect(cls!.detail ?? "").not.toContain("kind clamped");
      },
    );
  });
});
});

// ---------------------------------------------------------------------------
// Bug 719 — documentSymbol 展开解构绑定
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 719 — documentSymbol 展开解构绑定", () => {
/**
 * Bug 719 — LSP `documentSymbol`：**解构绑定**的顶层变量整个从大纲里消失。
 *
 * 改前：变量分支对每个 declarator 取 `getDeclaratorId(d)`，而它只在
 *       `decl.id.type === "Identifier"` 时返回 id ⇒ 解构声明（ObjectPattern /
 *       ArrayPattern）整条 `continue` ⇒ 4 个绑定一个都不出。
 * 改后：遇到解构模式时**展开每个绑定**，每个绑定各出一个 Variable 项，
 *       range / selectionRange 取该绑定标识符的 range。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/documentSymbol` ⇒ 绑定名逐条。
 */









type Sym = {
  name: string;
  detail?: string;
  kind: number;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
};

async function protocolSymbols(src: string): Promise<Sym[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b719-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src, "utf-8");
  try {
    const uri = `file://${file}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: src },
    });
    await new Promise((r) => setTimeout(r, 200));
    const handler = mock.requests.get("textDocument/documentSymbol");
    expect(handler, "documentSymbol handler not registered").toBeTruthy();
    const res = handler!({ textDocument: { uri } });
    return (res ?? []) as Sym[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SRC = `const { p, q } = { p: 1, q: 2 };
const [first, second] = [1, 2];
const plain = 3;

export function f() { return plain; }
`;

describe("Bug 719 — documentSymbol 展开解构绑定", () => {
  it("纯函数面：4 个解构绑定各出一个符号", () => {
    const syms = documentSymbols(parse(SRC));
    expect(syms.map((s) => s.name)).toEqual(["p", "q", "first", "second", "plain", "f"]);
    for (const name of ["p", "q", "first", "second"]) {
      const hit = syms.find((s) => s.name === name)!;
      expect(hit.kind).toBe(13); // Variable
      // range / selectionRange 落在该绑定标识符上（不是整条声明）
      expect(hit.range.start.line).toBe(hit.selectionRange.start.line);
      expect(hit.range.start.character).toBe(hit.selectionRange.start.character);
    }
  });

  it("协议面（真 server）：解构出的 4 个绑定都能在大纲里搜到", async () => {
    const syms = await protocolSymbols(SRC);
    expect(syms.map((s) => s.name)).toEqual(["p", "q", "first", "second", "plain", "f"]);
    const names = syms.map((s) => s.name);
    expect(names).toContain("p");
    expect(names).toContain("q");
    expect(names).toContain("first");
    expect(names).toContain("second");
    // 改前：只有 plain / f 两项（count=2）
    expect(syms.length).toBe(6);
  });

  it("嵌套 / 默认值 / rest 的绑定也展开", async () => {
    const src = `const { a: { b }, c = 1, ...rest } = obj;
const [x = 2, , ...tail] = arr;
export const used = [b, c, rest, x, tail];
`;
    const syms = await protocolSymbols(src);
    const names = syms.map((s) => s.name);
    expect(names).toEqual(["b", "c", "rest", "x", "tail", "used"]);
  });

  it("负控制：普通变量绑定不受影响", async () => {
    const syms = await protocolSymbols("const plain = 3;\nlet mut = 4;\nexport { plain, mut };\n");
    expect(syms.map((s) => s.name)).toEqual(["plain", "mut"]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 704 — documentSymbol 的变量 detail 按声明种类（const / let / var）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 704 — documentSymbol 的变量 detail 按声明种类（const / let / var）", () => {
/**
 * Bug 704 — LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。
 *
 * 改前：`documentSymbols` 的变量分支写死 `detail: exported ? "export const" : "const"`，
 *       与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。
 * 改后：detail 按 `decl.kind` 输出 `const` / `let` / `var`（导出时前缀 `export `）。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/documentSymbol` ⇒ 响应里的 `detail`。
 */









type Sym = { name: string; detail?: string; kind: number };

const SRC = `let mutable = 1;
var legacy = 2;
const fixed = 3;
export let exportedMutable = 4;
export var exportedLegacy = 5;
export const exportedFixed = 6;
`;

async function protocolSymbols(src: string): Promise<Sym[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b704-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src, "utf-8");
  try {
    const uri = `file://${file}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: src },
    });
    await new Promise((r) => setTimeout(r, 200));
    const handler = mock.requests.get("textDocument/documentSymbol");
    expect(handler, "documentSymbol handler not registered").toBeTruthy();
    const res = handler!({ textDocument: { uri } });
    return (res ?? []) as Sym[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bug 704 — documentSymbol 的变量 detail 按声明种类（const / let / var）", () => {
  it("纯函数面：let / var / const / export 前缀各自正确", () => {
    const syms = documentSymbols(parse(SRC));
    const detailOf = (name: string): string | undefined =>
      syms.find((s) => s.name === name)?.detail;
    expect(detailOf("mutable")).toBe("let");
    expect(detailOf("legacy")).toBe("var");
    expect(detailOf("fixed")).toBe("const");
    expect(detailOf("exportedMutable")).toBe("export let");
    expect(detailOf("exportedLegacy")).toBe("export var");
    expect(detailOf("exportedFixed")).toBe("export const");
  });

  it("协议面（真 server）：documentSymbol 响应里的 detail 不是 const", async () => {
    const syms = await protocolSymbols(SRC);
    const detailOf = (name: string): string | undefined =>
      syms.find((s) => s.name === name)?.detail;
    expect(syms.map((s) => s.name)).toEqual([
      "mutable",
      "legacy",
      "fixed",
      "exportedMutable",
      "exportedLegacy",
      "exportedFixed",
    ]);
    expect(detailOf("mutable")).toBe("let");
    expect(detailOf("legacy")).toBe("var");
    expect(detailOf("fixed")).toBe("const");
    expect(detailOf("exportedMutable")).toBe("export let");
    expect(detailOf("exportedLegacy")).toBe("export var");
    expect(detailOf("exportedFixed")).toBe("export const");
    // 改前：6 个变量绑定的 detail 全是 "const" / "export const"
    expect(syms.filter((s) => s.detail === "const").length).toBe(1);
  });

  it("负控制：kind 仍是 Variable(13)，不被文案改动牵连", async () => {
    const syms = await protocolSymbols(SRC);
    for (const s of syms) {
      expect(s.kind).toBe(13);
    }
  });
});
});

// ---------------------------------------------------------------------------
// Bug 706 — documentSymbol 收录 export default
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 706 — documentSymbol 收录 export default", () => {
/**
 * Bug 706 — LSP `documentSymbol` 漏掉 `export default <arrow>` 与**匿名**
 * `export default function () {}`。
 *
 * 改前：顶层语句循环只处理 FunctionDeclaration / ClassDeclaration /
 *       VariableDeclaration ⇒ `export default` 的声明整条从大纲里消失；
 *       `pushFn` 对无名函数 `if (!idNode?.name) return` 直接丢弃。
 * 改后：顶层循环补 `ExportDefaultDeclaration` 分支——表达式型默认导出给一个
 *       名为 `default` 的符号；函数型默认导出**即便匿名**也要出项。
 *
 * 原生 oracle：真 LSP server 驱动 `textDocument/documentSymbol` ⇒ DocumentSymbol[]。
 */









type Sym = { name: string; detail?: string; kind: number };

async function protocolSymbols(src: string): Promise<Sym[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-b706-"));
  const file = join(dir, "a.js");
  writeFileSync(file, src, "utf-8");
  try {
    const uri = `file://${file}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: src },
    });
    await new Promise((r) => setTimeout(r, 200));
    const handler = mock.requests.get("textDocument/documentSymbol");
    expect(handler, "documentSymbol handler not registered").toBeTruthy();
    const res = handler!({ textDocument: { uri } });
    return (res ?? []) as Sym[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CASES: Array<{ label: string; src: string; name: string; kind: number }> = [
  {
    label: "export default <arrow>",
    src: "export default (x) => x;\n",
    name: "default",
    kind: 12,
  },
  {
    label: "export default 匿名 function",
    src: "export default function () {}\n",
    name: "default",
    kind: 12,
  },
  {
    label: "export default function <name>",
    src: "export default function named() {}\n",
    name: "named",
    kind: 12,
  },
  {
    label: "export default 匿名 class",
    src: "export default class {}\n",
    name: "default",
    kind: 5,
  },
  {
    label: "export default class <Name>",
    src: "export default class Named {}\n",
    name: "Named",
    kind: 5,
  },
  {
    label: "export default <字面量>",
    src: "export default 42;\n",
    name: "default",
    kind: 13,
  },
];

describe("Bug 706 — documentSymbol 收录 export default", () => {
  for (const c of CASES) {
    it(`纯函数面：${c.label} ⇒ 大纲里有 ${c.name}`, () => {
      const syms = documentSymbols(parse(c.src));
      expect(syms.map((s) => s.name)).toContain(c.name);
      const hit = syms.find((s) => s.name === c.name)!;
      expect(hit.kind).toBe(c.kind);
    });

    it(`协议面（真 server）：${c.label} ⇒ documentSymbol 响应里有 ${c.name}`, async () => {
      const syms = await protocolSymbols(c.src);
      expect(syms.length).toBeGreaterThan(0);
      expect(syms.map((s) => s.name)).toContain(c.name);
      expect(syms.find((s) => s.name === c.name)!.kind).toBe(c.kind);
    });
  }

  it("负控制：普通具名导出不受影响", async () => {
    const syms = await protocolSymbols("export const f = () => {};\nexport function g() {}\n");
    expect(syms.map((s) => s.name)).toEqual(["f", "g"]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 745 — workspace/symbol 返回类成员（递归下钻 + 扁平化）
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 745 — workspace/symbol 返回类成员（递归下钻 + 扁平化）", () => {
/**
 * Bug 745 —— `workspace/symbol` **从不返回类方法 / 类属性**（只返回类本身）。
 *
 * 根因：`onWorkspaceSymbol`（`server-navigation.ts`）只遍历 `documentSymbols(ast)`
 * 的**顶层**结果，**不下钻 `sym.children`**；而 `documentSymbols`（`symbols.ts`）
 * 恰恰把类成员放在 `children` 里 ⇒ 类方法 / 类属性**永远**不进搜索结果。
 *
 * 修法：**递归下钻并扁平化**成 `SymbolInformation[]`（层级关系用
 * `containerName` 表达）⇒ 与 LSP 的扁平协议相符。
 *
 * ⚠ **独立于本条的口径问题（本族不修）**：`workspace/symbol` 扫的是
 *   `knownFiles`（由 `validateText` 登记）+ 已打开文档 ⇒ **只有被分析过的
 *   文件**才进搜索 ⇒ 搜一个「只被 import 从未单独打开分析过」的文件的类方法
 *   仍可能搜不到（登记为族 24 残留项）。
 */



/** 夹具：类 + 类方法 + 类属性 + 顶层函数（顶层名互不含查询串 ⇒ 断言精确）。 */
const SRC = `export class Kls {
  alphaMethod() {}
  betaProp = 1;
}
export function gammaFn() {}
`;

type WsSymbol = {
  name: string;
  kind: number;
  containerName?: string;
  location: { uri: string; range: { start: { line: number; character: number } } };
};

describe("Bug 745 — workspace/symbol 返回类成员（递归下钻 + 扁平化）", () => {
  it("类方法进搜索结果（带 containerName）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req, uri }) => {
      const syms = req("workspace/symbol")({ query: "alphaMethod" }) as WsSymbol[];
      expect(syms.map((s) => s.name), "类方法没进 workspace/symbol").toEqual(["alphaMethod"]);
      expect(syms[0].kind, "类方法的 kind 应是 Method(6)").toBe(6);
      expect(syms[0].containerName, "类方法应带 containerName（所属类）").toBe("Kls");
      expect(syms[0].location.uri).toBe(uri("kls.js"));
      expect(syms[0].location.range.start).toEqual({ line: 1, character: 2 });
    });
  });

  it("类属性进搜索结果（带 containerName）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req }) => {
      const syms = req("workspace/symbol")({ query: "betaProp" }) as WsSymbol[];
      expect(syms.map((s) => s.name), "类属性没进 workspace/symbol").toEqual(["betaProp"]);
      expect(syms[0].kind, "类属性的 kind 应是 Property(7)").toBe(7);
      expect(syms[0].containerName).toBe("Kls");
    });
  });

  it("顶层符号仍在（不得因下钻而丢顶层）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req }) => {
      const cls = req("workspace/symbol")({ query: "Kls" }) as WsSymbol[];
      expect(cls.map((s) => s.name)).toEqual(["Kls"]);
      expect(cls[0].kind, "类的 kind 应是 Class(5)").toBe(5);
      expect(cls[0].containerName, "顶层符号不应有 containerName").toBeUndefined();

      const fn = req("workspace/symbol")({ query: "gammaFn" }) as WsSymbol[];
      expect(fn.map((s) => s.name)).toEqual(["gammaFn"]);
      expect(fn[0].kind, "函数的 kind 应是 Function(12)").toBe(12);
    });
  });

  it("对照：同一份 AST 的 documentSymbol 层级式结果含 children（证明同一 AST 两种结果）", async () => {
    await withLspServer({ "kls.js": SRC }, async ({ req, uri }) => {
      const syms = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("kls.js") },
      }) as Array<{ name: string; children?: Array<{ name: string; kind: number }> }>;
      const cls = syms.find((s) => s.name === "Kls");
      expect(cls, "documentSymbol 里没有 Kls").toBeTruthy();
      expect((cls!.children ?? []).map((c) => c.name)).toEqual(["alphaMethod", "betaProp"]);
    });
  });
});
});
