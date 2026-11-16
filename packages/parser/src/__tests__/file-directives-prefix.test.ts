/**
 * 文件级 @nudo:env / @nudo:mock-module 前缀契约：`//` 与 `///` 等价；
 * 字符串、模板字符串、块注释里的同形文本不算；三套抽取器的识别面一致。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractFileDirectives } from "../directives.ts";

const parseFile = (src: string) => extractFileDirectives(parse(src));

const ENV_CASES = [
  {
    name: "`//` 与 `///` 等价",
    srcs: ["// @nudo:env node", "/// @nudo:env node"],
    expected: [{ kind: "env", envs: ["node"] }],
  },
  {
    name: "逗号分隔的命名 env 与路径 env",
    srcs: ["// @nudo:env es, ./other.env.ts"],
    expected: [{ kind: "env", envs: ["es", "./other.env.ts"] }],
  },
  {
    name: "尾随垃圾拒绝整行",
    srcs: [`// @nudo:env node";`],
    expected: [],
  },
];

describe("extractFileDirectives：@nudo:env", () => {
  it.each(ENV_CASES)("$name", ({ srcs, expected }) => {
    for (const line of srcs) {
      expect(parseFile(`${line}\nexport function f(){}`)).toEqual(expected);
    }
  });

  it("字符串 / 模板字符串 / 块注释内的同形文本都不算指令", () => {
    const srcs = [
      `const s = "@nudo:env node";`,
      "const s = `@nudo:env node`;",
      `/* @nudo:env node */`,
    ];
    for (const src of srcs) {
      expect(parseFile(`${src}\nexport function f(){}`)).toEqual([]);
    }
  });
});

const MOCK_CASES = [
  {
    name: "完整 mock-module：`//` 与 `///` 等价",
    srcs: ["// @nudo:mock-module \"fs\" from \"./m.js\"", "/// @nudo:mock-module \"fs\" from \"./m.js\""],
    expected: [{ kind: "mock-module", source: "fs", fromPath: "./m.js" }],
  },
  {
    name: "部分 mock-module：`//` 与 `///` 等价",
    srcs: ["// @nudo:mock-module \"fs\" { readFileSync } from \"./m.js\"", "/// @nudo:mock-module \"fs\" { readFileSync } from \"./m.js\""],
    expected: [{ kind: "mock-module", source: "fs", names: ["readFileSync"], fromPath: "./m.js" }],
  },
  {
    name: "字符串内的同形文本不算指令",
    srcs: [`const s = '@nudo:mock-module "fs" from "./m.js"';`],
    expected: [],
  },
];

describe("extractFileDirectives：@nudo:mock-module", () => {
  it.each(MOCK_CASES)("$name", ({ srcs, expected }) => {
    for (const src of srcs) {
      expect(parseFile(`${src}\nexport function f(){}`)).toEqual(expected);
    }
  });
});
