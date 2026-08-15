import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractInlineDirectives } from "../directives.ts";

function getFirstStmtDirectives(source: string) {
  const ast = parse(source);
  const body = ast.program.body;
  for (const stmt of body) {
    const directives = extractInlineDirectives(stmt);
    if (directives.length > 0) return directives;
  }
  return [];
}

describe("extractInlineDirectives", () => {
  it("extracts @nudo:as directive", () => {
    const source = `
// @nudo:as T.object({ port: T.number })
const config = JSON.parse(text);
`;
    const directives = getFirstStmtDirectives(source);
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("as");
    if (directives[0].kind === "as") {
      expect(directives[0].typeExpr.kind).toBe("object");
    }
  });

  it("extracts @nudo:replace directive with identifier target", () => {
    const source = `
// @nudo:replace a T.number
const x = a + b;
`;
    const directives = getFirstStmtDirectives(source);
    expect(directives).toHaveLength(1);
    expect(directives[0].kind).toBe("replace");
    if (directives[0].kind === "replace") {
      expect(directives[0].targetSource).toBe("a");
      expect(directives[0].typeExpr.kind).toBe("primitive");
    }
  });

  it("extracts @nudo:replace directive with member expression target", () => {
    const source = `
// @nudo:replace res.data T.array(T.number)
const items = res.data;
`;
    const directives = getFirstStmtDirectives(source);
    expect(directives).toHaveLength(1);
    if (directives[0].kind === "replace") {
      expect(directives[0].targetSource).toBe("res.data");
    }
  });

  it("extracts @nudo:replace with call expression target", () => {
    const source = `
// @nudo:replace JSON.parse(input) T.object({ id: T.number })
const data = JSON.parse(input);
`;
    const directives = getFirstStmtDirectives(source);
    expect(directives).toHaveLength(1);
    if (directives[0].kind === "replace") {
      expect(directives[0].targetSource).toBe("JSON.parse(input)");
    }
  });

  it("extracts multiple directives on the same statement", () => {
    const source = `
// @nudo:replace a T.number
// @nudo:replace b T.string
const x = a + b;
`;
    const directives = getFirstStmtDirectives(source);
    expect(directives).toHaveLength(2);
    expect(directives[0].kind).toBe("replace");
    expect(directives[1].kind).toBe("replace");
  });

  it("returns empty for statements without directives", () => {
    const source = `
const x = 1 + 2;
`;
    const directives = getFirstStmtDirectives(source);
    expect(directives).toHaveLength(0);
  });

  it("ignores block comments", () => {
    const source = `
/* @nudo:as T.number */
const x = 1;
`;
    const directives = getFirstStmtDirectives(source);
    expect(directives).toHaveLength(0);
  });
});
