/**
 * Bug 833 — harvester 的**包根解析无条件优先 `@types/<pkg>`**
 * ⇒ 收割到陈旧的 @types 声明（另一个版本的 API）⇒ 签名错（string 折成 number）且**零诊断**。
 *
 * 口径（与 TypeScript / Node 一致）：
 * 1. 包本体 `node_modules/<pkg>` 的 `types`/`typings` → `<pkg>/index.d.ts`；
 * 2. **最后**才回落 `node_modules/@types/<pkg>`；
 * 3. 跨层查找时「任意层的包本体」先于「任意层的 @types」。
 *
 * oracle：`tsc --strict` 对同一夹具给 `string`（包自带的 2.x 声明）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFnImpl, type Abs } from "@nudojs/core";
import { harvestPackage, resolvePackageRoot } from "../harvest-package.ts";
import { packageHarvestToAbsModules } from "../harvest-to-abs.ts";

/** mock fn 的声明返回类型（relation 槽） */
function returnTypeOf(a: Abs | undefined): string {
  if (!a) return "<missing>";
  const rt = getFnImpl(a)?.relation?.returnType;
  if (!rt) return "<no-return>";
  const s = rt.shape as { k: string; type?: string };
  return s.k === "prim" ? (s.type ?? s.k) : s.k;
}

describe("Bug 833 — 包根解析：包自带 types 优先于同名 @types", () => {
  let dir: string;
  let pkgRoot: string;
  let typesRoot: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nudo-h7-b833-"));
    // 包自带 types（2.x，真 API）
    pkgRoot = join(dir, "node_modules", "mypkg");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(
      join(pkgRoot, "package.json"),
      JSON.stringify({ name: "mypkg", version: "2.0.0", types: "index.d.ts" }),
    );
    writeFileSync(join(pkgRoot, "index.d.ts"), "export declare function newApi(): string;\n");
    // 陈旧 @types（1.x）
    typesRoot = join(dir, "node_modules", "@types", "mypkg");
    mkdirSync(typesRoot, { recursive: true });
    writeFileSync(
      join(typesRoot, "package.json"),
      JSON.stringify({ name: "@types/mypkg", version: "1.0.0", types: "index.d.ts" }),
    );
    writeFileSync(join(typesRoot, "index.d.ts"), "export declare function newApi(): number;\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolvePackageRoot 命中包本体（不是同名 @types）", () => {
    expect(resolvePackageRoot("mypkg", dir)).toBe(pkgRoot);
  });

  it("收割到的是包自带那份声明（string，而不是 @types 的 number）", () => {
    const h = harvestPackage("mypkg", dir);
    expect("error" in h).toBe(false);
    if ("error" in h) return;
    expect(h.root).toBe(pkgRoot);
    expect(h.dtsFiles.every((f) => f.startsWith(pkgRoot))).toBe(true);
    const table = packageHarvestToAbsModules("mypkg", h);
    expect(returnTypeOf(table["mypkg"]?.named["newApi"])).toBe("string");
  });

  it("包本体没有声明时才回落 @types（lodash 形态不回归）", () => {
    const only = mkdtempSync(join(tmpdir(), "nudo-h7-b833-b-"));
    try {
      const t = join(only, "node_modules", "@types", "onlytypes");
      mkdirSync(t, { recursive: true });
      writeFileSync(
        join(t, "package.json"),
        JSON.stringify({ name: "@types/onlytypes", version: "1.0.0", types: "index.d.ts" }),
      );
      writeFileSync(join(t, "index.d.ts"), "export declare function onlyFn(): string;\n");
      expect(resolvePackageRoot("onlytypes", only)).toBe(t);
    } finally {
      rmSync(only, { recursive: true, force: true });
    }
  });
});
