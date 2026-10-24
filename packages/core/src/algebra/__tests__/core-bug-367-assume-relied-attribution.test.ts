/**
 * Bug 367 回归钉 —— `nudo:assume-relied` 审计标注**误归因**。
 *
 * 症状：审计归因用的是「**函数上有没有**这条引理」这个代理量，而不是
 * 「**证明链上真正消费了**哪条引理」⇒ 只要返回契约证得（proof.status ===
 * "proved"）且函数带 `@nudo:assume`，就宣称「proved via @nudo:assume X」
 * ——哪怕函数体压根没用这条引理（`return 0` 也能"证得"）。
 *
 * 修法（族 07 片 S4）：代数核在**引理消费点**（div / sub 的同名相关性折叠）
 * 记「本次证明消费过的引理」，check 面取快照回传给审计标注 ⇒ 归因只认
 * **真正产出了界**的那条引理。
 *
 * 钉：
 * ① 引理未被消费 ⇒ **不得**出现 `nudo:assume-relied`（改前必然出现 ⇒ 反向闸红）；
 * ② 引理真被消费（`1 - d/max` 的相关性折叠）⇒ 仍要出现（不得把审计面砍空）；
 * ③ 两条引理只消费一条 ⇒ 只宣称消费过的那条。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

/** 侧车：`sim` 的返回契约 `number().ge(0).le(1)`，形参 d ≥ 0 / max ≥ 1 */
const sidecar = `import { fn, number } from "@nudojs/core";
export const sim = fn({ d: number().ge(0), max: number().ge(1) }, number().ge(0).le(1));
`;

const opts = (file: string) => ({
  loadModule: (spec: string): string | undefined =>
    spec.endsWith(".nudo.js") ? sidecar : undefined,
  fromFile: file,
});

describe("Bug 367 — assume-relied 归因只认真正消费过的引理", () => {
  it("① 引理未被消费（函数体不用它）⇒ 不得宣称 proved via @nudo:assume", () => {
    const r = checkSource(
      "/t/bug367-a.js",
      `
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1;
}
`,
      pTrue,
      opts("/t/bug367-a.js"),
    );
    // 返回契约仍证得（1 ∈ [0,1]）——但引理没参与 ⇒ 不得宣称依赖引理
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    expect(r.issues.some((i) => i.code === "nudo:assume-relied")).toBe(false);
  });

  it("② 引理真被消费（d/max 的相关性折叠）⇒ 仍要宣称（审计面不得砍空）", () => {
    const r = checkSource(
      "/t/bug367-b.js",
      `
/**
 * @nudo:assume d <= max
 */
export function sim(d, max) {
  return max === 0 ? 1 : 1 - d / max;
}
`,
      pTrue,
      opts("/t/bug367-b.js"),
    );
    expect(r.issues.some((i) => i.code === "nudo:constraint-violated")).toBe(false);
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.severity).toBe("info");
    expect(relied!.fn).toBe("sim");
    expect(relied!.message).toContain("proved via @nudo:assume d <= max");
  });

  it("③ 两条引理只消费一条 ⇒ 只宣称消费过的那条", () => {
    const r = checkSource(
      "/t/bug367-c.js",
      `
/**
 * @nudo:assume d <= max
 * @nudo:assume d <= lim
 */
export function sim(d, max, lim) {
  return max === 0 ? 1 : 1 - d / max;
}
`,
      pTrue,
      opts("/t/bug367-c.js"),
    );
    const relied = r.issues.find((i) => i.code === "nudo:assume-relied");
    expect(relied).toBeDefined();
    expect(relied!.message).toContain("d <= max");
    expect(relied!.message).not.toContain("d <= lim");
  });
});
