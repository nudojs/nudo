/**
 * JSDoc 块内错位的文件级标签（@nudo:env / @nudo:mock-module）必须发
 * nudo:directive-syntax 警告并给出三斜线写法；提取面仍只认行注释。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  extractFileDirectives,
  runWithDirectiveDiags,
  type DirectiveDiag,
} from "../directives.ts";

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

describe("块注释里的文件级标签", () => {
  const envForms = [
    `/** @nudo:env node */\nexport function f(){}`,
    `/**\n * @nudo:env node\n */\nexport function f(){}`,
    `/* @nudo:env node */\nexport function f(){}`,
  ];

  it("JSDoc / 多行 JSDoc / 普通块注释的 @nudo:env 都告警且不产出指令", () => {
    for (const src of envForms) {
      const diags = fileDiags(src);
      expect(diags, src).toHaveLength(1);
      expect(diags[0]!.code).toBe("nudo:directive-syntax");
      expect(diags[0]!.message).toContain("@nudo:env is a file-level directive");
      expect(diags[0]!.message).toContain("/// @nudo:env node");
      expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
    }
  });

  it("JSDoc 里的 @nudo:mock-module 告警并给出 /// 写法", () => {
    const src = `/** @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js" */\nexport function f(){}`;
    const diags = fileDiags(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:mock-module is a file-level directive");
    expect(diags[0]!.message).toContain(`/// @nudo:mock-module "fs" from "./mock-fs.js"`);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([]);
  });

  it("同一块里的两个文件级标签各告警一次", () => {
    const diags = fileDiags(
      `/**\n * @nudo:env node\n * @nudo:mock-module "fs" from "./m.js"\n */\nexport function f(){}`,
    );
    expect(diags).toHaveLength(2);
    expect(new Set(diags.map((d) => d.message)).size).toBe(2);
  });

  it("同一标签出现在两个块 ⇒ 同消息去重为一条", () => {
    const diags = fileDiags(`/** @nudo:env node */\n/** @nudo:env es */\nexport function f(){}`);
    expect(diags).toHaveLength(1);
  });
});

describe("正确写法保持静默并正常提取", () => {
  const valid = [
    { src: `/// @nudo:env node\nexport function f(){}`, expected: [{ kind: "env", envs: ["node"] }] },
    { src: `// @nudo:env node\nexport function f(){}`, expected: [{ kind: "env", envs: ["node"] }] },
    { src: `/// @nudo:mock-module "fs" from "./m.js"\nexport function f(){}`, expected: [{ kind: "mock-module", source: "fs", fromPath: "./m.js" }] },
  ];

  it("/// 与 // 的 env / mock-module 行注释：零警告且产出指令", () => {
    for (const { src, expected } of valid) {
      expect(fileDiags(src), src).toEqual([]);
      expect(extractFileDirectives(parse(src), { diags: [] })).toEqual(expected);
    }
  });

  it("函数 JSDoc 里的 case / contract 合法形式零告警", () => {
    const src = [
      `/**`,
      ` * @nudo:case "safe" (1) => 2`,
      ` * @nudo:contract safe(base, rel)`,
      ` */`,
      `export function safe(base, rel) { return base + rel; }`,
    ].join("\n");
    const diags: DirectiveDiag[] = [];
    expect(extractFileDirectives(parse(src), { diags })).toEqual([]);
    expect(extractDirectives(parse(src), { diags }).map((f) => f.name)).toEqual(["safe"]);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toEqual([]);
  });

  it("无 diags 的纯查询不抛错；runWithDirectiveDiags 域内仍收集告警", () => {
    expect(() => extractFileDirectives(parse(`/** @nudo:env node */`))).not.toThrow();
    expect(extractFileDirectives(parse(`/** @nudo:env node */`))).toEqual([]);
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => extractFileDirectives(parse(`/** @nudo:env node */`)));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
  });
});

describe("相似文本不误报", () => {
  it("更长的标签 / 行内散文 / @example 里的 /// 都不算块内文件级指令", () => {
    const srcs = [
      `/** @nudo:environment node */\nexport function f(){}`,
      `/**\n * Docs: enable the node env via @nudo:env node elsewhere.\n */\nexport function f(){}`,
      [`/**`, ` * @example`, ` * /// @nudo:env node`, ` * import { join } from "node:path";`, ` */`, `export function f(){}`].join("\n"),
    ];
    for (const src of srcs) expect(fileDiags(src), src).toEqual([]);
  });
});
