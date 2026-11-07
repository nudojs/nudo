/**
 * Bug 835 — harvester 的「**包名键**」导出表 = **第一个 `declare module` 记录**，
 * 且**盖住包自身的顶层导出** ⇒ `import { x } from "pkg"` 拿到另一个模块的同名导出；
 * 子路径说明符又**回落**到包名键 ⇒ 两个方向都拿到**错的确切类型**，且**零诊断**。
 *
 * 修法：包名键只由**该包自己的顶层导出**占；模块记录只登记到自己的键；
 * 子路径说明符**不得**回落到包名键（宁可落 unknown，也不给错的确切类型）。
 *
 * oracle（`tsc --strict`）：包名 import ⇒ `string`；子路径 import ⇒ `number`。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFnImpl, type Abs } from "@nudojs/core";
import { harvestPackage } from "../harvest-package.ts";
import { bareSpecToAbsModules, packageHarvestToAbsModules } from "../harvest-to-abs.ts";

/** mock fn 的声明返回类型（relation 槽） */
function returnTypeOf(a: Abs | undefined): string {
  if (!a) return "<missing>";
  const rt = getFnImpl(a)?.relation?.returnType;
  if (!rt) return "<no-return>";
  const s = rt.shape as { k: string; type?: string };
  return s.k === "prim" ? (s.type ?? s.k) : s.k;
}

function writePkg(root: string, name: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, version: "1.0.0", types: "index.d.ts" }),
  );
  for (const [file, content] of Object.entries(files)) {
    const p = join(root, file);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
}

describe("Bug 835 — 包名键 = 该包自己的顶层导出；子路径不回落包名键", () => {
  let dir: string;
  let appDir: string;
  let prevCache: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-h7-b835-"));
    appDir = join(dir, "app");
    mkdirSync(appDir, { recursive: true });
    // 依赖缓存隔离（磁盘层不应污染夹具收割）
    prevCache = process.env.NUDO_DEPS_CACHE_DIR;
    process.env.NUDO_DEPS_CACHE_DIR = join(dir, "deps-cache");
    // 顶层导出 + 同名的 declare module 记录
    writePkg(join(dir, "node_modules", "shadowpkg"), "shadowpkg", {
      "index.d.ts": [
        "export declare function helper(): string;",
        "",
        'declare module "shadowpkg/sub" {',
        "  export function helper(): number;",
        "}",
        "",
      ].join("\n"),
    });
    // 根包与子路径文件各有同名导出
    writePkg(join(dir, "node_modules", "subpkg"), "subpkg", {
      "index.d.ts": "export declare function get(): string;\n",
      "fp.d.ts": "export declare function get(): number;\n",
    });
    // 只有根包（没有 fp.d.ts）⇒ 子路径无处可落
    writePkg(join(dir, "node_modules", "rootonly"), "rootonly", {
      "index.d.ts": "export declare function get(): string;\n",
    });
  });

  afterAll(() => {
    if (prevCache === undefined) delete process.env.NUDO_DEPS_CACHE_DIR;
    else process.env.NUDO_DEPS_CACHE_DIR = prevCache;
    rmSync(dir, { recursive: true, force: true });
  });

  it("包名键 = 包自身的顶层导出（不是 declare module 记录的同名导出）", () => {
    const h = harvestPackage("shadowpkg", appDir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    const table = packageHarvestToAbsModules("shadowpkg", h);
    // 包自身的顶层导出在（TS 侧 string）
    expect(returnTypeOf(table["shadowpkg"]?.named["helper"])).toBe("string");
    // declare module 记录仍然登记到**它自己的**键
    expect(returnTypeOf(table["shadowpkg/sub"]?.named["helper"])).toBe("number");
  });

  it("子路径说明符拿到子路径自己的导出（不是根包的）", () => {
    const spec = bareSpecToAbsModules("subpkg/fp", join(appDir, "sub.js"));
    expect(spec).toBeDefined();
    expect(returnTypeOf(spec?.named["get"])).toBe("number");
  });

  it("子路径说明符**不回落到包名键**（没有对应文件 ⇒ 落 unknown，不给根包的错值）", () => {
    const spec = bareSpecToAbsModules("rootonly/fp", join(appDir, "sub.js"));
    expect(spec).toBeUndefined();
    // 反向：根包键本身仍能解析到自己的导出（不误伤）
    const root = bareSpecToAbsModules("rootonly", join(appDir, "sub.js"));
    expect(returnTypeOf(root?.named["get"])).toBe("string");
  });
});
