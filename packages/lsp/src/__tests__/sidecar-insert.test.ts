import { describe, it, expect } from "vitest";
import { findFnContractInsertPos } from "../sidecar-insert.ts";

/**
 * `findFnContractInsertPos` 的契约（族 23 片 A / Bug 731 收口后）：
 * 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的
 * **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。
 *
 * 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。
 */
const X_Z = { param: "x", path: ["z"] };

describe("findFnContractInsertPos", () => {
  it("inserts into same-line fn({ … }) after the target param's shape brace", () => {
    const line = `export const foo = fn({ x: shape({ y: number() }) }, number());`;
    const pos = findFnContractInsertPos([line], "foo", X_Z)!;
    expect(pos.line).toBe(0);
    expect(line[pos.character - 1]).toBe("{");
    expect(line[pos.character]).toBe(" ");
    // 插入点前是 **shape 的 `{`**（不是形参表的 `{`）
    expect(line.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("inserts into multiline fn(\\n  { … }", () => {
    const lines = [
      `export const foo =`,
      `  fn({`,
      `    x: shape({`,
      `      y: number()`,
      `    })`,
      `  }, number());`,
    ];
    const pos = findFnContractInsertPos(lines, "foo", X_Z)!;
    expect(pos).toEqual({ line: 2, character: lines[2]!.indexOf("{") + 1 });
  });

  it("returns null for shared shape identifier (does not walk into next export)", () => {
    const lines = [
      `export const a = fn(sharedShape, number());`,
      `export const b = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "a", X_Z)).toBeNull();
    // b 的 y 是标量契约 ⇒ 没有 shape 可补 ⇒ null（不猜位置）
    expect(findFnContractInsertPos(lines, "b", { param: "y", path: ["z"] })).toBeNull();
  });

  it("returns null when export has no fn( before next export", () => {
    const lines = [
      `export const a = someHelper(x);`,
      `export const b = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "a", X_Z)).toBeNull();
  });

  it("fnName with regex special chars still resolves (identifier equality)", () => {
    const line = `export const a$b = fn({ x: shape({ y: number() }) }, number());`;
    const pos = findFnContractInsertPos([line], "a$b", X_Z)!;
    expect(line.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("returns null when contract shape is missing", () => {
    const lines = [`export const foo = fn(x, number());`];
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
  });

  it("returns null when the field is already declared in the target shape", () => {
    const line = `export const foo = fn({ x: shape({ z: number() }) }, number());`;
    expect(findFnContractInsertPos([line], "foo", X_Z)).toBeNull();
  });

  it("string containing // does not truncate the line (URL case)", () => {
    const line = `export const api = fn({ url: shape({ href: "http://x" }) }, number());`;
    const pos = findFnContractInsertPos([line], "api", { param: "url", path: ["z"] })!;
    expect(pos.line).toBe(0);
    expect(line.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("brace inside a string does not close the contract object", () => {
    const lines = [`export const foo = fn({ desc: shape({ t: "}" }) }, number());`];
    const pos = findFnContractInsertPos(lines, "foo", { param: "desc", path: ["z"] })!;
    expect(lines[0]!.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("fn( inside a comment is not the call site", () => {
    const lines = [
      `export const foo = helper(x); // fn({ fake: 1 })`,
      `export const bar = fn({ y: shape({ z: number() }) }, number());`,
    ];
    // foo 无真实 fn( → null；bar 自身仍可定位
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
    const pos = findFnContractInsertPos(lines, "bar", { param: "y", path: ["w"] })!;
    expect(pos.line).toBe(1);
  });

  it("fn( inside a string is not the call site", () => {
    const lines = [
      `export const foo = note("fn({ fake: 1 })");`,
      `export const bar = fn({ y: shape({ z: number() }) }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
    const pos = findFnContractInsertPos(lines, "bar", { param: "y", path: ["w"] })!;
    expect(lines[1]!.slice(0, pos.character - 1)).toContain("shape(");
  });

  it("export name inside a string is not the target binding", () => {
    const lines = [
      `const s = "export const foo = fn({ x: 1 }, 2)";`,
      `export const bar = fn({ y: number() }, number());`,
    ];
    expect(findFnContractInsertPos(lines, "foo", X_Z)).toBeNull();
  });
});
