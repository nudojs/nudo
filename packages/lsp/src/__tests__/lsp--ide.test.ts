/**
 * 缺陷报告分册 10（LSP / IDE 观察面）回归钉：Bug 33 / 36 / 68 / 83 / 92 / 93 / 102。
 *
 * 全部走**真 LSP server + mock connection + 真实 `textDocument/*` 协议请求**
 * （helpers.ts 的 withLspServer）——与 tmp/bugs/10-lsp-ide.md 的复现命令同款，
 * 断言的是协议响应本身，不是内部函数的推断。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";
import { decodeSemanticTokens } from "./lsp-bug-d4-harness.ts";
import { SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS } from "../semantic-tokens.ts";

type Resp = any;
const hoverSig = (r: Resp): string | undefined =>
  /```nudo\n([\s\S]*?)\n```/.exec(r?.contents?.value ?? "")?.[1];

// ---------------------------------------------------------------------------
// Bug 33 · hover / 成员补全按名字查模块级绑定表，不看词法作用域
// ---------------------------------------------------------------------------
const B33_SRC = [
  "export const v = { a: 1 };",
  "export function f() {",
  '  const v = "str";',
  "  return v;",
  "}",
  'export const user = { name: "ann" };',
  "export function greet(user) {",
  "  return user;",
  "}",
].join("\n");

describe("Bug 33 — hover / 成员补全按词法作用域解析，不借用被遮蔽的外部绑定", () => {
  it("hover：局部 v 给局部真值、形参 user 给 any；模块级同名绑定不变", async () => {
    await withLspServer({ "a.js": B33_SRC }, async ({ req, uri }) => {
      const hover = req("textDocument/hover");
      const at = (line: number, character: number) =>
        hover({ textDocument: { uri: uri("a.js") }, position: { line, character } });
      // 函数内局部 const v = "str"：不再显示模块级 { a: 1 }
      const localV = at(3, 9)?.contents?.value ?? "";
      expect(localV).toContain('"str"');
      expect(localV).not.toContain("{ a: 1 }");
      // 形参 user：引擎的形参诚实面
      expect(at(7, 9)?.contents?.value).toContain("user: any");
      // 模块级同名绑定不受影响
      expect(at(0, 13)?.contents?.value).toContain("{ a: 1 }");
      expect(at(5, 13)?.contents?.value).toContain('{ name: "ann" }');
    });
  });

  it("回调形参 cfg（裸箭头）的 cfg. 补全零候选：不借用模块级 cfg 的成员 top", async () => {
    const SRC = [
      "export const cfg = { top: 1 };",
      "export function run(items) {",
      "  return items.map((cfg) => cfg.top);",
      "}",
    ].join("\n");
    await withLspServer({ "b.js": SRC }, async ({ req, uri }) => {
      const line = 2;
      const text = SRC.split("\n")[line]!;
      const character = text.indexOf("cfg.top") + "cfg.".length;
      const items = req("textDocument/completion")({
        textDocument: { uri: uri("b.js") },
        position: { line, character },
      }) as { label: string }[];
      expect(items.map((i) => i.label)).not.toContain("top");
      expect(items).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Bug 36 · 解构形参标 parameter、解构赋值目标不带 declaration
// ---------------------------------------------------------------------------
describe("Bug 36 — 解构形参 = parameter；解构赋值目标不带 declaration", () => {
  it("semanticTokens/full：解构形参与 x 同档，赋值目标 a 无 declaration", async () => {
    const SRC = [
      "export function f(x, { a, b }, [c]) { return x + a + b + c; }",
      "let o = { a: 1 };",
      "({ a } = o);",
    ].join("\n");
    await withLspServer({ "b.js": SRC }, async ({ req, uri }) => {
      const res = req("textDocument/semanticTokens/full")({
        textDocument: { uri: uri("b.js") },
      }) as { data: number[] };
      const toks = decodeSemanticTokens(res.data);
      const find = (line: number, char: number) =>
        toks.find((t) => t.line === line && t.char === char);
      const typeAt = (line: number, char: number) => {
        const t = find(line, char);
        return t ? SEMANTIC_TOKEN_TYPES[t.typeIndex] : undefined;
      };
      const modsAt = (line: number, char: number): string[] => {
        const t = find(line, char);
        return t
          ? SEMANTIC_TOKEN_MODIFIERS.filter((_, i) => t.modifiers & (1 << i))
          : [];
      };
      // 普通形参与解构形参同档（parameter）
      expect(typeAt(0, 18)).toBe("parameter"); // x
      expect(typeAt(0, 23)).toBe("parameter"); // { a }
      expect(typeAt(0, 26)).toBe("parameter"); // { b }
      expect(typeAt(0, 32)).toBe("parameter"); // [c]
      // 对象字面量键仍是 property
      expect(typeAt(1, 10)).toBe("property");
      // 解构赋值目标：variable 且不带 declaration
      expect(typeAt(2, 3)).toBe("variable");
      expect(modsAt(2, 3)).not.toContain("declaration");
    });
  });
});

// ---------------------------------------------------------------------------
// Bug 68 · 指令补全表补齐 4 条 live 指令
// ---------------------------------------------------------------------------
describe("Bug 68 — 指令补全表包含 assume / invariant / throws / budget", () => {
  const cases: Array<[string, string[]]> = [
    ["@nudo:t", ["@nudo:throws"]],
    ["@nudo:b", ["@nudo:budget"]],
    ["@nudo:ass", ["@nudo:assume"]],
    ["@nudo:inv", ["@nudo:invariant"]],
    ["@nudo:c", ["@nudo:contract", "@nudo:case"]],
    ["@nudo:s", ["@nudo:skip", "@nudo:sample"]],
  ];
  for (const [prefix, expected] of cases) {
    it(`前缀 ${prefix} → ${expected.join(", ")}`, async () => {
      const SRC = `// ${prefix}\nexport function f(x) { return x + 1; }\n`;
      await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
        const items = req("textDocument/completion")({
          textDocument: { uri: uri("a.js") },
          position: { line: 0, character: `// ${prefix}`.length },
        }) as { label: string }[];
        expect(items.map((i) => i.label)).toEqual(expected);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Bug 83 · 补全 detail 与 hover / check 签名同形（不塌 any）
// ---------------------------------------------------------------------------
describe("Bug 83 — 补全 detail ≡ 同函数 hover 签名（含契约形参 / 返回）", () => {
  const FILES: Record<string, string> = {
    "std.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    "a.js": `/// @nudo:import { positive } from "./std.nudo.js"
/**
 * @nudo:contract x positive
 */
