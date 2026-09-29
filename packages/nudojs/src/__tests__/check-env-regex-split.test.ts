/**
 * BUG-013 回归：check 侧文件级 @nudo:env 抽取与 test/analyzer 同口径。
 * `//` 与 `///` 等价；字符串里假阳性不得进符号面。
 */
import { describe, it, expect } from "vitest";
import { fileEnvNamesFromText } from "../commands/check.ts";

describe("fileEnvNamesFromText prefix contract", () => {
  it("// @nudo:env and /// @nudo:env are both recognized (and agree)", () => {
    for (const pre of ["//", "///"]) {
      const src = `${pre} @nudo:env node\nexport function f(){}`;
      expect(fileEnvNamesFromText(src)).toEqual(["node"]);
    }
  });

  it("@nudo:env inside a string is ignored", () => {
    const src = `const s = "@nudo:env node";\nexport function f(){}`;
    expect(fileEnvNamesFromText(src)).toEqual([]);
  });

  it("@nudo:env inside a template string is ignored", () => {
    const src = "const s = `@nudo:env node`;\nexport function f(){}";
    expect(fileEnvNamesFromText(src)).toEqual([]);
  });

  it("@nudo:env inside a block comment is ignored (line comments only)", () => {
    const src = `/* @nudo:env node */\nexport function f(){}`;
    expect(fileEnvNamesFromText(src)).toEqual([]);
  });

  it("block comment wrapping a line-comment marker does not count", () => {
    const src = `/* // @nudo:env node */\nexport function f(){}`;
    expect(fileEnvNamesFromText(src)).toEqual([]);
  });

  it("trailing junk after env name is rejected (no node\"; capture)", () => {
    const src = `// @nudo:env node";\nexport function f(){}`;
    expect(fileEnvNamesFromText(src)).toEqual([]);
  });

  it("string false-positive with semicolon does not leak", () => {
    const src = `const s = "@nudo:env node";\nexport function f(){}`;
    expect(fileEnvNamesFromText(src)).not.toContain('node";');
  });

  it("comma-separated named + path envs survive", () => {
    const src = `// @nudo:env es, ./other.env.ts\nexport function f(){}`;
    expect(fileEnvNamesFromText(src)).toEqual(["es", "./other.env.ts"]);
  });

  it("http:// URL does not open a fake comment", () => {
    const src = `const u = "http://@nudo:env node";\nexport function f(){}`;
    expect(fileEnvNamesFromText(src)).toEqual([]);
  });
});
