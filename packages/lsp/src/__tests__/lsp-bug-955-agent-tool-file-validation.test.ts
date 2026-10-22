/**
 * Bug 955 —— `file` 入参零校验（**A4 的共用入口闸**：`normalizeFilePath`）。
 *
 * AGENT-CONTEXT §5 裁决：`file` 的形状校验放在 A4 的共用入口
 * （`normalizeFilePath`），A1/A2/A5 的工具都走这里 ⇒ 一处改，全覆盖。
 *
 * 改前：`file: 42` ⇒ 裸 JS TypeError（`file.startsWith is not a function`）
 * 当工具文案回给客户端；`file` 缺失 ⇒ 回落服务器 cwd（幽灵条目）。
 * 改后：非法/缺失的 `file` ⇒ 结构化工具错误（`isError: true`，文案
 * `file is required …`），异常不逃出工具。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = [
  "/**",
  ' * @nudo:case "num" (1)',
  " */",
  "export function f(x) {",
  "  return x;",
  "}",
  "",
].join("\n");

describe("Bug 955（共用入口）：agent 工具的 file 入参非法 ⇒ 结构化工具错误", () => {
  it("nudo/whatIf / hover / trace / suggestCase：file 非字符串/空串/缺失 ⇒ isError", async () => {
    await withLspServer({ "a4-955.js": SRC }, async ({ req, uri }) => {
      const good = uri("a4-955.js");
      const calls: Array<[string, Record<string, unknown>]> = [
        ["nudo/whatIf", { target: "x" }],
        ["nudo/hover", { line: 1, column: 0 }],
        ["nudo/trace", { functionName: "f" }],
        ["nudo/suggestCase", { functionName: "f" }],
      ];
      for (const [method, params] of calls) {
        for (const bad of [42, "", null, undefined]) {
          const result = await req(method)({ ...params, file: bad });
          expect(result, `${method} file=${JSON.stringify(bad)} 应当回错误`).toBeTruthy();
          expect(result.isError, `${method} file=${JSON.stringify(bad)} 应当 isError`).toBe(true);
          expect(result.content[0].text).toContain("file is required");
        }
        // 合法 file ⇒ 成功面（不得被共用入口误伤）
        const ok = await req(method)({ ...params, file: good });
        expect(ok.isError, `${method} 合法 file 不得是错误`).toBeFalsy();
      }
    });
  });
});
