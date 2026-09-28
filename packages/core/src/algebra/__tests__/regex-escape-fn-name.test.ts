/**
 * 函数名进 RegExp 前必须转义。回归背景：
 * `$fn` 的 `$` 被当成行尾锚点 → `export default $fn` 匹配不上；
 * `Store.get` 的 `.` 匹配任意字符 → `export default StoreXget` 误命中。
 * 同类：check-signatures 的 isDefaultExportName / 形参计数正则。
 */
import { describe, it, expect } from "vitest";
import { isDefaultExportName } from "../check-signatures.ts";
import { effectiveInterface } from "../interface.ts";

describe("regex-metachar function names", () => {
  it("isDefaultExportName matches $fn default export", () => {
    expect(isDefaultExportName(`export default $fn;`, "$fn")).toBe(true);
    expect(isDefaultExportName(`export default function $fn(x) { return x; }`, "$fn")).toBe(true);
  });

  it("isDefaultExportName does not treat $ as end anchor", () => {
    // `$fn` 不得要求「串尾后再出现 fn」
    expect(isDefaultExportName(`export default $fnx;`, "$fn")).toBe(false);
    expect(isDefaultExportName(`export default fn;`, "$fn")).toBe(false);
  });

  it("isDefaultExportName treats . in Class.method literally", () => {
    expect(isDefaultExportName(`export default Store.get;`, "Store.get")).toBe(true);
    // `.` 不得匹配任意字符
    expect(isDefaultExportName(`export default StoreXget;`, "Store.get")).toBe(false);
    expect(isDefaultExportName(`export default Store-get;`, "Store.get")).toBe(false);
  });

  it("sidecar default bind works for $fn via export { $fn as default }", () => {
    const src = `function $fn(x) {\n  return x;\n}\nexport { $fn as default };\n`;
    const loadModule = (spec: string): string | undefined => {
      if (spec.includes("nudo")) return `export default fn({ x: number().int() });`;
      return undefined;
    };
    const r = effectiveInterface(src, "$fn", { loadModule, fromFile: "/t/add.js" });
    expect(r).toBeDefined();
  });
});
