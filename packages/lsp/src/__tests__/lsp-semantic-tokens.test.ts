/**
 * 模块套件：semanticTokens 面（层级 / 字符串掩码 / 简写 / 类解构 / 转义长度）。
 */
import { describe, expect, it } from "vitest";
import { openLspDocument, requestSemanticTokens, decodeSemanticTokens } from "./lsp-bug-d4-harness.ts";
import { SEMANTIC_TOKEN_TYPES, buildSemanticTokens, SEMANTIC_TOKEN_MODIFIERS, contractTierModifierBit } from "../semantic-tokens.ts";

// ---------------------------------------------------------------------------
// Bug 701 — 类 / 解构 / 方法形参的语义 token
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 701 — 类 / 解构 / 方法形参的语义 token", () => {
/**
 * Bug 701：语义 token 面漏标——类名 / 类方法 / 类字段 / 方法形参 / 解构绑定。
 *
 * 症状（真 server semanticTokens/full）：
 * - `export class K { m(p) {…} }` 只有 `p` 上色，`K` / `m` 全丢；
 * - `export const [x, y] = arr;` 完全没有 token；
 * - `export const { a, b } = obj;` 的 `a` / `b` 被标成 property（见 721）。
 *
 * 期望：
 * - 类名 → class 档；类方法键 → method；类字段键 → property；方法形参 → parameter；
 * - 数组解构元素 → variable；对象解构绑定 → variable。
 */




const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");
const TYPE_PARAMETER = SEMANTIC_TOKEN_TYPES.indexOf("parameter");
const TYPE_PROPERTY = SEMANTIC_TOKEN_TYPES.indexOf("property");
const TYPE_METHOD = SEMANTIC_TOKEN_TYPES.indexOf("method");
const TYPE_CLASS = SEMANTIC_TOKEN_TYPES.indexOf("class");

const SRC = [
  "export const { a, b } = obj;", // 0: a@15 b@18
  "export const [x, y] = arr;", // 1: x@14 y@17
  "export class K {", // 2: K@13
  "  m(p) { return p; }", // 3: m@2 p@4
  "  f = 1;", // 4: f@2
  "}",
  "",
].join("\n");

