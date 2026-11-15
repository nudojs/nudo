/**
 * BUG-152 回归：**匿名** `export default class { … }` 必须进导出表。
 *
 * 改前两个分支都落空（无 id ⇒ 不是 `ClassDeclaration && defaultClassName`；
 * `asIdentifier(d)` 也不是 Identifier）⇒ `continue` 彻底丢掉 ⇒ 四面全盲、
 * 零产物（消费端 TS2307）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "@nudojs/parser";
import { collectTopLevelFunctions } from "../analyzer-ast.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

const SRC = `export default class {
  run(x) { return x + 1; }
}
`;

describe("BUG-152 — 匿名 default class 可见", () => {
  it("成员按导出槽名 `default` 登记（不再被整体丢弃）", () => {
    const names = withTmpProject("nudo-152-", (dir) => {
      const file = writeTmpFile(dir, "anon.js", SRC);
      return collectTopLevelFunctions(parse(readFileSync(file, "utf-8"))).map((f) => f.name);
    });
    expect(names).toContain("default.run");
  });

  it("对照组：具名 default class 仍按本地名登记（口径不变）", () => {
    const names = withTmpProject("nudo-152-named-", (dir) => {
      const file = writeTmpFile(dir, "named.js", `export default class Foo {\n  run() { return 1; }\n}\n`);
      return collectTopLevelFunctions(parse(readFileSync(file, "utf-8"))).map((f) => f.name);
    });
    expect(names).toContain("Foo.run");
  });
});
