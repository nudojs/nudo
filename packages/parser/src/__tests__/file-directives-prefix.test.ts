/**
 * BUG-013 回归：文件级 @nudo:env / @nudo:mock-module 前缀契约统一。
 * `//` 与 `///` 等价；字符串/块注释里的同形文本不算。
 * 三套抽取器（parser extractFileDirectives / check fileEnvNamesFromText /
 * load-deps extractAllLoadSpecs）不合并，但识别面必须一致。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractFileDirectives } from "../directives.ts";

describe("extractFileDirectives prefix contract", () => {
  it("// @nudo:env and /// @nudo:env are both recognized (and agree)", () => {
    for (const pre of ["//", "///"]) {
      const src = `${pre} @nudo:env node\nexport function f(){}`;
      expect(extractFileDirectives(parse(src))).toEqual([
        { kind: "env", envs: ["node"] },
      ]);
    }
  });

  it("@nudo:env inside a string is ignored", () => {
    const src = `const s = "@nudo:env node";\nexport function f(){}`;
    expect(extractFileDirectives(parse(src))).toEqual([]);
  });

  it("@nudo:env inside a template string is ignored", () => {
    const src = "const s = `@nudo:env node`;\nexport function f(){}";
    expect(extractFileDirectives(parse(src))).toEqual([]);
  });

  it("@nudo:env inside a block comment is ignored (line comments only)", () => {
    const src = `/* @nudo:env node */\nexport function f(){}`;
    expect(extractFileDirectives(parse(src))).toEqual([]);
  });

  it("trailing junk after env name is rejected", () => {
    const src = `// @nudo:env node";\nexport function f(){}`;
    expect(extractFileDirectives(parse(src))).toEqual([]);
  });

  it("comma-separated named + path envs survive", () => {
    const src = `// @nudo:env es, ./other.env.ts\nexport function f(){}`;
    expect(extractFileDirectives(parse(src))).toEqual([
      { kind: "env", envs: ["es", "./other.env.ts"] },
    ]);
  });

  it("// @nudo:mock-module and /// @nudo:mock-module are both recognized", () => {
    for (const pre of ["//", "///"]) {
      const src = `${pre} @nudo:mock-module "fs" from "./m.js"\nexport function f(){}`;
      expect(extractFileDirectives(parse(src))).toEqual([
        { kind: "mock-module", source: "fs", fromPath: "./m.js" },
      ]);
    }
  });

  it("@nudo:mock-module inside a string is ignored", () => {
    const src = `const s = '@nudo:mock-module "fs" from "./m.js"';\nexport function f(){}`;
    expect(extractFileDirectives(parse(src))).toEqual([]);
  });

  it("partial mock-module accepts both prefixes", () => {
    for (const pre of ["//", "///"]) {
      const src = `${pre} @nudo:mock-module "fs" { readFileSync } from "./m.js"\nexport function f(){}`;
      expect(extractFileDirectives(parse(src))).toEqual([
        {
          kind: "mock-module",
          source: "fs",
          names: ["readFileSync"],
          fromPath: "./m.js",
        },
      ]);
    }
  });
});
