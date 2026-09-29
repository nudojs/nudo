import { describe, it, expect } from "vitest";
import { findFnContractInsertPos, escapeRegExp } from "../sidecar-insert.ts";

describe("findFnContractInsertPos", () => {
  it("inserts into same-line fn({ … }) after the brace", () => {
    const line = `export const foo = fn({ x: number() }, number());`;
    const pos = findFnContractInsertPos([line], "foo")!;
    expect(pos.line).toBe(0);
    expect(line[pos.character - 1]).toBe("{");
    expect(line[pos.character]).toBe(" ");
  });

  it("inserts into multiline fn(\\n  { … }", () => {
    const lines = [
      `export const foo =`,
      `  fn({`,
      `    x: number()`,
      `  }, number());`,
    ];
    const pos = findFnContractInsertPos(lines, "foo")!;
    expect(pos).toEqual({ line: 1, character: lines[1]!.indexOf("{") + 1 });
  });

  it("returns null for shared shape identifier (does not walk into next export)", () => {
    const lines = [
      `export const a = fn(sharedShape, number());`,
      `export const b = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "a")).toBeNull();
    // b 自身仍有字面契约对象
    const pos = findFnContractInsertPos(lines, "b")!;
    expect(pos.line).toBe(1);
    expect(lines[1]![pos.character - 1]).toBe("{");
  });

  it("returns null when export has no fn( before next export", () => {
    const lines = [
      `export const a = someHelper(x);`,
      `export const b = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "a")).toBeNull();
  });

  it("escapes regex special chars in fnName", () => {
    expect(escapeRegExp("a$b")).toBe("a\\$b");
    const line = `export const a$b = fn({ x: number() }, number());`;
    const pos = findFnContractInsertPos([line], "a$b")!;
    expect(line[pos.character - 1]).toBe("{");
  });

  it("returns null when contract shape is missing", () => {
    const lines = [`export const foo = fn(x, number());`];
    expect(findFnContractInsertPos(lines, "foo")).toBeNull();
  });

  it("string containing // does not truncate the line (URL case)", () => {
    const line = `export const api = fn({ url: "http://x" }, number());`;
    const pos = findFnContractInsertPos([line], "api")!;
    expect(pos.line).toBe(0);
    expect(line[pos.character - 1]).toBe("{");
  });

  it("brace inside a string does not close the contract object", () => {
    const lines = [`export const foo = fn({ desc: "}" }, number());`];
    const pos = findFnContractInsertPos(lines, "foo")!;
    expect(lines[0]![pos.character - 1]).toBe("{");
  });

  it("fn( inside a comment is not the call site", () => {
    const lines = [
      `export const foo = helper(x); // fn({ fake: 1 })`,
      `export const bar = fn({ y: number() }, number());`,
    ];
    // foo 无真实 fn( → null；bar 自身仍可定位
    expect(findFnContractInsertPos(lines, "foo")).toBeNull();
    const pos = findFnContractInsertPos(lines, "bar")!;
    expect(pos.line).toBe(1);
  });

  it("fn( inside a string is not the call site", () => {
    const lines = [
      `export const foo = note("fn({ fake: 1 })");`,
      `export const bar = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "foo")).toBeNull();
    const pos = findFnContractInsertPos(lines, "bar")!;
    expect(lines[1]![pos.character - 1]).toBe("{");
  });

  it("export name inside a string is not the target binding", () => {
    const lines = [
      `const s = "export const foo = fn({ x: 1 }, 2)";`,
      `export const bar = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "foo")).toBeNull();
  });
});
