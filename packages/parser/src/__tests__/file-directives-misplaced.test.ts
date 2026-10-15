/**
 * JSDoc 块内错位的文件级指令族标签（`@nudo:env` / `@nudo:mock-module`）
 * 不再静默忽略：发 nudo:directive-syntax 警告并给出三斜线正确写法。
 * 提取面契约不变：仍只认行注释（`//` / `///`）。
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

describe("misplaced file-level directive tags in JSDoc blocks", () => {
  it("/** @nudo:env node */ → nudo:directive-syntax warning with the /// form", () => {
    const diags = fileDiags(`/** @nudo:env node */\nexport function f(){}`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toBe(
      `@nudo:env is a file-level directive — use '/// @nudo:env node' at the top of the file (JSDoc block form is ignored)`,
    );
  });

  it("multi-line JSDoc with ` * @nudo:env node` continuation → warning", () => {
    const diags = fileDiags(`/**\n * @nudo:env node\n */\nexport function f(){}`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain(`@nudo:env is a file-level directive`);
  });

  it("plain /* … */ block comment form → warning too (equally ignored)", () => {
    const diags = fileDiags(`/* @nudo:env node */\nexport function f(){}`);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
  });

  it("/** @nudo:mock-module … */ → nudo:directive-syntax warning with the /// form", () => {
    const diags = fileDiags(
      `/** @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js" */\nexport function f(){}`,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
    expect(diags[0]!.message).toBe(
      `@nudo:mock-module is a file-level directive — use '/// @nudo:mock-module "fs" from "./mock-fs.js"' at the top of the file (JSDoc block form is ignored)`,
    );
  });

  it("extraction face unchanged: block form still yields no directive", () => {
    const results = extractFileDirectives(
      parse(`/** @nudo:env node */\nexport function f(){}`),
      { diags: [] },
    );
    expect(results).toEqual([]);
  });

  it("both tags in one block → two warnings (deduped per message)", () => {
    const diags = fileDiags(
      `/**\n * @nudo:env node\n * @nudo:mock-module "fs" from "./m.js"\n */\nexport function f(){}`,
    );
    expect(diags).toHaveLength(2);
    expect(new Set(diags.map((d) => d.message)).size).toBe(2);
  });

  it("two blocks with the same tag → single warning (same-message dedup)", () => {
    const diags = fileDiags(
      `/** @nudo:env node */\n/** @nudo:env es */\nexport function f(){}`,
    );
    expect(diags).toHaveLength(1);
  });
});

describe("correct forms stay silent", () => {
  it("/// @nudo:env node → no warning, directive extracted", () => {
    const diags = fileDiags(`/// @nudo:env node\nexport function f(){}`);
    expect(diags).toEqual([]);
    const results = extractFileDirectives(parse(`/// @nudo:env node\nexport function f(){}`), {
      diags: [],
    });
    expect(results).toEqual([{ kind: "env", envs: ["node"] }]);
  });

  it("// @nudo:env node (single slash) → no warning", () => {
    expect(fileDiags(`// @nudo:env node\nexport function f(){}`)).toEqual([]);
  });

  it("/// @nudo:mock-module … → no warning, directive extracted", () => {
    const src = `/// @nudo:mock-module "fs" from "./m.js"\nexport function f(){}`;
    expect(fileDiags(src)).toEqual([]);
    expect(extractFileDirectives(parse(src), { diags: [] })).toEqual([
      { kind: "mock-module", source: "fs", fromPath: "./m.js" },
    ]);
  });

  it("function JSDoc with @nudo:case / @nudo:contract legal forms → no warning at all", () => {
    const src = [
      `/**`,
      ` * @nudo:case "safe" (1) => 2`,
      ` * @nudo:contract safe(base, rel)`,
      ` */`,
      `export function safe(base, rel) { return base + rel; }`,
    ].join("\n");
    const diags: DirectiveDiag[] = [];
    const fileDirs = extractFileDirectives(parse(src), { diags });
    const fns = extractDirectives(parse(src), { diags });
    expect(fileDirs).toEqual([]);
    expect(fns.map((f) => f.name)).toEqual(["safe"]);
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toEqual([]);
  });

  it("pure query form (no diags) drops the warning and does not throw", () => {
    expect(() => extractFileDirectives(parse(`/** @nudo:env node */`))).not.toThrow();
    expect(extractFileDirectives(parse(`/** @nudo:env node */`))).toEqual([]);
  });

  it("pure query inside runWithDirectiveDiags domain falls into that domain (check 链路)", () => {
    const diags: DirectiveDiag[] = [];
    runWithDirectiveDiags(diags, () => extractFileDirectives(parse(`/** @nudo:env node */`)));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.code).toBe("nudo:directive-syntax");
  });
});

describe("no false positives on look-alike text", () => {
  it("longer tag @nudo:environment is not @nudo:env", () => {
    expect(fileDiags(`/** @nudo:environment node */\nexport function f(){}`)).toEqual([]);
  });

  it("prose mention mid-line is not a directive tag", () => {
    const src = `/**\n * Docs: enable the node env via @nudo:env node elsewhere.\n */\nexport function f(){}`;
    expect(fileDiags(src)).toEqual([]);
  });

  it("/// line inside @example (with * continuation) is not a block-form directive", () => {
    const src = [
      `/**`,
      ` * @example`,
      ` * /// @nudo:env node`,
      ` * import { join } from "node:path";`,
      ` */`,
      `export function f(){}`,
    ].join("\n");
    expect(fileDiags(src)).toEqual([]);
  });
});
