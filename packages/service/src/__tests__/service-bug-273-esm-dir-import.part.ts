/**
 * BUG-273 回归：包内文件候选**不能**无条件补 `index.*`。
 *
 * Node 的 **ESM** 装载器从不做目录 / index 解析 ⇒ `exports` 目标或旧式子路径
 * 指向目录时宿主抛 `ERR_UNSUPPORTED_DIR_IMPORT`（模块根本加载不上）；
 * 只有 **legacy `main`** 语境允许 index 解析。
 *
 * 改前一律补 index 候选 ⇒ 引擎解析到 `dir/index.js` ⇒ 门禁假绿 + 自信的错值。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveNpmJsEntryDetailed } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

function makePkg(pkgJson: Record<string, unknown>, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-273-");
  writeTmpFiles(dir, {
    "node_modules/vp/package.json": JSON.stringify({ name: "vp", type: "module", ...pkgJson }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/vp/${rel}`, content]),
    ),
  });
  return { dir, pkgDir: join(dir, "node_modules", "vp") };
}

describe("BUG-273 — ESM 下禁止目录导入（不补 index 候选）", () => {
  it("`exports` 目标指向目录 ⇒ 不可用（宿主 ERR_UNSUPPORTED_DIR_IMPORT）+ 诊断记账", () => {
    const { dir } = makePkg({ exports: { ".": "./dir" } }, {
      "dir/index.js": "export const v = 'DIRIDX';\n",
    });
    const r = resolveNpmJsEntryDetailed("vp", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("旧式 ESM 子路径指向目录 ⇒ 同样不可用", () => {
    const { dir } = makePkg({ main: "./index.js" }, {
      "index.js": "export const v = 1;\n",
      "dir/index.js": "export const v = 'DIRIDX';\n",
    });
    const r = resolveNpmJsEntryDetailed("vp/dir", dir);
    expect(r.path).toBeNull();
  });

  it("对照组：`exports` 目标显式指向文件 ⇒ 正常解析", () => {
    const { dir, pkgDir } = makePkg({ exports: { ".": "./dir/index.js" } }, {
      "dir/index.js": "export const v = 'DIRIDX';\n",
    });
    expect(resolveNpmJsEntryDetailed("vp", dir).path).toBe(join(pkgDir, "dir", "index.js"));
  });

  it("对照组：legacy `main` 指向目录 ⇒ Node 允许 index 解析", () => {
    const { dir, pkgDir } = makePkg({ main: "./dir" }, {
      "dir/index.js": "export const v = 'DIRIDX';\n",
    });
    expect(resolveNpmJsEntryDetailed("vp", dir).path).toBe(join(pkgDir, "dir", "index.js"));
  });
});
