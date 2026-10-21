/**
 * Bug 477 回归：裸包 `exports` 的**条件键必须按消费形态选**
 * （ESM `import` → "import" 条件；CJS `require` → "require" 条件）。
 *
 * 改前：一张固定顺序的表把 "require" 排在 "import" 前 ⇒ ESM import 解析到
 * 包的 CommonJS 构建（原生 5 / 引擎 {default:10,named:"cjs"}）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveNpmJsEntryDetailed } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

/** dual package：同一包发 .mjs（ESM 面）与 .cjs（CJS 面）两套构建。 */
function dualPkg(prefix: string): { dir: string; pkgDir: string } {
  const dir = tmpProject(prefix);
  writeTmpFiles(dir, {
    "node_modules/dual/package.json": JSON.stringify({
      name: "dual",
      version: "1.0.0",
      exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs", default: "./esm.mjs" } },
    }),
    "node_modules/dual/esm.mjs": "export default 5; export const named = 'esm';\n",
    "node_modules/dual/cjs.cjs": "module.exports = { default: 10, named: 'cjs' };\n",
  });
  return { dir, pkgDir: join(dir, "node_modules", "dual") };
}

describe("Bug 477 — exports 条件键按消费形态分表", () => {
  it("import 形态命中 import 条件（ESM 构建），不是 require 分支", () => {
    const { dir, pkgDir } = dualPkg("nudo-477-import-");
    const r = resolveNpmJsEntryDetailed("dual", dir, "import");
    expect(r.path).toBe(join(pkgDir, "esm.mjs"));
    expect(r.exportsUnresolved).toBe(false);
  });

  it("require 形态命中 require 条件（CJS 构建）", () => {
    const { dir, pkgDir } = dualPkg("nudo-477-require-");
    const r = resolveNpmJsEntryDetailed("dual", dir, "require");
    expect(r.path).toBe(join(pkgDir, "cjs.cjs"));
    expect(r.exportsUnresolved).toBe(false);
  });

  it("形态未给出时按 import → require 顺序尝试（ESM 构建优先）", () => {
    const { dir, pkgDir } = dualPkg("nudo-477-auto-");
    expect(resolveNpmJsEntryDetailed("dual", dir).path).toBe(join(pkgDir, "esm.mjs"));
  });

  it("负控制：只有 require 条件的包不被误判 miss（auto 兜底到 require 面）", () => {
    const dir = tmpProject("nudo-477-requireonly-");
    writeTmpFiles(dir, {
      "node_modules/onlyreq/package.json": JSON.stringify({
        name: "onlyreq",
        version: "1.0.0",
        exports: { ".": { require: "./index.cjs" } },
      }),
      "node_modules/onlyreq/index.cjs": "module.exports = 1;\n",
    });
    // import 面 miss（无 import/default 条件）→ auto 兜底 require 面命中
    expect(resolveNpmJsEntryDetailed("onlyreq", dir).path).toBe(
      join(dir, "node_modules", "onlyreq", "index.cjs"),
    );
    // 显式 import 形态则确实 miss（Node 同样 ERR_PACKAGE_PATH_NOT_EXPORTED）
    const strict = resolveNpmJsEntryDetailed("onlyreq", dir, "import");
    expect(strict.path).toBeNull();
    expect(strict.exportsUnresolved).toBe(true);
  });

  it("负控制：无条件键的包仍走 default（不因分表而 miss）", () => {
    const dir = tmpProject("nudo-477-default-");
    writeTmpFiles(dir, {
      "node_modules/plain/package.json": JSON.stringify({
        name: "plain",
        version: "1.0.0",
        exports: { ".": "./index.js" },
      }),
      "node_modules/plain/index.js": "export const x = 1;\n",
    });
    for (const mode of ["import", "require"] as const) {
      expect(resolveNpmJsEntryDetailed("plain", dir, mode).path).toBe(
        join(dir, "node_modules", "plain", "index.js"),
      );
    }
  });
});
