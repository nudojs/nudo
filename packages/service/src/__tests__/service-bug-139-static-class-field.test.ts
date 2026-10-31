/**
 * BUG-139 回归：**类的静态字段**不得被当成方法收进函数表。
 *
 * 改前 kind 过滤写成 `m.kind !== undefined && m.kind !== "method"`，而 Babel 的
 * 类字段节点是 `ClassProperty`（**没有** `kind` 字段）⇒ 过滤放行 ⇒ `K.s`
 * 成为一个「函数」⇒ dts 面渲染成实例方法、check 面对不上、运行时不符。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { collectTopLevelFunctions } from "../analyzer-ast.ts";
import { parse } from "@nudojs/parser";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const SRC = `export class K {
  static s = 1;
  static m() { return 2; }
  instance() { return 3; }
}
`;

describe("BUG-139 — 静态字段不是方法", () => {
  it("静态方法进函数表，静态字段不进", () => {
    const names = withTmpProject("nudo-139-", (dir) => {
      const file = writeTmpFile(dir, "k.js", SRC);
      return collectTopLevelFunctions(parse(readFileSync(file, "utf-8"))).map((f) => f.name);
    });
    expect(names).toContain("K.m");
    expect(names).toContain("K.instance");
    expect(names).not.toContain("K.s");
  });
});
