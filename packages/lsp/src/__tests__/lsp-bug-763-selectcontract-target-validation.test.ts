/**
 * Bug 763 —— `nudo.selectContract` 无条件回 success:true。
 *
 * 改前：目标函数不存在（"noSuchFn"）、甚至参数全缺时也回 {"success":true}
 * ——协议层假成功，客户端以为契约已切回。
 * 改后：目标不在该文件里 ⇒ 结构化错误（success:false + isError），且活动
 * 档表不产生幽灵条目。
 *
 * 用例超时给到 30s：withLspServer 的首次动态 import（server.ts 依赖图）在
 * 并行负载下要数秒，5s 默认值会偶发踩线。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = `/**
 * @nudo:case "num" (1)
 */
export function f(x) {
  return x;
}

export function g(y) {
  return y + 1;
}
`;

describe("Bug 763 — selectContract 必须校验目标函数", () => {
  it("目标函数不存在时回结构化错误，不写幽灵条目", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const exec = req("workspace/executeCommand");
      const fileUri = uri("sel.js");

      const result = await exec({
        command: "nudo.selectContract",
        arguments: [fileUri, "noSuchFn"],
      });
      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("unknown function");

      const active = await req("nudo/getActiveCases")({ uri: fileUri });
      expect(active).toEqual({});
    });
  }, 30_000);

  it("参数缺失（无 functionName）时回结构化错误", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const result = await req("workspace/executeCommand")({
        command: "nudo.selectContract",
        arguments: [uri("sel.js")],
      });
      expect(result.success).toBe(false);
      expect(result.isError).toBe(true);
      expect(result.error).toContain("functionName");
    });
  }, 30_000);

  it("合法目标（文件里的导出函数）仍然成功，且取消该函数的激活 case", async () => {
    await withLspServer({ "sel.js": SRC }, async ({ req, uri }) => {
      const exec = req("workspace/executeCommand");
      const fileUri = uri("sel.js");

      await exec({ command: "nudo.selectCase", arguments: [fileUri, "f", 0, "num"] });
      expect(await req("nudo/getActiveCases")({ uri: fileUri })).toEqual({ f: 0 });

      const result = await exec({ command: "nudo.selectContract", arguments: [fileUri, "f"] });
      expect(result).toEqual({ success: true });
      expect(await req("nudo/getActiveCases")({ uri: fileUri })).toEqual({});
    });
  }, 30_000);
});
