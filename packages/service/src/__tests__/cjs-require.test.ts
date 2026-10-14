import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectStaticImports, collectDependencySpecs } from "../static-imports.ts";
import { parse } from "@nudojs/parser";
import { withTmpProject } from "./tmp-project.ts";

describe("CJS require static resolution", () => {
  it("follows require('./x')", () =>
    withTmpProject("nudo-cjs-", (dir) => {
      writeFileSync(
        join(dir, "math.js"),
        `function add(a, b) { return a + b; }\nexports.add = add;\nexports.scale = function (x) { return add(x, 1); };\n`,
      );
      writeFileSync(
        join(dir, "index.js"),
        `const { add } = require("./math.js");\nexports.double = function (x) { return add(x, x); };\n`,
      );
      const graph = collectStaticImports(join(dir, "index.js"));
      expect(graph.size).toBe(2);
      const index = graph.get(join(dir, "index.js"))!;
      expect(index.named.has("double")).toBe(true);
      const math = graph.get(join(dir, "math.js"))!;
      expect(math.named.has("add")).toBe(true);
      expect(math.poly.get("add")?.display).toContain("A1");
    }));

  it("collectDependencySpecs finds require strings", () => {
    const ast = parse(`const a = require("./a.js");\nconst b = require("./b.js");\n`);
    const specs = collectDependencySpecs(ast);
    expect(specs).toContain("./a.js");
    expect(specs).toContain("./b.js");
  });

  it("collectDependencySpecs folds template / concat / require.resolve", () => {
    const ast = parse(`
const a = require(\`./a.js\`);
const b = require("./" + "b" + ".js");
const p = require.resolve("./c.js");
const dyn = require(name);
`);
    const specs = collectDependencySpecs(ast);
    expect(specs).toContain("./a.js");
    expect(specs).toContain("./b.js");
    expect(specs).toContain("./c.js");
    // 真动态：不假装成某模块
    expect(specs.some((s) => s === "name" || s.includes("name"))).toBe(false);
    expect(specs).toHaveLength(3);
  });

  it("module.exports = fn registers export", () =>
    withTmpProject("nudo-cjs2-", (dir) => {
      writeFileSync(
        join(dir, "lib.js"),
        `function hello() { return "hi"; }\nmodule.exports = hello;\n`,
      );
      writeFileSync(join(dir, "app.js"), `const hello = require("./lib.js");\nexports.f = hello;\n`);
      const graph = collectStaticImports(join(dir, "app.js"));
      const lib = graph.get(join(dir, "lib.js"))!;
      expect(lib.named.has("hello")).toBe(true);
    }));
});
