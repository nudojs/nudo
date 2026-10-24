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
import { describe, it, expect } from "vitest";
import { buildSemanticTokens, SEMANTIC_TOKEN_TYPES } from "../semantic-tokens.ts";

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
