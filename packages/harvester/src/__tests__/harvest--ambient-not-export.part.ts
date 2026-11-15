/**
 * Bug 1014 — harvester 的**桥接层把整个 globals 袋提升成包名键的具名导出**
 * ⇒ `declare global { … }` / **script 模式 `.d.ts`** 的 **ambient 声明变成「可导入的导出」**
 * ⇒ `import { <ambient> } from "pkg"` 解析成功 ⇒ **TS2305 / TS2306 零诊断**（**假绿**）。
 *
 * 修法：ambient 声明（`declare global { … }` / script 模式 `.d.ts` 的顶层声明）
 * **不得**进包名键；包名键只由**该包自己的顶层导出**占。
 *
 * oracle（`tsc --strict`）：TS2305（`declare global`）/ TS2306（script 模式）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestPackage } from "../harvest-package.ts";
import { bareSpecToAbsModules, packageHarvestToAbsModules } from "../harvest-to-abs.ts";

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

describe("Bug 1014 — ambient 声明不得变成包名键的具名导出", () => {
  let dir: string;
  let appDir: string;
  let prevCache: string | undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-h7-b1014-"));
    appDir = join(dir, "app");
    mkdirSync(appDir, { recursive: true });
    prevCache = process.env.NUDO_DEPS_CACHE_DIR;
    process.env.NUDO_DEPS_CACHE_DIR = join(dir, "deps-cache");
    // 形态①：`declare global { … }` 的 ambient 声明
    writePkg(join(dir, "node_modules", "globpkg"), "globpkg", {
      "index.d.ts": [
        "export declare function pub(): number;",
        "declare global {",
        "  function ambientHelper(): string;",
        "}",
        "",
      ].join("\n"),
    });
    // 形态②：script 模式 `.d.ts`（无任何 import/export ⇒ 顶层声明是全局 ambient）
    writePkg(join(dir, "node_modules", "scriptpkg"), "scriptpkg", {
      "index.d.ts": "declare function scriptAmbient(): string;\n",
    });
  });

  afterAll(() => {
    if (prevCache === undefined) delete process.env.NUDO_DEPS_CACHE_DIR;
    else process.env.NUDO_DEPS_CACHE_DIR = prevCache;
    rmSync(dir, { recursive: true, force: true });
  });

  it("`declare global` 的内容不进包名键（真实的导出仍在）", () => {
    const h = harvestPackage("globpkg", appDir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    // 收割层仍看得见 ambient（它确实在 globals 袋里）
    expect(Object.keys(h.env.globals)).toContain("ambientHelper");
    const table = packageHarvestToAbsModules("globpkg", h);
    // 但它**不是**包的具名导出 ⇒ `import { ambientHelper } from "globpkg"` 必须解析失败
    expect(Object.keys(table["globpkg"]?.named ?? {})).toEqual(["pub"]);
    const spec = bareSpecToAbsModules("globpkg", join(appDir, "glob.js"));
    expect(spec === undefined || spec.named["ambientHelper"] === undefined).toBe(true);
  });

  it("script 模式 `.d.ts` 的顶层声明不进包名键", () => {
    const h = harvestPackage("scriptpkg", appDir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    expect(Object.keys(h.env.globals)).toContain("scriptAmbient");
    const table = packageHarvestToAbsModules("scriptpkg", h);
    expect(Object.keys(table["scriptpkg"]?.named ?? {})).toEqual([]);
    const spec = bareSpecToAbsModules("scriptpkg", join(appDir, "script.js"));
    expect(spec === undefined || spec.named["scriptAmbient"] === undefined).toBe(true);
  });
});
