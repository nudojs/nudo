/**
 * BUG-239 回归：`exports` 条件对象必须按 **package.json 的声明顺序**取首个
 * 命中的条件（Node `PACKAGE_TARGET_RESOLVE`），而不是按固定优先级表。
 *
 * 改前按表序（`import` 先于 `default`）⇒ `{ default, import }` 这种声明顺序下
 * 引擎取 `import` 构建、宿主取 `default` 构建 ⇒ 双向判反（假绿 + 假红）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveNpmJsEntryDetailed } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

function makePkg(exportsField: unknown, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-239-");
  writeTmpFiles(dir, {
    "node_modules/dual/package.json": JSON.stringify({
      name: "dual",
      exports: exportsField,
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/dual/${rel}`, content]),
    ),
  });
  return { dir, pkgDir: join(dir, "node_modules", "dual") };
}

describe("BUG-239 — exports 条件键按声明顺序挑选", () => {
  it("`default` 声明在 `import` 之前 ⇒ 宿主取 default（引擎同结论）", () => {
    const { dir, pkgDir } = makePkg(
      { ".": { default: "./default.js", import: "./esm.mjs" } },
      { "default.js": "module.exports = {};\n", "esm.mjs": "export default {};\n" },
    );
    expect(resolveNpmJsEntryDetailed("dual", dir, "import").path).toBe(
      join(pkgDir, "default.js"),
    );
  });

  it("`import` 声明在前 ⇒ 取 import 构建（反向单变量对照）", () => {
    const { dir, pkgDir } = makePkg(
      { ".": { import: "./esm.mjs", default: "./default.js" } },
      { "default.js": "module.exports = {};\n", "esm.mjs": "export default {};\n" },
    );
    expect(resolveNpmJsEntryDetailed("dual", dir, "import").path).toBe(
      join(pkgDir, "esm.mjs"),
    );
  });

  it("require 面同理：`default` 先声明 ⇒ 取 default（不按表序重排）", () => {
    const { dir, pkgDir } = makePkg(
      { ".": { default: "./default.js", require: "./cjs.cjs" } },
      { "default.js": "module.exports = {};\n", "cjs.cjs": "module.exports = {};\n" },
    );
    expect(resolveNpmJsEntryDetailed("dual", dir, "require").path).toBe(
      join(pkgDir, "default.js"),
    );
  });
});
