/**
 * Bug 752 — LSP agent 工具 `nudo/check` 丢掉 CLI 的 **mock 装载失败通道**。
 *
 * 症状（改前）：夹具 `@nudo:mock helper from "./no-such-mock.js"`（mock 文件
 * 不存在）⇒ CLI `nudo check --json` 报 **error 级 `nudo:module-missing`**
 * （判红），agent 工具面**整条通道消失**（判绿）——同一文件两个面两种结论。
 *
 * 根因：agent 工具只调 core 的 `checkSource` + `serializeCheckJson`，而
 * mock 装载失败在**旁路通道**里（CLI 侧由 `mergeCheckIssues` 显式并入）。
 *
 * 本钉走**真 LSP server**（mock connection + 真协议请求），断言 slash 形式
 * 与 dot 形式都能看到这条 error 级通道。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const MOCKONLY = `/**
 * @nudo:mock helper from "./no-such-mock.js"
 */
export function add(a) {
  return a + 1;
}
`;

describe("Bug 752 — agent nudo/check 并入 mock 装载失败通道", () => {
  it("slash 形式：mock 文件缺失 ⇒ error 级 nudo:module-missing（门禁红）", async () => {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/mockonly.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const issue = json.issues.find(
        (i: { code: string }) => i.code === "nudo:module-missing",
      );
      expect(issue).toBeTruthy();
      expect(issue.severity).toBe("error");
      expect(issue.message).toContain("no-such-mock.js");
      expect(json.ok).toBe(false);
      expect(json.summary.errors).toBeGreaterThanOrEqual(1);
    });
  });

  it("dot 形式：同一条通道同样可见（协议别名不降级）", async () => {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo.check")({ file: `${dir}/mockonly.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("nudo:module-missing");
    });
  });

  it("文本面：error 级通道上屏（不再是「0 error」判绿）", async () => {
    await withLspServer({ "mockonly.js": MOCKONLY }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/mockonly.js` });
      const text = r.content[0].text;
      expect(text).toContain("nudo:module-missing");
      expect(text).toContain("FAILED");
    });
  });
});
