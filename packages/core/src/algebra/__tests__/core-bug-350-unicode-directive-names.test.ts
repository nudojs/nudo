/**
 * Bug 350 回归：指令文法（`@nudo:assume` / `@nudo:invariant` / `@nudo:contract`
 * 目标名）用 ASCII 正则 ⇒ **中文标识符**被判 malformed ⇒ L1 假红；而侧车面
 * 把同一个中文名当一等公民 ⇒ 跨面自相矛盾。
 *
 * 修法：三条源码指令统一走 **JS 绑定名文法**（`isJsBindingIdent`，Unicode
 * 合法；`$x` 也合法）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  extractAssumeSegs,
  extractInvariantSegs,
  extractRefinesFromSource,
  setRefineDiagCollector,
  takeRefineDiags,
} from "../refine.ts";
import { makeFiles } from "./nudo-constraints.ts";

beforeEach(() => {
  setRefineDiagCollector(null);
  takeRefineDiags();
});

describe("Bug 350: Unicode 标识符的指令文法", () => {
  it("@nudo:assume 中文名 → 合法（不再是 malformed）", () => {
    const src = `
/**
 * @nudo:assume 小数 <= 大数
 */
export function 差(小数, 大数) {
  return 大数 - 小数;
}
`;
    const segs = extractAssumeSegs(src, "差");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ kind: "ok", lhs: "小数", rhs: "大数" });
  });

  it("@nudo:assume `>=` 仍翻转为 le（中文名同样成立）", () => {
    const src = `
/**
 * @nudo:assume 大数 >= 小数
 */
export function 差(小数, 大数) {
  return 大数 - 小数;
}
`;
    const segs = extractAssumeSegs(src, "差");
    expect(segs).toEqual([{ kind: "ok", lhs: "小数", rhs: "大数" }]);
  });

  it("@nudo:invariant 中文名 → 合法", () => {
    const src = `
/**
 * @nudo:invariant 计数 >= 0
 */
export function inc(计数) {
  return 计数 + 1;
}
`;
    const segs = extractInvariantSegs(src, "inc");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ kind: "ok", name: "计数", rel: "ge", value: 0 });
  });

  it("@nudo:invariant 中文路径段 → 合法", () => {
    const src = `
/**
 * @nudo:invariant 记录.计数 >= 0
 */
export function inc(记录) {
  return 记录;
}
`;
    const segs = extractInvariantSegs(src, "inc");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ kind: "ok", name: "记录" });
  });

  it("@nudo:contract 中文形参名 → 契约生效", () => {
    const src = `
/// @nudo:import { positive } from "./positive.nudo.js"
/**
 * @nudo:contract 计数 positive
 */
export function inc(计数) {
  return 计数 + 1;
}
`;
    const { loadModule } = makeFiles({
      "/t/positive.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(src, "inc", {
      loadModule,
      fromFile: "/t/cjk.js",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.param).toBe("计数");
  });

  it("@nudo:contract `$x` 形参名 → 合法（旧 ASCII 正则不收 `$`）", () => {
    const src = `
/// @nudo:import { positive } from "./positive.nudo.js"
/**
 * @nudo:contract $x positive
 */
export function inc($x) {
  return $x + 1;
}
`;
    const { loadModule } = makeFiles({
      "/t/positive.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(src, "inc", {
      loadModule,
      fromFile: "/t/dollar.js",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.param).toBe("$x");
  });

  it("非法的形参名仍被判 malformed（不放宽成任意串）", () => {
    const src = `
/// @nudo:import { positive } from "./positive.nudo.js"
/**
 * @nudo:contract x-y positive
 */
export function inc(x) {
  return x + 1;
}
`;
    const diags: Array<{ code: string; message: string }> = [];
    setRefineDiagCollector((d) => diags.push(d));
    const { loadModule } = makeFiles({
      "/t/positive.nudo.js": `import { number } from "@nudojs/core";\nexport const positive = number().gt(0);\n`,
    });
    const entries = extractRefinesFromSource(src, "inc", {
      loadModule,
      fromFile: "/t/bad.js",
    });
    expect(entries).toHaveLength(0);
    expect(
      diags.some((d) => d.code === "nudo:contract-syntax"),
    ).toBe(true);
  });
});
