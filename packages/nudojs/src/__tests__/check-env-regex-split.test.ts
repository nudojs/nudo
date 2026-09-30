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

/**
 * D5=F1：parser / core / nudojs 对同一源码指令集合一致（单源抽取）。
 * nudojs fileEnvNamesFromText = core extractFileEnvNames 的消费口；
 * parser extractFileDirectives 走同一 parseEnvPayload 文法。
 */
describe("F1 three-way agreement: parser / core / nudojs", () => {
  it("env sets agree on the same source", async () => {
    const { extractFileEnvNames, extractFileDirectives, parse } = await import("@nudojs/parser");
    const src = [
      `// @nudo:env node, es`,
      `// @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js"`,
      `const s = "// @nudo:env web";`,
      `export function f() {}`,
    ].join("\n");
    const fromNudojs = fileEnvNamesFromText(src);
    const fromCore = extractFileEnvNames(src);
    const fromParser = extractFileDirectives(parse(src))
      .filter((d) => d.kind === "env")
      .flatMap((d) => (d.kind === "env" ? d.envs : []));
    expect(fromNudojs).toEqual(["node", "es"]);
    expect(fromCore).toEqual(fromNudojs);
    expect(fromParser).toEqual(fromNudojs);
  });

  it("mock-module records agree on the same source", async () => {
    const { extractMockModuleRecords, extractFileDirectives, parse } = await import("@nudojs/parser");
    const src = `// @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js"\nexport function f() {}`;
    const fromCore = extractMockModuleRecords(src);
    const fromParser = extractFileDirectives(parse(src)).filter((d) => d.kind === "mock-module");
    expect(fromCore).toEqual([{ source: "fs", names: ["readFileSync"], fromPath: "./mock-fs.js" }]);
    expect(fromParser).toEqual([
      { kind: "mock-module", source: "fs", names: ["readFileSync"], fromPath: "./mock-fs.js" },
    ]);
  });
});