export function f(x) { return x * 2; }
export function lit() { return 42; }
export function ident(x) { return x; }
`,
  };
  it("f / lit / ident 的补全 detail 逐字等于 hover 签名", async () => {
    await withLspServer(FILES, async ({ req, uri }) => {
      const hover = req("textDocument/hover");
      const comp = req("textDocument/completion")({
        textDocument: { uri: uri("a.js") },
        position: { line: 8, character: 0 },
      }) as { label: string; detail?: string }[];
      const detailOf = (name: string) => comp.find((i) => i.label === name)?.detail;
      const positions: Array<[string, number, number]> = [
        ["f", 4, 16],
        ["lit", 5, 16],
        ["ident", 6, 16],
      ];
      for (const [name, line, character] of positions) {
        const sig = hoverSig(
          hover({ textDocument: { uri: uri("a.js") }, position: { line, character } }),
        );
        expect(sig).toBeDefined();
        expect(detailOf(name)).toBe(sig);
      }
      // 精确值（防「两面一起塌 any」的伪通过）
      expect(detailOf("f")).toBe("f(x: number) => number");
      expect(detailOf("lit")).toBe("lit() => 42");
      expect(detailOf("ident")).toBe("ident(x: any) => any");
    });
  });
});

// ---------------------------------------------------------------------------
// Bug 92 · signatureHelp 形参渲染带 showLits
// ---------------------------------------------------------------------------
describe("Bug 92 — signatureHelp 的 lit(1) 形参印 x: 1（与 hover / check 同口径）", () => {
  const FILES: Record<string, string> = {
    "f.js": `export function f(x) { return x; }\nf(1);\n`,
    "f.nudo.js": `import { fn, lit, number } from "@nudojs/core";\nexport const f = fn({ x: lit(1) }, number());\n`,
  };
  it("signatureHelp label / parameter 与 hover 同为 x: 1", async () => {
    await withLspServer(FILES, async ({ req, uri }) => {
      const sig = req("textDocument/signatureHelp")({
        textDocument: { uri: uri("f.js") },
        position: { line: 1, character: 2 },
      }) as Resp;
      const hov = req("textDocument/hover")({
        textDocument: { uri: uri("f.js") },
        position: { line: 0, character: 17 },
      });
      expect(sig?.signatures?.[0]?.label).toBe("(x: 1) => number");
      expect(sig?.signatures?.[0]?.parameters?.[0]?.label).toBe("x: 1");
      expect(hoverSig(hov)).toContain("f(x: 1)");
    });
  });
});

// ---------------------------------------------------------------------------
// Bug 93 · documentSymbol / workspace/symbol 解说明符 export
// ---------------------------------------------------------------------------
describe("Bug 93 — export { localFn as publicName } 的导出标注与公开名", () => {
  const SRC = `function localFn(x) { return x; }\nexport { localFn as publicName };\nfunction localOnly(x) { return x; }\n`;
  const assertSymbols = (ds: Resp, ws: Resp): void => {
    const names = (ds as { name: string }[]).map((s) => s.name);
    expect(names).toContain("localFn");
    expect(names).toContain("publicName");
    expect(names).toContain("localOnly");
    const localFn = ds.find((s: Resp) => s.name === "localFn");
    const localOnly = ds.find((s: Resp) => s.name === "localOnly");
    expect(localFn.detail).toContain("export");
    expect(localOnly.detail).not.toContain("export");
    // workspace/symbol 是扁平协议 ⇒ 公开名按名可搜
    expect((ws as { name: string }[]).map((s) => s.name)).toContain("publicName");
  };
  it("documentSymbol 与 workspace/symbol 都认别名导出", async () => {
    await withLspServer({ "s.js": SRC }, async ({ req, uri }) => {
      const ds = req("textDocument/documentSymbol")({
        textDocument: { uri: uri("s.js") },
      }) as Resp;
      const ws = req("workspace/symbol")({ query: "" }) as Resp;
      assertSymbols(ds, ws);
    });
  });
});

// ---------------------------------------------------------------------------
// Bug 102 · rename / references 区分同名 static / 实例方法
// ---------------------------------------------------------------------------
describe("Bug 102 — rename / references 以 static / 实例身份为界", () => {
  const instanceFirst = `export class A {\n  m() { return 1; }\n  static m() { return 2; }\n}\nexport function f() {\n  return [new A().m(), A.m()];\n}\n`;
  const staticFirst = `export class A {\n  static m() { return 2; }\n  m() { return 1; }\n}\nexport function f() {\n  return [new A().m(), A.m()];\n}\n`;

  const runCase = async (
    SRC: string,
    label: string,
    cases: Array<{
      kind: "instance" | "static";
      line: number;
      character: number;
      edits: string[];
      defLine: number;
    }>,
  ): Promise<void> => {
    await withLspServer({ "a.js": SRC }, async ({ req, uri }) => {
      for (const c of cases) {
        const position = { line: c.line, character: c.character };
        const prep = req("textDocument/prepareRename")({
          textDocument: { uri: uri("a.js") },
          position,
        }) as Resp;
        const refs = req("textDocument/references")({
          textDocument: { uri: uri("a.js") },
          position,
          context: { includeDeclaration: true },
        }) as Resp[];
        const edit = req("textDocument/rename")({
          textDocument: { uri: uri("a.js") },
          position,
          newName: "run",
        }) as Resp;
        expect(prep?.placeholder, `${label}/${c.kind} placeholder`).toBe("m");
        expect(prep?.range?.start?.line, `${label}/${c.kind} prep line`).toBe(c.line);
        // references 只含光标所指身份的定义位（对方的定义位不得出现）
        const refLines = refs.map((r) => r.range.start.line);
        expect(refLines, `${label}/${c.kind} refs`).toContain(c.defLine);
        // rename 编辑集精确到列
        const edits = Object.values(edit?.changes ?? {}).flat() as Resp[];
        const coords = edits
          .map((e) => `${e.range.start.line}:${e.range.start.character}`)
          .sort();
        expect(coords, `${label}/${c.kind} rename`).toEqual([...c.edits].sort());
      }
    });
  };

  it("instance first：实例光标只改实例定义 + new A().m()，static 光标反之", () =>
    runCase(instanceFirst, "instance first", [
      { kind: "instance", line: 1, character: 2, edits: ["1:2", "5:18"], defLine: 1 },
      { kind: "static", line: 2, character: 9, edits: ["2:9", "5:25"], defLine: 2 },
    ]));

  it("static first：对称（定义顺序不影响身份判定）", () =>
    runCase(staticFirst, "static first", [
      { kind: "instance", line: 2, character: 2, edits: ["2:2", "5:18"], defLine: 2 },
      { kind: "static", line: 1, character: 9, edits: ["1:9", "5:25"], defLine: 1 },
    ]));
});
