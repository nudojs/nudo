/**
 * Bug 400 —— rest 形参的调用点执法：实参必须**聚合成数组**再与契约比。
 *
 * 根因：`locateContractParam` 算出了 `rest: true`，但 `scan-literal-calls.ts`
 * 的 `entries.push` **没把它带进**（`RefineEntry`）⇒ 下游无从知道要聚合；
 * 执法侧的实参映射又是**恒等**（`(i) => i`）⇒ rest 形参拿到的是**首个**
 * 实参 ⇒ 合法调用 `sum(1, 2)` 被判「实参 1 ⊭ array 约束」（假红），且报出
 * 的实参值也是错的（`1` 而不是 `[1, 2]`）。
 *
 * 修法（族 08 · AGENT-CONTEXT §4 裁决）：标志要**透传** + 执法侧按 rest
 * 聚合实参（该位之后的全部实参 → 精确元组 Abs）。
 *
 * 反向钉：HEAD（未修）上 `sum(1, 2)` 报违例 ⇒ 本文件在 HEAD 上**必失败**。
 */
import { describe, it, expect } from "vitest";
import { checkSource, resetCheckSourceMemo } from "../check.ts";
import { pTrue } from "../pred.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { makeFiles } from "./nudo-constraints.ts";

const SIDECAR = `import { fn, number, array } from "@nudojs/core";
export const sum = fn({ nums: array(number().gt(0)) }, number());
`;

const SUM = `export function sum(...nums) {
  let s = 0;
  for (const n of nums) s += n;
  return s;
}
`;

/** 调用点违例（nudo:constraint-violated）——每次只放**一个**调用点 */
function violated(callSrc: string): Array<{ message: string; actual?: string; expected?: string }> {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  const { loadModule } = makeFiles({ "/t/sum.nudo.js": SIDECAR });
  const r = checkSource("/t/sum.js", `${SUM}${callSrc}`, pTrue, {
    loadModule,
    fromFile: "/t/sum.js",
    autoBind: true,
  });
  return r.issues.filter((i) => i.code === "nudo:constraint-violated");
}

describe("Bug 400 rest 形参的实参聚合", () => {
  it("合法调用 sum(1, 2) 不报违例（rest 实参聚合成 [1, 2] 再与 array 契约比）", () => {
    expect(violated("export function g() { return sum(1, 2); }\n").length).toBe(0);
  });

  it("sum(1, -2) 报违例，且 actual 是整个聚合值 [1, -2]（不是首个实参 1）", () => {
    const v = violated("export function h() { return sum(1, -2); }\n");
    expect(v.length).toBe(1);
    expect(v[0]!.message).toContain("sum");
    expect(v[0]!.actual).toContain("[1, -2]");
    expect(v[0]!.expected).toContain("nums");
  });
});
