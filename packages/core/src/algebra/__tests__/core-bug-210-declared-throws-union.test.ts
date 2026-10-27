/**
 * BUG-210：源码 `@nudo:throws TypeError` **遮蔽**侧车 `fn(..., { throws })`
 * ⇒ 门禁只认源码声明、整份侧车声明被丢弃 ⇒ 已申报的 `RangeError` 仍报
 * 「未申报」（假红）；**删掉源码那一行**同样的文件立刻变绿 ⇒ 非单调。
 *
 * 接口模型（`interface.ts` 的 `mergedThrows`）算的是**并集** ⇒ 两个模型对
 * 同一份声明给出相反答案。修法 = 门禁侧改读**同一口径**（并集，`*` 优先）。
 *
 * 钉：源码 + 侧车同时声明 ⇒ 绿；删掉源码那行结论不变（幂等 / 单调）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { takeInterfaceDiags } from "../interface.ts";
import { takeRefineDiags } from "../refine.ts";

function check(src: string) {
  return checkSource("/t/use.js", src, pTrue, {
    loadModule: (spec: string) =>
      spec.includes("use.nudo")
        ? `import { fn, number } from "@nudojs/core";\nexport const use = fn({ x: number() }, number(), { throws: "RangeError" });\n`
        : undefined,
    fromFile: "/t/use.js",
  });
}

const BODY = `
export function use(x) {
  if (x < 0) throw new RangeError("bad");
  return x;
}
`;

describe("BUG-210 申报集合 = 源码 ∪ 侧车（并集口径）", () => {
  beforeEach(() => {
    resetCheckSourceMemo();
    resetGeneralizeMemo();
    takeInterfaceDiags();
    takeRefineDiags();
  });

  it("源码 @nudo:throws TypeError + 侧车 throws RangeError ⇒ 绿（RangeError 已申报）", () => {
    const r = check(`
/**
 * @nudo:throws TypeError
 */
${BODY}`);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("删掉源码那一行 ⇒ 结论不变（单调 / 幂等）", () => {
    const withSrc = check(`
/**
 * @nudo:throws TypeError
 */
${BODY}`);
    const without = check(BODY);
    expect(withSrc.ok).toBe(without.ok);
    expect(
      withSrc.issues.filter((i) => i.code === "nudo:entry-may-throw").length,
    ).toBe(without.issues.filter((i) => i.code === "nudo:entry-may-throw").length);
  });

  it("两侧都没申报 RangeError ⇒ 仍报红（放行不是无条件的）", () => {
    const r = checkSource(
      "/t/use.js",
      `
/**
 * @nudo:throws TypeError
 */
${BODY}`,
      pTrue,
      {
        loadModule: (spec: string) =>
          spec.includes("use.nudo")
            ? `import { fn, number } from "@nudojs/core";\nexport const use = fn({ x: number() }, number(), { throws: "TypeError" });\n`
            : undefined,
        fromFile: "/t/use.js",
      },
    );
    const issue = r.issues.find((i) => i.code === "nudo:entry-may-throw");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("RangeError");
  });
});
