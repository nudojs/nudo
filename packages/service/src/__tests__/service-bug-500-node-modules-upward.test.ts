/**
 * Bug 500 回归：裸包 `node_modules` 查找必须**逐级向上**
 * （Node 语义：每层 node_modules 都试一遍，包不在本层就继续往上）——
 * 改前只取「第一个存在的 node_modules 目录」，包只装在父级时 JS 入口不解析
 * ⇒ 回落 @types harvest ⇒ L2 门禁由红转绿。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveNpmJsEntryDetailed, resolveNpmNudo } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

/** 父级安装：app/node_modules 存在但**不含**该包；包在上一级 node_modules。 */
function parentInstall(prefix: string): { dir: string; appDir: string; pkgDir: string } {
  const dir = tmpProject(prefix);
  writeTmpFiles(dir, {
    "node_modules/mypkg/package.json": JSON.stringify({
      name: "mypkg",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/mypkg/index.js": "export function hello() { throw new Error('boom'); }\n",
    "app/node_modules/.keep": "",
    "app/main.js": "import { hello } from 'mypkg';\nexport function go() { return hello(); }\n",
  });
  return {
    dir,
    appDir: join(dir, "app"),
    pkgDir: join(dir, "node_modules", "mypkg"),
  };
}

describe("Bug 500 — node_modules 逐级向上查找", () => {
  it("包只装在父级 node_modules ⇒ JS 入口照样解析（不再回落 @types）", () => {
    const { appDir, pkgDir } = parentInstall("nudo-500-parent-");
    const r = resolveNpmJsEntryDetailed("mypkg", appDir);
    expect(r.path).toBe(join(pkgDir, "index.js"));
    expect(r.exportsUnresolved).toBe(false);
  });

  it("就近安装优先于父级安装（最近的一层胜出）", () => {
    const { dir, appDir } = parentInstall("nudo-500-nearest-");
    writeTmpFiles(dir, {
      "app/node_modules/mypkg/package.json": JSON.stringify({
        name: "mypkg",
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
      "app/node_modules/mypkg/index.js": "export function hello() { return 42; }\n",
    });
    expect(resolveNpmJsEntryDetailed("mypkg", appDir).path).toBe(
      join(appDir, "node_modules", "mypkg", "index.js"),
    );
  });

  it("侧车解析同口径（resolveNpmNudo 也逐级向上）", () => {
    const dir = tmpProject("nudo-500-nudo-");
    writeTmpFiles(dir, {
      "node_modules/side/package.json": JSON.stringify({
        name: "side",
        version: "1.0.0",
        exports: { ".": { nudo: "./index.nudo.js" } },
      }),
      "node_modules/side/index.nudo.js": "export const x = 1;\n",
      "app/node_modules/.keep": "",
    });
    expect(resolveNpmNudo("side", join(dir, "app"))).toBe(
      join(dir, "node_modules", "side", "index.nudo.js"),
    );
  });

  it("负控制：包根本没装 ⇒ miss（不报 exportsUnresolved）", () => {
    const dir = tmpProject("nudo-500-absent-");
    writeTmpFiles(dir, { "app/main.js": "export const x = 1;\n" });
    const r = resolveNpmJsEntryDetailed("nosuchpkg", join(dir, "app"));
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(false);
  });
});
