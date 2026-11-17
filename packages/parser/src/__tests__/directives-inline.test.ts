import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractInlineDirectives } from "../directives.ts";

function getFirstStmtDirectives(source: string) {
  const ast = parse(source);
  for (const stmt of ast.program.body) {
    const directives = extractInlineDirectives(stmt);
    if (directives.length > 0) return directives;
  }
  return [];
}

const AS_CASES = [
  {
    name: "builder 与对象字面量都产出 obj",
    lines: ["// @nudo:as shape({ port: number() })", "// @nudo:as { port: number() }"],
    shape: "obj",
  },
  { name: "块注释同样可承载 @nudo:as", lines: ["/* @nudo:as number() */"], shape: "prim" },
];

describe("extractInlineDirectives：@nudo:as", () => {
  it.each(AS_CASES)("$name", ({ lines, shape }) => {
    for (const line of lines) {
      const directives = getFirstStmtDirectives(`
${line}
const config = JSON.parse(text);
`);
      expect(directives).toHaveLength(1);
      expect(directives[0].kind).toBe("as");
      if (directives[0].kind === "as") expect(directives[0].typeAbs.shape.k).toBe(shape);
    }
  });
});

const REPLACE_CASES = [
  { name: "标识符目标", line: "// @nudo:replace a number()", target: "a", shape: "prim" },
  { name: "成员表达式目标", line: "// @nudo:replace res.data array(number())", target: "res.data", shape: "arr" },
  { name: "调用表达式目标", line: "// @nudo:replace JSON.parse(input) shape({ id: number() })", target: "JSON.parse(input)", shape: "obj" },
];

describe("extractInlineDirectives：@nudo:replace 目标形式", () => {
  it.each(REPLACE_CASES)("$name", ({ line, target, shape }) => {
    const directives = getFirstStmtDirectives(`
${line}
const x = a + b;
`);
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("replace");
    if (directives[0].kind === "replace") {
      expect(directives[0].targetSource).toBe(target);
      expect(directives[0].typeAbs.shape.k).toBe(shape);
    }
  });
});

describe("extractInlineDirectives：语句级聚合", () => {
  it("同一语句多条指令被全部提取；无指令语句返回空", () => {
    const multi = getFirstStmtDirectives(`
// @nudo:replace a number()
// @nudo:replace b string()
const x = a + b;
`);
    expect(multi).toHaveLength(2);
    expect(multi.map((d) => d.kind)).toEqual(["replace", "replace"]);

    const none = getFirstStmtDirectives(`
const x = 1 + 2;
`);
    expect(none).toEqual([]);
  });
});
