/**
 * Bug 838 —— 文件级 `/// @nudo:mock-module` 被**函数级** `@nudo:mock` 标签正则
 * 误捕：正确写法产生**伪造的** nudo:directive-syntax 警告（"Malformed @nudo:mock:
 * cannot parse name … — got: -module …"）。
 *
 * 根因：mock 标签正则用 `\b` 收尾，`@nudo:mock` 后的 `-` 仍满足词边界 ⇒ 文件级
 * `@nudo:mock-module` 落进函数级 mock 扫描器。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import {
  extractDirectives,
  extractFileDirectives,
  type DirectiveDiag,
} from "../directives.ts";

function fnDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractDirectives(parse(src), { diags });
  return diags;
}

function fileDiags(src: string): DirectiveDiag[] {
  const diags: DirectiveDiag[] = [];
  extractFileDirectives(parse(src), { diags });
  return diags;
}

const FILE_LEVEL_MOCK_MODULE = `/// @nudo:mock-module "fs" from "./mock-fs.js"
export function f() {
  return 1;
}
`;

describe("Bug 838: file-level @nudo:mock-module is not a function-level @nudo:mock", () => {
  it("produces no nudo:directive-syntax warning", () => {
    expect(fnDiags(FILE_LEVEL_MOCK_MODULE)).toEqual([]);
    expect(fileDiags(FILE_LEVEL_MOCK_MODULE)).toEqual([]);
  });

  it("leaks no function-level mock directive", () => {
    const fns = extractDirectives(parse(FILE_LEVEL_MOCK_MODULE), { diags: [] });
    expect(fns.flatMap((f) => f.directives)).toEqual([]);
  });

  it("still extracts the file-level mock-module directive", () => {
    expect(extractFileDirectives(parse(FILE_LEVEL_MOCK_MODULE), { diags: [] })).toEqual([
      { kind: "mock-module", source: "fs", fromPath: "./mock-fs.js" },
    ]);
  });

  it("function-level @nudo:mock still works (no over-blocking)", () => {
    const src = `/**
 * @nudo:mock fetch = (u) => ({ ok: true })
 */
export function f(u) {
  return fetch(u);
}
`;
    expect(fnDiags(src)).toEqual([]);
    const fns = extractDirectives(parse(src), { diags: [] });
    expect(fns).toHaveLength(1);
    expect(fns[0]!.directives.map((d) => d.kind)).toEqual(["mock"]);
  });
});
