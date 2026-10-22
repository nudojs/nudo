/**
 * Bug 993 —— agent 工具走**同步** `analyzeFile` ⇒ path 型 env 不被预载 ⇒
 * 工具输出取决于「同一进程里谁先被调用过」：
 *
 * - 文件**未在编辑器打开**时，`nudo/trace` 看不到 env 里的全局 ⇒ case 结果
 *   是 `unknown`（报告里的 `never` 同源）；文件被打开过（push 诊断走
 *   `analyzeFileAsync` ⇒ 预载了 env）⇒ 同一工具、同一文件给出 `99`。
 * - 「先同步（未预载）、后异步（已预载）」时，分析缓存会把**无 env 的陈旧
 *   结果**喂给后续调用（键里只有 env 文件的**内容**，没有**预载状态**）。
 *
 * 修法：观察类工具走 `analyzeFileAsync`（先 `await preloadPathEnvs`），且
 * 分析缓存键纳入 env 预载状态。
 *
 * 本钉用**真 server（mock connection）+ 真协议请求**，并且**不 didOpen**
 * （冷状态）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";

let dir = "";
let file = "";

const ENV_SRC = [
  'import { numLit } from "@nudojs/core";',
  "export function defineEnv() {",
  "  return { globals: { MAGIC: numLit(99) } };",
  "}",
  "",
].join("\n");

const APP_SRC = [
  "/// @nudo:env ./a4-993-env.ts",
  "",
  "/**",
  ' * @nudo:case "t" ()',
  " */",
  "function getMagic() {",
  "  return MAGIC;",
  "}",
  "",
].join("\n");

/** 每个用例一套**独立命名**的 env 文件：env 工厂注册表按**说明符**键，
 *  同名 env 会「先预载者赢」⇒ 用例之间必须互不遮蔽。 */
function setup(envName: string): void {
  dir = mkdtempSync(join(tmpdir(), "nudo-a4-993-"));
  writeFileSync(join(dir, envName), ENV_SRC, "utf-8");
  file = join(dir, "a4-993.js");
  writeFileSync(file, APP_SRC.replace("./a4-993-env.ts", `./${envName}`), "utf-8");
}

beforeEach(() => {
  setup("a4-993-env.ts");
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("Bug 993：agent 工具走异步入口 ⇒ path 型 env 必被预载", () => {
  it("文件未打开时 nudo/trace 也能看到 env 的全局（99，而非 unknown）", async () => {
    const mock = createMockConnection();
    const { createNudoServer } = await import("../server.ts");
    createNudoServer(mock as unknown as never);

    // 冷状态：没有任何 didOpen ⇒ env 未被预载
    const cold = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    expect(cold.content[0].text).toContain("99");
    expect(cold.content[0].text).not.toContain("unknown");
  });

  it("打开与否给出**同一个**答案（不随会话状态变）", async () => {
    const mock = createMockConnection();
    const { createNudoServer } = await import("../server.ts");
    createNudoServer(mock as unknown as never);

    const before = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: {
        uri: `file://${file}`,
        languageId: "javascript",
        version: 1,
        text: APP_SRC,
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    const after = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    expect(before.content[0].text).toBe(after.content[0].text);
    expect(after.content[0].text).toContain("99");
  });

  it("同步面（nudo/test）先跑也不得把「无 env」的陈旧结果喂给后续异步调用", async () => {
    setup("a4-993-env-b.ts");
    const mock = createMockConnection();
    const { createNudoServer } = await import("../server.ts");
    createNudoServer(mock as unknown as never);

    // 同步面先跑（冷状态）——它自身仍是同步入口（testTool 属 A1 分片）
    await mock.requests.get("nudo/test")!({ file });
    // 随后的异步工具必须重新分析（env 已预载）而不是命中陈旧条目
    const traced = await mock.requests.get("nudo/trace")!({ file, functionName: "getMagic" });
    expect(traced.content[0].text).toContain("99");
  });
});
