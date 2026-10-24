/**
 * Bug 754 — LSP agent 工具 `nudo/test` 丢掉 CLI 的 **`assertions` 通道**
 * ⇒ agent 面分不出「见证通过」与「见证失败」。
 *
 * 症状（改前）：CLI `nudo test --json` 的顶层键含 `assertions`
 * （`{"passed": 1, "failed": 1, "unchecked": 0}`），agent 工具的 JSON 里
 * **根本没有 `assertions` 这个键**。
 *
 * 本钉用一条**声明了期望值**的 `@nudo:case`（通过）与一条期望值**不满足**的
 * `@nudo:case`（失败）⇒ 断言汇总必须能分出两者。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const CASES = `/**
 * @nudo:case "ok" (2) => 4
 * @nudo:case "bad" (2) => 99
 */
export function double(x) {
  return x * 2;
}
`;

describe("Bug 754 — agent nudo/test 并入 assertions 汇总", () => {
  it("JSON 面含 assertions 键（passed / failed / unchecked）", async () => {
    await withLspServer({ "cases.js": CASES }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/cases.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      expect(json.assertions).toBeTruthy();
      expect(typeof json.assertions.passed).toBe("number");
      expect(typeof json.assertions.failed).toBe("number");
      expect(typeof json.assertions.unchecked).toBe("number");
    });
  });

  it("通过 / 失败的见证被分开计数（不是「全部通过」）", async () => {
    await withLspServer({ "cases.js": CASES }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/cases.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      expect(json.assertions.passed).toBeGreaterThanOrEqual(1);
      expect(json.assertions.failed).toBeGreaterThanOrEqual(1);
    });
  });

  it("dot 形式同样含 assertions（协议别名不降级）", async () => {
    await withLspServer({ "cases.js": CASES }, async ({ req, dir }) => {
      const r = await req("nudo.test")({ file: `${dir}/cases.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      expect(json.assertions).toBeTruthy();
    });
  });
});
