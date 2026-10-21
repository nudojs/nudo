/**
 * Bug 824 回归（harvester 收割面）：模块级 `.d.ts` **顶层的 CJS `export = X`** 整个被丢弃
 * ⇒ 该包**没有 `default` 导出** ⇒ ESM 默认导入（`import _ from "pkg"`）落 `unknown` + 假警告。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/ts-oracle/use-default.ts，tsc exit=0）：
 * - `export = _; declare const _: _.LoDashStatic;` ⇒ `import _ from "./cjs.js"` 合法
 *   （开 `allowSyntheticDefaultImports`），默认导入拿到 `_` 的类型。
 * - Node 的 cjs↔esm 互操作：`module.exports = _` ⇒ ESM 侧 `default` = `_`。
 *
 * 契约：
 *   1. 顶层 `export = X` ⇒ 收割面的 `default` = X 的值；
 *   2. 桥接层把它提升成包的 `default` 导出（默认导入不再是 unknown）；
 *   3. 不再静默丢弃 ⇒ `stats.skipped` 不因它而涨。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";
import { packageHarvestToAbsModules } from "../harvest-to-abs.ts";
import type { PackageHarvest } from "../harvest-package.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug824-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

function pkgOf(pkg: string, file: string): PackageHarvest {
  return { pkg, root: join(file, ".."), dtsFiles: [file], env: harvestDts([file]) };
}

describe("Bug 824 —— 顶层 `export = X` 进 default 导出", () => {
  it("顶层 `export = _` ⇒ 收割面有 default（值 = _ 的类型）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export = _;
declare const _: _.LoDashStatic;
declare namespace _ {
  interface LoDashStatic {
    uniq(xs: number[]): number[];
  }
}
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(formatShape(env.globals["default"]!)).toBe("LoDashStatic");
    expect(env.stats.skipped).toBe(0);
  });

  it("桥接层把顶层 `export =` 提升成包的 default 导出（默认导入不再是 unknown）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export = _;
declare const _: _.LoDashStatic;
declare namespace _ {
  interface LoDashStatic {
    uniq(xs: number[]): number[];
  }
}
`,
    );
    const mods = packageHarvestToAbsModules("fx", pkgOf("fx", p));
    expect(mods["fx"]?.default).toBeDefined();
    expect(formatShape(mods["fx"]!.default!)).toBe("LoDashStatic");
  });

  it("顶层 `export = <本地类>` ⇒ default 是构造签名", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export = Widget;
declare class Widget { size: number; }
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["default"]).toBeDefined();
    expect(env.stats.skipped).toBe(0);
  });
});
