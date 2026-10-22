/**
 * Bug 940 —— 未声明的命令名在 `workspace/executeCommand` 上回 result:null。
 *
 * 改前：未知命令 → JSON-RPC **成功** + null 结果——协议层假成功（与「命令
 * 跑了但无输出」同形），客户端无法区分「无此命令」与「跑了但没结果」。
 * 改后：走协议层错误 MethodNotFound（-32601）。
 * 命令白名单复用 advertise 面的 NUDO_EXECUTE_COMMANDS（不新增命令名）。
 *
 * 用例超时给到 30s：withLspServer 的首次动态 import（server.ts 依赖图）在
 * 并行负载下要数秒，5s 默认值会偶发踩线。
 */
import { describe, it, expect } from "vitest";
import { ErrorCodes } from "vscode-languageserver/node";
import { withLspServer } from "./helpers.ts";
import { NUDO_EXECUTE_COMMANDS } from "../public-api.ts";

const SRC = `export function f(x) {
  return x;
}
`;

describe("Bug 940 — 未声明的命令名必须回协议层错误（MethodNotFound）", () => {
  it("未知命令名不再回落 result:null", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req }) => {
      const exec = req("workspace/executeCommand");

      for (const command of ["nudo.notARealCommand", "totally.unknown", ""]) {
        await expect(async () =>
          exec({ command, arguments: [{ file: "sel.js" }] }),
        ).rejects.toMatchObject({ code: ErrorCodes.MethodNotFound });
      }
    });
  }, 30_000);

  it("已声明的命令名照常执行（白名单 = advertise 面）", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, dir }) => {
      const exec = req("workspace/executeCommand");

      expect(NUDO_EXECUTE_COMMANDS).toContain("nudo.getActiveCases");
      const result = await exec({
        command: "nudo.getActiveCases",
        arguments: [{ file: `${dir}/sel.js` }],
      });
      expect(result).toEqual({});
    });
  }, 30_000);
});
