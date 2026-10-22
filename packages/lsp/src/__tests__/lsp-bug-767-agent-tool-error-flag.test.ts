/**
 * Bug 767 —— agent 工具的**失败路径**必须带 `isError: true`
 * （协议层可与成功区分；此前失败与成功同形，客户端只能解析文本猜）。
 *
 * 覆盖面（本分片 A4 的工具面）：
 * - `nudo/trace`：函数不存在 ⇒ 工具错误
 * - `nudo/suggestCase`：函数不存在 ⇒ 工具错误
 * - 成功面**不得**带 isError（对照组：trace 一个存在的函数）
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  "export function inc(n) {",
  "  return n + 1;",
  "}",
  "",
].join("\n");

describe("Bug 767：agent 工具失败路径带 isError:true（协议面）", () => {
  it("trace / suggestCase 的「函数不存在」是失败（isError），成功面不带", async () => {
    await withLspServer({ "a4-767.js": SRC }, async ({ req, uri }) => {
      const file = uri("a4-767.js");

      const missingTrace = await req("nudo/trace")({ file, functionName: "nope" });
      expect(missingTrace.isError).toBe(true);
      expect(missingTrace.content[0].text).toContain('Function "nope" not found');

      const missingSuggest = await req("nudo/suggestCase")({ file, functionName: "nope" });
      expect(missingSuggest.isError).toBe(true);
      expect(missingSuggest.content[0].text).toContain('Function "nope" not found');

      // 对照组：成功面不得带 isError
      const ok = await req("nudo/trace")({ file, functionName: "inc" });
      expect(ok.isError).toBeFalsy();
      expect(ok.content[0].text).toContain("Output:");
    });
  });
});
