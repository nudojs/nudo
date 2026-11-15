// MERGED (topic-related bug pins): lsp-bug-955-agent-tool-file-validation.test.ts + lsp-bug-955-file-param-validation.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

describe("[merged] lsp-bug-955-agent-tool-file-validation.test.ts", () => {
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
});

describe("[merged] lsp-bug-955-file-param-validation.test.ts", () => {
/**
 * Bug 955 —— `file` 入参零校验。
 *
 * 改前：file=42（非字符串）→ 裸 TypeError（"file.startsWith is not a
 * function"）逃出工具 ⇒ 客户端拿到 JSON-RPC **协议错误**而非 isError 工具
 * 错误；file 缺失时回落服务器 cwd（并在该 cwd 上建幽灵条目）。
 * 改后：非法/缺失的 file ⇒ 结构化工具错误（isError: true），异常不逃出。
 *
 * 用例超时给到 30s：withLspServer 的首次动态 import（server.ts 依赖图）在
 * 并行负载下要数秒，5s 默认值会偶发踩线。
 */



const SRC = `/**
 * @nudo:case "num" (1)
 */
export function f(x) {
  return x;
}
`;

describe("Bug 955 — file 入参非法时不得让异常逃出工具", () => {
  it("nudo/getActiveCases：file 非字符串 / 空串 / 缺失 ⇒ 结构化错误，不抛异常", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req }) => {
      const get = req("nudo/getActiveCases");

      for (const bad of [42, "", null, undefined]) {
        const result = await get({ file: bad });
        expect(result, `file=${JSON.stringify(bad)} 应当回错误`).toBeTruthy();
        expect(result.success).toBe(false);
        expect(result.isError).toBe(true);
        expect(result.error).toContain("file is required");
      }
    });
  }, 30_000);

  it("nudo/contract.emit：file 非字符串 ⇒ isError 工具错误，不抛异常", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req }) => {
      const emit = req("nudo/contract.emit");

      const result = await emit({ file: 42, functionName: "f", mode: "add" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("file is required");
    });
  }, 30_000);

  it("nudo/selectCase：file 非字符串 ⇒ 结构化错误，不抛异常、不建 cwd 幽灵条目", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const select = req("nudo/selectCase");
      const fileUri = uri("sel.js");

      const result = await select({ file: 42, functionName: "f", caseIndex: 0 });
      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("file is required");

      // file 缺失时不再回落服务器 cwd：该 uri 下没有活动档条目
      const missing = await select({ functionName: "f", caseIndex: 0 });
      expect(missing.success).toBe(false);
      const active = await req("nudo/getActiveCases")({ uri: fileUri });
      expect(active).toEqual({});
    });
  }, 30_000);
});
});
