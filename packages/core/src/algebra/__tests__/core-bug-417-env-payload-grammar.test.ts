/**
 * Bug 417 —— `@nudo:env` 的载荷文法**静默丢掉整条列表**：空格分隔
 * （`node web`）与裸标签（`/// @nudo:env`）都不生效、零诊断。
 *
 * 根因（core 载荷文法）：`parseEnvPayload` **只按 `,` 切分** ⇒ 空格分隔
 * 列表（`node web`）被切成**一个** token 后整条滤掉；裸标签
 * `/// @nudo:env` 因正则要求 `\s+(.+)` 而**根本不匹配** ⇒ 两种形态都
 * **零诊断**地丢弃 ⇒ env 未解析 ⇒ 全局 `unknown` ⇒ `conf=opaque`。
 *
 * 本钉锁：逗号**与**空白两种分隔符都认；裸标签不产出 env 名（诊断由
 * parser AST 通道落，见 parser 侧同族钉）。
 */
import { describe, it, expect } from "vitest";
import { extractFileEnvNames, parseEnvPayload } from "../directive-scan.ts";

describe("Bug 417: @nudo:env payload grammar", () => {
  it("space-separated env list is recognized (was dropped as one token)", () => {
    expect(parseEnvPayload("node web")).toEqual(["node", "web"]);
    expect(extractFileEnvNames(`/// @nudo:env node web\n`)).toEqual(["node", "web"]);
  });

  it("comma-separated env list still works (control)", () => {
    expect(parseEnvPayload("node, web")).toEqual(["node", "web"]);
    expect(extractFileEnvNames(`/// @nudo:env node, web\n`)).toEqual(["node", "web"]);
  });

  it("mixed separators are accepted", () => {
    expect(parseEnvPayload("node, web es")).toEqual(["node", "web", "es"]);
  });

  it("trailing line comment is stripped", () => {
    expect(parseEnvPayload("node // only node")).toEqual(["node"]);
  });

  it("path-like env names survive whitespace splitting", () => {
    expect(parseEnvPayload("es ./other.env.ts")).toEqual(["es", "./other.env.ts"]);
  });

  it("bare tag yields no env names (diagnostic lands on the AST channel)", () => {
    expect(extractFileEnvNames(`/// @nudo:env\n`)).toEqual([]);
    expect(extractFileEnvNames(`/// @nudo:env \n`)).toEqual([]);
  });

  it("truncated capture is still rejected (zero false positives)", () => {
    expect(parseEnvPayload(`node";`)).toEqual([]);
    expect(extractFileEnvNames(`// @nudo:env node";\n`)).toEqual([]);
  });
});
