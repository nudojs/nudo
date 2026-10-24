/**
 * Bug 361：bigint 字面量丢 n 后缀 ⇒ 诊断文本里 10n 与 10 不可区分。
 *
 * `String(10n) === "10"` ⇒ `lit(10n)` 渲染成 `lit(10)`（读起来是 number
 * 字面量 10 —— 另一条契约）。修法：展示面（`termToString` /
 * `interface.ts` 的 `litToString`）保 n 后缀，与 `format.ts` 的 prim bigint
 * 渲染同口径；**键通道**（`litKeyString`）不动——那里 bigint 靠 typeof
 * 前缀分开。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue, termToString, lit } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache } from "../refine.ts";
import { resetSidecarLoadFailureCache } from "../interface.ts";
import { makeFiles } from "./nudo-constraints.ts";

describe("Bug 361 bigint 字面量保 n 后缀", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    resetNudoModuleExecCache();
    resetSidecarLoadFailureCache();
  });

  it("termToString：bigint 保 n 后缀，number 不受影响", () => {
    expect(termToString(lit(10n))).toBe("10n");
    expect(termToString(lit(10))).toBe("10");
    expect(termToString(lit(0n))).toBe("0n");
  });

  it("诊断文本：lit(10n) 与 lit(10) 可区分", () => {
    const { loadModule } = makeFiles({
      "/t/big.nudo.js": `import { fn, lit } from "@nudojs/core";\nexport const g = fn({ n: lit(10n) }, lit(10n));`,
    });
    const src = `export function g(n) { return 10; }`;
    const r = checkSource("/t/big.js", src, pTrue, {
      loadModule,
      fromFile: "/t/big.js",
    });
    const violated = r.issues.filter((i) => i.code === "nudo:constraint-violated");
    expect(violated).toHaveLength(1);
    expect(violated[0]!.message).toContain("lit(10n)");
    expect(violated[0]!.message).not.toContain("lit(10)");
  });
});
