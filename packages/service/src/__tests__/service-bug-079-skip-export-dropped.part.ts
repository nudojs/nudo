/**
 * BUG-079 —— `@nudo:skip`（未声明返回类型）让 export 面把**整条导出静默丢掉**
 * （`.d.ts` 里该函数不存在，exit 0 零警告），而 `nudo check`（core）为同一
 * 函数合成 `any` ⇒ 两面相反 + 消费端 `import` TS2305。
 *
 * 修法：`combinedAbs == null` 分支不再返回空行，投影成 `(...args: unknown[]): any`。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../emit/dts-generator.ts";

describe("BUG-079 —— skipped 导出不得从产物里消失", () => {
  it("skip 且未声明返回 ⇒ 仍然声明成 any（与 check 面同源）", () => {
    const dts = generateDts(
      analyzeFile(
        "/test/bug079.js",
        `/**\n * @nudo:skip\n */\nexport function boom(a) {\n  return a;\n}\n`,
      ),
    );
    expect(dts).toContain("export declare function boom(...args: unknown[]): any;");
  });

  it("对照组：未 skip 的普通函数仍然走推断面（不受本修法影响）", () => {
    const dts = generateDts(
      analyzeFile("/test/bug079b.js", `export function plain(a) {\n  return a + 1;\n}\nplain(1);\n`),
    );
    expect(dts).toMatch(/export declare function plain\(/);
    expect(dts).not.toContain("export declare function plain(...args: unknown[]): any;");
  });
});
