/**
 * BUG-270 回归：`exports` **目标数组**的回退判据只能是「目标**非法**」
 * （Node `ERR_INVALID_PACKAGE_TARGET`），**不得**用「文件是否存在」。
 *
 * Node 语义：目标合法但文件缺失时解析就停在这个目标上，随后装载阶段抛
 * `ERR_MODULE_NOT_FOUND`；旧实现跳过缺失目标、取下一个存在的文件
 * ⇒ 解析到与宿主不同的文件 ⇒ 门禁假绿 + 自信的错值。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveNpmJsEntryDetailed } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

function makePkg(exportsField: unknown, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-270-");
  writeTmpFiles(dir, {
    "node_modules/vp/package.json": JSON.stringify({
      name: "vp",
      type: "module",
      exports: exportsField,
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/vp/${rel}`, content]),
    ),
    "probe.mjs": "import v from 'vp/sub';\nexport function use() { return v; }\n",
  });
  return { dir, pkgDir: join(dir, "node_modules", "vp") };
}

describe("BUG-270 — exports 目标数组：只有非法目标才回退", () => {
  it("首个目标**合法但缺失** ⇒ 停在该目标（不可用 + 记账），不得取下一个存在的文件", () => {
    const { dir } = makePkg({ "./sub": ["./missing.js", "./real.js"] }, {
      "real.js": "export const v = 'ARRAY_REAL';\nexport default v;\n",
    });
    const r = resolveNpmJsEntryDetailed("vp/sub", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("嵌套在条件对象里的数组同款（{ import: [...] }）", () => {
    const { dir } = makePkg(
      { "./sub": { import: ["./missing.js", "./real.js"], default: "./real.js" } },
      { "real.js": "export const v = 'REAL';\nexport default v;\n" },
    );
    const r = resolveNpmJsEntryDetailed("vp/sub", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("对照组：首目标**非法**（逃出包目录）⇒ 回退到下一个合法目标", () => {
    const { dir, pkgDir } = makePkg({ "./sub": ["../outside.js", "./real.js"] }, {
      "real.js": "export const v = 'ARRAY_REAL';\nexport default v;\n",
    });
    const r = resolveNpmJsEntryDetailed("vp/sub", dir);
    expect(r.path).toBe(join(pkgDir, "real.js"));
    expect(r.exportsUnresolved).toBe(false);
  });

  it("对照组：首目标存在 ⇒ 取首目标", () => {
    const { dir, pkgDir } = makePkg({ "./sub": ["./a.js", "./b.js"] }, {
      "a.js": "export const v = 'A';\n",
      "b.js": "export const v = 'B';\n",
    });
    expect(resolveNpmJsEntryDetailed("vp/sub", dir).path).toBe(join(pkgDir, "a.js"));
  });
});
