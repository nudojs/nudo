/**
 * 函数名进 RegExp 前必须转义，且标识符边界必须是 lookaround 而非 `\b`。
 * 回归背景：
 * `$fn` 的 `$` 被当成行尾锚点 → `export default $fn` 匹配不上；
 * `Store.get` 的 `.` 匹配任意字符 → `export default StoreXget` 误命中；
 * `\b` 的「词」是 `[A-Za-z0-9_]`，而 JS 标识符含 `$` ——
 * `foo$` 串尾 `\b` 不成立（漏报）、`$fn$` 的 `$fn` 后有 `\b`（误报）。
 * 同类：check-signatures 的 isDefaultExportName / 形参计数正则。
 */
import { describe, it, expect } from "vitest";
import {
  estimateEntryParamCount,
  isDefaultExportName,
} from "../check-signatures.ts";
import { parseSource } from "../parse-source.ts";
import { effectiveInterface } from "../interface.ts";
import { extractRefinesFromSource } from "../refine.ts";

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

describe("JS ident boundary lookaround (not \\b)", () => {
  it("isDefaultExportName: $-suffixed name hits, prefix does not", () => {
    // `foo$` 串尾 `$` 是非词字符，`\b` 不成立 → 旧版漏报
    expect(isDefaultExportName(`export default foo$`, "foo$")).toBe(true);
    expect(isDefaultExportName(`export default function foo$(x) { return x; }`, "foo$")).toBe(true);
    // `foo` 是 `foo$` 的前缀，不得命中
    expect(isDefaultExportName(`export default foo`, "foo$")).toBe(false);
  });

  it("isDefaultExportName: $fn$ must not match $fn", () => {
    // `n|$` 之间是 `\b`，旧版把 `$fn$` 认成 `$fn`
    expect(isDefaultExportName(`export default $fn$`, "$fn")).toBe(false);
    expect(isDefaultExportName(`export default $fn`, "$fn")).toBe(true);
  });

  it("estimateEntryParamCount: no left-boundary bleed from longer ident", () => {
    // `alf` 的尾巴 `f` 不得被当成名字 `f`（否则报 2，实际 `f` 不存在 → 兜底 1）
    const src = `const alf = (x,y) => {}`;
    expect(estimateEntryParamCount(src, "f", parseSource(src))).not.toBe(2);
    // 同理：`self` 的尾巴 `f` 不得命中 3 参
    const selfSrc = `const self = (x,y,z) => {}`;
    expect(estimateEntryParamCount(selfSrc, "f", parseSource(selfSrc))).not.toBe(3);
    // 正例：真名仍命中
    const ok = `const f = (x,y) => {}`;
    expect(estimateEntryParamCount(ok, "f", parseSource(ok))).toBe(2);
  });

  it("refine: $-suffixed fn name finds its @nudo:contract line", () => {
    // `function on$` 的 `on$` 结尾 `$` + `\b` 找不到函数 → 契约静默失效
    const src = `/// @nudo:import { ms } from "./x.nudo.js"\n/**\n * @nudo:contract x ms\n */\nfunction on$(x) {\n  return x;\n}\n`;
    const loadModule = (spec: string): string | undefined => {
      if (spec.includes("nudo")) return `export const ms = number().gt(0);`;
      return undefined;
    };
    const reqs = extractRefinesFromSource(src, "on$", { loadModule, fromFile: "/t/demo.js" });
    expect(reqs.length).toBe(1);
    expect(reqs[0]!.param).toBe("x");
  });
});
