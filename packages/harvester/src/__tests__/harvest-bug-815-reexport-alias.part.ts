/**
 * Bug 815 回归（harvester 收割面）：`export { X as Y }`（本地改名再导出）被**整条丢弃**
 * ⇒ 改名后的导出根本不存在（假警告）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h4/）：
 * - `declare function foo(): number; export { foo as bar };` ⇒ 模块导出面是 `["bar"]`
 *   （`bar` 是**运行时值**，`foo` 只是局部名 ⇒ 不在导出面里）。
 * - `export { foo as default }` ⇒ 默认导入拿得到 `foo`。
 *
 * 契约：改名后的导出名必须进导出表，且拿到的是**局部绑定的值**（不是 unknown）。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug815-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("Bug 815 —— `export { X as Y }` 不再整条丢弃", () => {
  it("函数改名再导出 ⇒ 导出表里有 `bar`，值是局部绑定的签名", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare function foo(): number;\nexport { foo as bar };\n`,
    );
    const env = harvestDts([p]);
    expect(env.globals["bar"]).toBeDefined();
    expect(formatShape(env.globals["bar"]!)).toBe("() => number");
    // 不是 unknown：改名后的导出必须真的解析到局部绑定
    expect(formatShape(env.globals["bar"]!)).not.toBe("unknown");
    expect(env.stats.skipped).toBe(0);
  });

  it("`export { X as default }` ⇒ default 拿得到局部绑定", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare function foo(): number;\nexport { foo as default };\n`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["default"]!)).toBe("() => number");
  });

  it("const 改名再导出 ⇒ 导出表里是局部常量的类型", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare const size: number;\nexport { size as width };\n`,
    );
    const env = harvestDts([p]);
    expect(env.globals["width"]).toBeDefined();
    expect(formatShape(env.globals["width"]!)).toBe("number");
  });

  it("`export type { X }`（类型位导出）不是运行时值 ⇒ 不进导出表，且计入 skipped", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Shape { size: number; }\nexport type { Shape as Renamed };\n`,
    );
    const env = harvestDts([p]);
    expect(env.globals["Renamed"]).toBeUndefined();
    expect(env.stats.skipped).toBeGreaterThan(0);
  });
});
