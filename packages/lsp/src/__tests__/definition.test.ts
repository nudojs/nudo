import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition, findReferences } from "../symbols.ts";

describe("symbol table", () => {
  it("finds function definition", () => {
    const source = `function add(a, b) { return a + b; }`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");
    const def = findDefinition(table, "add");
    expect(def).not.toBeNull();
    expect(def!.kind).toBe("function");
    expect(def!.loc.start.line).toBe(1);
  });

  it("finds variable definition", () => {
    const source = `const x = 42;`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");
    const def = findDefinition(table, "x");
    expect(def).not.toBeNull();
    expect(def!.kind).toBe("variable");
  });

  it("collects references", () => {
    const source = `const x = 42; const y = x + 1;`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");
    const refs = table.references.filter((r) => r.name === "x");
    expect(refs.length).toBeGreaterThan(0);
  });
});
