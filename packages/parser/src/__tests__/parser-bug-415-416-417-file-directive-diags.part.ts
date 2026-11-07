/**
 * 族 10 片 1 —— 415 / 416 / 417 的**诊断落点**（parser AST 通道）。
 *
 * - 415：`@nudo:mock-module` 标签命中但**载荷解析失败** ⇒ 不再静默丢弃
 *   （此前无 else 分支 ⇒ 指令静默蒸发：mock 不生效、门禁照常绿）。
 * - 416：`@nudo:import` 属文件级指令族 ⇒ 块注释形态被**忽略并告警**
 *   （口径与 core 文本通道分档后一致）。
 * - 417：`@nudo:env` **裸标签**（没写 env 名）⇒ 告警（此前整行不匹配 ⇒
 *   零诊断地丢弃 ⇒ env 未解析 ⇒ 全局 unknown）。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractFileDirectives } from "../directives.ts";
import type { DirectiveDiag } from "../directives.ts";

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

describe("Bug 415: unparsable @nudo:mock-module payload is diagnosed", () => {
  it("malformed mock-module payload → nudo:directive-syntax warning", () => {
    const diags = fileDiags(
      `/// @nudo:mock-module axios from ./m.js\nimport axios from "axios";\n`,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Unrecognized @nudo:mock-module form");
  });

  it("single-quoted mock-module payload is accepted and silent", () => {
    const src = `/// @nudo:mock-module 'axios' from './m.js'\nimport axios from "axios";\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "mock-module", source: "axios", fromPath: "./m.js" },
    ]);
  });
});

describe("Bug 416: block-comment @nudo:import is ignored with a warning", () => {
  it("block comment form → nudo:directive-syntax warning", () => {
    const diags = fileDiags(`/* @nudo:import { a } from "./x.nudo.js" */\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:import is a file-level directive");
  });

  it("JSDoc block form → warning too", () => {
    const diags = fileDiags(`/**\n * @nudo:import { a } from "./x.nudo.js"\n */\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
  });

  it("line comment form stays silent (control)", () => {
    expect(fileDiags(`/// @nudo:import { a } from "./x.nudo.js"\nexport function f(){}\n`)).toEqual([]);
  });
});

describe("Bug 417: bare @nudo:env tag is diagnosed", () => {
  it("bare tag → nudo:directive-syntax warning", () => {
    const diags = fileDiags(`/// @nudo:env\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("@nudo:env requires at least one env name");
  });

  it("bare tag with trailing blank → warning too", () => {
    expect(fileDiags(`/// @nudo:env \nexport function f(){}\n`)).toHaveLength(1);
  });

  it("space-separated env list is accepted and silent", () => {
    const src = `/// @nudo:env node web\nexport function f(){}\n`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "env", envs: ["node", "web"] },
    ]);
  });

  it("unreadable env list → warning (no silent drop)", () => {
    const diags = fileDiags(`/// @nudo:env node";\nexport function f(){}\n`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toContain("Unrecognized @nudo:env list");
  });
});
