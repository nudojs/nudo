/**
 * BUG-268 回归：包目录遍历必须区分「本层**没有**该包」（可继续向上）与
 * 「本层**有**该包但 `exports` 不认这个子路径」（Node 直接
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`，**不得**继续向上找同名副本）。
 *
 * 改前继续向上 ⇒ 解析到运行时永不加载的父级副本 ⇒ 门禁假绿，且
 * `exportsUnresolved` 被清零 ⇒ `nudo:exports-unresolved` 诊断被吞。
 */
import { describe, it, expect } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { resolveNpmJsEntryDetailed } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

function nested(nearExports: Record<string, string>, parentHasSub: boolean): string {
  const dir = tmpProject("nudo-268-");
  const parentExports: Record<string, string> = { ".": "./index.js" };
  if (parentHasSub) parentExports["./sub"] = "./sub.js";
  writeTmpFiles(dir, {
    "app/node_modules/nearpkg/package.json": JSON.stringify({
      name: "nearpkg",
      type: "module",
      exports: nearExports,
    }),
    "app/node_modules/nearpkg/index.js": "export const v = 'NEAR';\n",
    "node_modules/nearpkg/package.json": JSON.stringify({
      name: "nearpkg",
      type: "module",
      exports: parentExports,
    }),
    "node_modules/nearpkg/index.js": "export const v = 'PARENT';\n",
    "node_modules/nearpkg/sub.js": "export const v = 'PARENT';\n",
    "app/probe.mjs": "import v from 'nearpkg/sub';\nexport function use() { return v; }\n",
  });
  return dir;
}

describe("BUG-268 — 最近的包 exports 拒绝 ⇒ 不得上溯到同名副本", () => {
  it("就近层 exports 无 './sub' 而父级副本有 ⇒ 必须判不可用（不解析到父级副本）", () => {
    const dir = nested({ ".": "./index.js" }, true);
    const r = resolveNpmJsEntryDetailed("nearpkg/sub", join(dir, "app"));
    expect(r.path).toBeNull();
    // 唯一能暴露该事实的诊断必须在场（旧实现清零 ⇒ 诊断被吞）
    expect(r.exportsUnresolved).toBe(true);
  });

  it("对照组：本层没有该包 ⇒ 继续向上并正常解析（合法提升）", () => {
    const dir = nested({ ".": "./index.js" }, true);
    // 删掉就近那份包后，向上找到父级副本是**正确**行为
    rmSync(join(dir, "app", "node_modules", "nearpkg"), { recursive: true, force: true });
    const r = resolveNpmJsEntryDetailed("nearpkg/sub", join(dir, "app"));
    expect(r.path).toBe(join(dir, "node_modules", "nearpkg", "sub.js"));
    expect(r.exportsUnresolved).toBe(false);
  });

  it("就近层命中时绝不上溯（近层胜出）", () => {
    const dir = nested({ ".": "./index.js", "./sub": "./index.js" }, true);
    const r = resolveNpmJsEntryDetailed("nearpkg/sub", join(dir, "app"));
    expect(r.path).toBe(join(dir, "app", "node_modules", "nearpkg", "index.js"));
  });
});