describe("Bug 701 — 类 / 解构 / 方法形参的语义 token", () => {
  it("真 server 返回完整 token 列表（位置 + 档位）", async () => {
    const { mock, uri } = await openLspDocument(SRC, "file:///tmp/nudo-bug-701/a.js");
    const tokens = requestSemanticTokens(mock, uri);
    expect(tokens).toEqual([
      { line: 0, char: 15, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 0, char: 18, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 1, char: 14, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 1, char: 17, length: 1, typeIndex: TYPE_VARIABLE, modifiers: 1 },
      { line: 2, char: 13, length: 1, typeIndex: TYPE_CLASS, modifiers: 1 },
      { line: 3, char: 2, length: 1, typeIndex: TYPE_METHOD, modifiers: 1 },
      { line: 3, char: 4, length: 1, typeIndex: TYPE_PARAMETER, modifiers: 1 },
      { line: 4, char: 2, length: 1, typeIndex: TYPE_PROPERTY, modifiers: 1 },
    ]);
  });

  it("图例里有 class 档（只追加不重排 ⇒ 老索引不变）", () => {
    expect(SEMANTIC_TOKEN_TYPES[0]).toBe("function");
    expect(SEMANTIC_TOKEN_TYPES[1]).toBe("variable");
    expect(SEMANTIC_TOKEN_TYPES[10]).toBe("method");
    expect(SEMANTIC_TOKEN_TYPES[11]).toBe("class");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 723 — 转义标识符的 token 长度按源码跨度
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 723 — 转义标识符的 token 长度按源码跨度", () => {
/**
 * Bug 723：标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。
 *
 * 症状：`const \u0061bc = 1;` 里 `Identifier.name` 是解码后的 `abc`（3），
 * 但源码写法 `\u0061bc` 是 **8** 个字符 ⇒ token 只盖住转义序列前半截，
 * 客户端高亮错位。
 *
 * 期望：token 长度 = **源码跨度**（`loc.end.column - loc.start.column`），
 * char = 源码起始列，两者同为 UTF-16 code unit。
 */




const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");

describe("Bug 723 — 转义标识符的 token 长度按源码跨度", () => {
  it("`\\u0061bc` 的 token 覆盖整个源码写法（8 个 UTF-16 code unit）", () => {
    const tokens = decodeSemanticTokens(
      buildSemanticTokens("/tmp/nudo-bug-723.js", "export const \\u0061bc = 1;\n"),
    );
    expect(tokens).toEqual([
      { line: 0, char: 13, length: 8, typeIndex: TYPE_VARIABLE, modifiers: 1 },
    ]);
  });

  it("普通标识符长度不变（名字 == 源码写法）", () => {
    const tokens = decodeSemanticTokens(
      buildSemanticTokens("/tmp/nudo-bug-723.js", "export const abc = 1;\n"),
    );
    expect(tokens).toEqual([
      { line: 0, char: 13, length: 3, typeIndex: TYPE_VARIABLE, modifiers: 1 },
    ]);
  });

  it("非 BMP 字符之后的位置按 UTF-16 code unit 记（emoji 占 2）", () => {
    // `export const o = { "😀": 1, x: 2 };` —— emoji 之前的列按 UTF-16 计
    const src = 'export const o = { "\u{1F600}": 1, x: 2 };\n';
    const tokens = decodeSemanticTokens(buildSemanticTokens("/tmp/nudo-bug-723.js", src));
    const x = tokens.find((t) => src.split("\n")[t.line]!.slice(t.char, t.char + 1) === "x");
    expect(x).toBeDefined();
    expect(x!.char).toBe(src.indexOf("x: 2"));
  });
});
});

// ---------------------------------------------------------------------------
// Bug 1091 —— 降级路径不得在字符串字面量内部产出 token
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 1091 —— 降级路径不得在字符串字面量内部产出 token", () => {
/**
 * Bug 1091 —— LSP 语义 token 的**降级路径**（parse 失败 ⇒ 词法扫描）里，字符串
 * **遮罩判据反了** ⇒ 字符串字面量**内部**产生假 token。
 *
 * 根因（`semantic-tokens.ts` 的本地 `maskCommentsAndStrings`）：
 * `isValuePos = prevSignificant === "" || !/[A-Za-z0-9_$)\]]/.test(prevSignificant)`
 * ⇒ **前一个有效字符是标识符字符时反而不遮罩**。而 `return` / `typeof` /
 * `case` / `await` 等关键字末字符都是字母 ⇒ 紧跟其后的字符串**整段不被遮罩**
 * ⇒ 内容被当作代码扫描（`return "const fake";` ⇒ 字符串里的 `fake` 被当成变量
 * 声明上色，坐标也指到字符串内部——VS Code 会照此渲染）。
 *
 * 触发面：仅在 **parse 失败**（IDE 里编辑到语法非法的 buffer）时走这条降级
 * 路径 ⇒ 高频路径。
 *
 * 修法：**不再在 LSP 侧维护第二份弱化实现** —— 直接复用 core 的
 * `maskCommentsAndStrings`（`@nudojs/core/internal`，基于**真 lexer**：
 * 模板插值按代码岛处理、正则字面量整段遮罩），与同包的
 * `lsp-surface/completions.ts` 同源同款。
 *
 * 钉：parse 失败的 buffer 上，字符串字面量**内部**不产生任何 token；同一
 * buffer 里字符串**外面**的标识符照常上色（不回归）。
 */



type Decoded = { line: number; char: number; length: number; typeIndex: number };

function decode(data: number[]): Decoded[] {
  const out: Decoded[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const [deltaLine, deltaChar, length, typeIndex] = data.slice(i, i + 5);
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    out.push({ line, char, length, typeIndex });
  }
  return out;
}

const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");

/**
 * 语法非法（`function broken( {` 缺右括号）⇒ 走**降级路径**（词法扫描）。
 * 第 2 行（0 基）的字符串字面量 `"const fake"` 占 char 9..19，
 * 其中 `fake` 在 char 16..19。
 */
const BROKEN = `function broken( {
  const a = 1;
  return "const fake";
}
`;

/** 同一 buffer，但字符串换成裸标识符 ⇒ 降级路径**应当**给 `a` 上色。 */
const BROKEN_IDENTIFIER = `function broken( {
  const a = 1;
  return fake;
}
`;

/** 字符串字面量的内部区间（第 2 行，0 基）：char 10..19（不含两侧引号）。 */
const STRING_LINE = 2;
const STRING_INNER_START = 10;
const STRING_INNER_END = 20;

describe("Bug 1091 —— 降级路径不得在字符串字面量内部产出 token", () => {
  it("parse 失败的 buffer：字符串内部的文本不产生 token", () => {
    const tokens = decode(buildSemanticTokens("/t/broken.js", BROKEN));
    const inside = tokens.filter(
      (t) => t.line === STRING_LINE && t.char < STRING_INNER_END && t.char + t.length > STRING_INNER_START,
    );
    expect(inside, JSON.stringify(tokens)).toEqual([]);
    // 具体到复现坐标：`fake`（char 16，len 4）不得被当成变量声明
    expect(
      tokens.some((t) => t.line === 2 && t.char === 16 && t.length === 4 && t.typeIndex === TYPE_VARIABLE),
      JSON.stringify(tokens),
    ).toBe(false);
  });

  it("对照：字符串外面的声明位照常上色（遮罩没有把整行吃掉）", () => {
    const tokens = decode(buildSemanticTokens("/t/broken.js", BROKEN_IDENTIFIER));
    // `function broken` 的函数名
    expect(tokens.some((t) => t.line === 0 && t.char === 9 && t.length === 6), JSON.stringify(tokens)).toBe(true);
    // `const a` 的变量名
    const a = tokens.find((t) => t.line === 1 && t.char === 8 && t.length === 1);
    expect(a, JSON.stringify(tokens)).toBeDefined();
    expect(a!.typeIndex).toBe(TYPE_VARIABLE);
  });

  it("对照：关键字后的字符串同样不被扫成代码（`typeof` 口径）", () => {
    const src = `function broken( {
  const a = 1;
  return typeof "const fake";
}
`;
    const tokens = decode(buildSemanticTokens("/t/broken2.js", src));
    // `  return typeof "const fake";` ⇒ 字符串内容在 char 17..26
    const inside = tokens.filter(
      (t) => t.line === STRING_LINE && t.char < 27 && t.char + t.length > 17,
    );
    expect(inside, JSON.stringify(tokens)).toEqual([]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 721 — 解构绑定 / 简写引用的语义 token
// ---------------------------------------------------------------------------
describe("[lsp-] Bug 721 — 解构绑定 / 简写引用的语义 token", () => {
/**
 * Bug 721：解构绑定被上成 property；对象字面量简写 `{ x }` 被当属性定义。
 *
 * 症状（真 server semanticTokens/full）：
 * - `export const { a, b } = obj;` 的 `a` / `b` → property 档（应是 variable 绑定）；
 * - `export const obj = { x, y: 2 };` 的 `x`（简写引用）→ property 档 **且带
 *   declaration modifier**（它是对变量的引用，不是属性定义）。
 *
 * 期望：
 * - 对象解构的**绑定名** → variable（declaration）；
 * - 对象字面量简写 `{ x }` → variable，**不带** declaration modifier；
 * - 真正的属性定义 `y: 2` → property（declaration 不变）。
 */




const TYPE_VARIABLE = SEMANTIC_TOKEN_TYPES.indexOf("variable");
const TYPE_PROPERTY = SEMANTIC_TOKEN_TYPES.indexOf("property");
const MOD_DECLARATION = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("declaration");

describe("Bug 721 — 解构绑定 / 简写引用的语义 token", () => {
  it("对象解构绑定 → variable（declaration）", async () => {
    const src = "export const { a, b } = obj;\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-721/a.js");
    const tokens = requestSemanticTokens(mock, uri);
    expect(tokens).toEqual([
      { line: 0, char: 15, length: 1, typeIndex: TYPE_VARIABLE, modifiers: MOD_DECLARATION },
      { line: 0, char: 18, length: 1, typeIndex: TYPE_VARIABLE, modifiers: MOD_DECLARATION },
    ]);
  });

  it("对象字面量简写 `{ x }` → variable 且不带 declaration modifier", async () => {
    const src = "const x = 1;\nexport const obj = { x, y: 2 };\n";
    const { mock, uri } = await openLspDocument(src, "file:///tmp/nudo-bug-721/b.js");
    const tokens = requestSemanticTokens(mock, uri);
    const shorthand = tokens.find((t) => t.line === 1 && t.char === 21);
    expect(shorthand).toBeDefined();
    expect(shorthand!.typeIndex).toBe(TYPE_VARIABLE);
    expect(shorthand!.modifiers & MOD_DECLARATION).toBe(0);
    // 真正的属性定义仍是 property + declaration
    const prop = tokens.find((t) => t.line === 1 && t.char === 24);
    expect(prop).toBeDefined();
    expect(prop!.typeIndex).toBe(TYPE_PROPERTY);
    expect(prop!.modifiers & MOD_DECLARATION).toBe(MOD_DECLARATION);
  });
});
});

// ---------------------------------------------------------------------------
// buildSemanticTokens × contract 档 (A7)
// ---------------------------------------------------------------------------
describe("[lsp-] buildSemanticTokens × contract 档 (A7)", () => {
/**
 * A7：semantic tokens 对齐 contract 档
 * - export 函数绑定带 contract / generated / derived modifier
 * - 非导出只带 declaration（不假装进档）
 * - 与 CodeLens / hover 共用 contractTierOf（同源）
 */



const MOD_DECLARATION = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("declaration");
const MOD_CONTRACT = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("contract");
const MOD_GENERATED = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("generated");
const MOD_DERIVED = 1 << SEMANTIC_TOKEN_MODIFIERS.indexOf("derived");

const TYPE_FUNCTION = SEMANTIC_TOKEN_TYPES.indexOf("function");

type Decoded = { line: number; char: number; length: number; typeIndex: number; modifiers: number };

function decode(data: number[]): Decoded[] {
  const out: Decoded[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < data.length; i += 5) {
    const [deltaLine, deltaChar, length, typeIndex, modifiers] = data.slice(i, i + 5);
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    out.push({ line, char, length, typeIndex, modifiers: modifiers! });
  }
  return out;
}

const HANDWRITTEN = `
import { fn, number } from "@nudojs/core";

export const add = fn({ x: number().gt(0) }, number().gt(2));
`;
const GENERATED = `
import { fn, number } from "@nudojs/core";

// @generated by nudo — do not edit; regenerate with \`nudo contract --emit\`
export const add = fn({ x: number() });
`;

const loader = (sidecar: string) => (spec: string) =>
  spec.endsWith("lib.nudo.js") ? sidecar : undefined;

describe("buildSemanticTokens × contract 档 (A7)", () => {
  it("handwritten export function declaration gets contract modifier", () => {
    const src = `export function add(x) {\n  return x + 2;\n}\n`;
    const data = buildSemanticTokens("/t/lib.js", src, { loadModule: loader(HANDWRITTEN) });
    const fnTok = decode(data).find(
      (t) => t.line === 0 && t.typeIndex === TYPE_FUNCTION && t.length === 3,
    );
    expect(fnTok).toBeDefined();
    expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_CONTRACT);
  });

  it("generated export gets generated modifier", () => {
    const src = `export function add(x) {\n  return x + 2;\n}\n`;
    const data = buildSemanticTokens("/t/lib.js", src, { loadModule: loader(GENERATED) });
    const fnTok = decode(data).find((t) => t.typeIndex === TYPE_FUNCTION && t.length === 3);
    expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_GENERATED);
  });

  it("implicit export gets derived modifier", () => {
    const src = `export function double(x) {\n  return x * 2;\n}\n`;
    const data = buildSemanticTokens("/t/calls.js", src);
    const fnTok = decode(data).find((t) => t.typeIndex === TYPE_FUNCTION && t.length === 6);
    expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_DERIVED);
  });

  it("non-export function keeps declaration-only modifier", () => {
    const src = `function helper(n) {\n  return n;\n}\n`;
    const data = buildSemanticTokens("/t/priv.js", src);
    const fnTok = decode(data).find((t) => t.typeIndex === TYPE_FUNCTION);
    expect(fnTok!.modifiers).toBe(MOD_DECLARATION);
  });

  it("nested same-name FunctionDeclaration does not inherit export contract tier", () => {
    const src = `export function add(x) {
  function add(n) {
    return n + 1;
  }
  return add(x) + 2;
}
`;
    const data = buildSemanticTokens("/t/lib.js", src, { loadModule: loader(HANDWRITTEN) });
    const fnToks = decode(data).filter((t) => t.typeIndex === TYPE_FUNCTION && t.length === 3);
    expect(fnToks.length).toBe(2);
    const top = fnToks.find((t) => t.line === 0)!;
    const nested = fnToks.find((t) => t.line === 1)!;
    expect(top.modifiers).toBe(MOD_DECLARATION | MOD_CONTRACT);
    expect(nested.modifiers).toBe(MOD_DECLARATION);
  });

  it("autoBind:false → derived even with handwritten sidecar", () => {
    const src = `export function add(x) {\n  return x + 2;\n}\n`;
    const data = buildSemanticTokens("/t/lib.js", src, {
      loadModule: loader(HANDWRITTEN),
      autoBind: false,
    });
    const fnTok = decode(data).find((t) => t.typeIndex === TYPE_FUNCTION && t.length === 3);
    expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_DERIVED);
  });

  it("contractTierModifierBit maps three tiers", () => {
    expect(contractTierModifierBit("handwritten")).toBe(MOD_CONTRACT);
    expect(contractTierModifierBit("generated")).toBe(MOD_GENERATED);
    expect(contractTierModifierBit("implicit")).toBe(MOD_DERIVED);
  });

  it("legend appends contract/generated/derived without reordering prior modifiers", () => {
    expect(SEMANTIC_TOKEN_MODIFIERS.slice(0, 4)).toEqual([
      "declaration",
      "readonly",
      "deprecated",
      "unreachable",
    ]);
    expect(SEMANTIC_TOKEN_MODIFIERS.slice(4)).toEqual(["contract", "generated", "derived"]);
  });
});
});
