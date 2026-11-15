/**
 * Bug 416 —— `@nudo:import` 写在**块注释**里也是**生效的**文件级 import
 * （而 `@nudo:env` / `@nudo:mock-module` 在块注释里被忽略并告警）。
 *
 * 根因（core 文本扫描通道）：`directiveCommentLinesRaw` 把行注释与块注释
 * **拍平成同一个列表**且丢掉 `kind` ⇒ `nudoImportPayloads` 分不出两种注释
 * ⇒ 块注释里的 import **真的生效**（真的去装载那个侧车）。
 *
 * 本钉锁：两种注释形态**必须分档** —— 行注释生效 / 块注释忽略
 * （口径与 parser AST 通道一致：块注释形态被忽略并告警）。
 */
import { describe, it, expect } from "vitest";
import {
  extractNudoImportRecords,
  scanMalformedNudoImports,
} from "../directive-scan.ts";

const BLOCK = `/* @nudo:import { positive } from "./c.nudo.js" */\nexport function inc(x) { return x + 1; }\n`;
const JSDOC = `/** @nudo:import { positive } from "./c.nudo.js" */\nexport function inc(x) { return x + 1; }\n`;
const LINE = `/// @nudo:import { positive } from "./c.nudo.js"\nexport function inc(x) { return x + 1; }\n`;
const LINE2 = `// @nudo:import { positive } from "./c.nudo.js"\nexport function inc(x) { return x + 1; }\n`;

describe("Bug 416: block-comment @nudo:import is not a file-level import", () => {
  it("block comment form yields no import record (was effective)", () => {
    expect(extractNudoImportRecords(BLOCK)).toEqual([]);
  });

  it("JSDoc block form yields no import record (was effective)", () => {
    expect(extractNudoImportRecords(JSDOC)).toEqual([]);
  });

  it("line comment forms still work (control)", () => {
    expect(extractNudoImportRecords(LINE)).toHaveLength(1);
    expect(extractNudoImportRecords(LINE2)).toHaveLength(1);
  });

  it("a block comment does not shadow the line comment beside it", () => {
    expect(
      extractNudoImportRecords(
        `/* @nudo:import { positive } from "./c.nudo.js" */\n/// @nudo:import { negative } from "./d.nudo.js"\n`,
      ).map((r) => r.names[0]),
    ).toEqual(["negative"]);
  });

  it("block comment form is not reported as a malformed import either", () => {
    expect(scanMalformedNudoImports(BLOCK)).toEqual([]);
  });
});
