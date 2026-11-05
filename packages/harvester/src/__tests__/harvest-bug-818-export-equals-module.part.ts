/**
 * Bug 818 回归（harvester 收割面）：`export = <本地类/常量>`（@types/node 的 CJS 形态）
 * ⇒ **整个模块记录不生成**（`ctx.skipped++` 静默丢弃）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/ts-oracle/）：
 * - `declare class Buffer { … }; declare module "buffer" { export = Buffer; }`
 *   ⇒ `import B from "./cls.js"` 合法（默认导入拿到类）；
 *   `import { Buffer } from "./cls.js"` 是 **TS2595**（`'Buffer' can only be imported by
 *   using a default import`）⇒ 导出表**不得**提供具名导出 `Buffer`（否则假绿）。
 *
 * 契约：
 *   1. 模块记录**生成**，`default` = 被导出实体的值；
 *   2. 不生成具名导出 `Buffer`（TS 侧 TS2595）；
 *   3. 东西不再被丢 ⇒ `stats.skipped` 不再因为它而涨（汇总行如实反映）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug818-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("Bug 818 —— `declare module \"x\" { export = <本地类> }` 生成模块记录", () => {
  it("模块记录生成，default = 被导出实体的值，且不产生具名导出", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare class Buffer { static from(s: string): Buffer; length: number; }
declare module "buffer" { export = Buffer; }
`,
    );
    const env = harvestDts([p]);
    const rec = env.modules["buffer"];
    expect(rec).toBeDefined();
    expect(rec!["default"]).toBeDefined();
    // TS 侧 `import { Buffer }` 是 TS2595 ⇒ 不得有具名导出
    expect(rec!["Buffer"]).toBeUndefined();
    // 不再静默丢弃 ⇒ skipped 不因它而涨
    expect(env.stats.skipped).toBe(0);
  });

  it("`export = <本地常量>` ⇒ default 是那个常量的值", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare const version: string;
declare module "ver" { export = version; }
`,
    );
    const env = harvestDts([p]);
    const rec = env.modules["ver"]!;
    expect(formatShape(rec["default"]!)).toBe("string");
    expect(env.stats.skipped).toBe(0);
  });

  it("解析不出来的 `export = <未知名字>` ⇒ 计入 skipped（汇总行有信号）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare module "mystery" { export = notDeclaredAnywhere; }
`,
    );
    const env = harvestDts([p]);
    expect(env.stats.skipped).toBeGreaterThan(0);
  });
});
