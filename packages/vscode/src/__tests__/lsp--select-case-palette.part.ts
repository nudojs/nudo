/**
 * Bug 953 —— VS Code 扩展的 `nudo.selectCase` 处理器把「CodeLens 调用」
 * （一定带 4 个位置参数）与「命令面板调用」（**一个参数都不带**）当成同一种
 * ⇒ 处理器**既无 `uri` fallback 也无缺参校验** ⇒ 面板路径把 4 个
 * `undefined` 原样发给服务端 ⇒ 面板入口 100% 静默无效（不发错、不提示）。
 *
 * ⚠ 服务端那一半已被族 22/25 修好（现在回结构化错误
 * `{ success:false, error, isError:true }`）⇒ 本族**只修扩展侧**。
 * ⚠ 但「静默无效」依然成立：服务端回的是 **result**（不是 JSON-RPC error）
 * ⇒ 扩展的 `catch` **不触发** ⇒ 零提示。
 *
 * 修法：补 `uri` fallback（`uri ?? window.activeTextEditor?.document.uri`）+
 * 缺参提示（`window.showWarningMessage`）+ 把服务端的结构化错误
 * （`isError` / `success === false`）**显式呈现**并回滚乐观高亮。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { host, makeExtensionContext } from "./vscode-host-stub.ts";

vi.mock("vscode", async () => {
  const { host: h } = await import("./vscode-host-stub.ts");
  return h.vscodeModule;
});
vi.mock("vscode-languageclient/node", async () => {
  const { host: h } = await import("./vscode-host-stub.ts");
  return h.languageClientModule;
});

const URI = "file:///workspace/sample.js";
const SOURCE = [
  "/**",
  ' * @nudo:case "one" (1)',
  " */",
  "export function add2(a, b) {",
  "  return a + b;",
  "}",
  "",
].join("\n");

describe("Bug 953 —— nudo.selectCase 的命令面板入口不再静默无效", () => {
  beforeAll(async () => {
    const { activate } = await import("../extension.ts");
    await activate(makeExtensionContext() as never);
  });

  beforeEach(() => {
    host.state.reset();
    host.state.editorUri = URI;
    host.state.editorText = SOURCE;
    host.state.responses.clear();
  });

  it("面板路径（不传参）：提示缺参，不把 undefined 发给服务端", async () => {
    await host.invokeCommand("nudo.selectCase");
    expect(host.state.requests).toEqual([]);
    expect(host.state.warnings.length).toBeGreaterThan(0);
    expect(host.state.errors).toEqual([]);
  });

  it("面板路径（不传参）：不留 junk 的 undefined 档表（画面无变化）", async () => {
    await host.invokeCommand("nudo.selectCase");
    // 乐观高亮只在参数齐全时才会写档表 ⇒ 面板路径不再写 junk 条目。
    expect(host.state.decorations).toEqual([]);
  });

  it("缺 uri 时回落到活动编辑器（与兄弟命令同款）", async () => {
    host.state.responses.set("nudo/selectCase", { success: true });
    await host.invokeCommand("nudo.selectCase", [undefined, "add2", 0, "one"]);
    expect(host.state.requests).toEqual([
      {
        method: "nudo/selectCase",
        params: { uri: URI, functionName: "add2", caseIndex: 0 },
      },
    ]);
  });

  it("CodeLens 路径（4 参齐全）：请求照旧 + 乐观高亮", async () => {
    host.state.responses.set("nudo/selectCase", { success: true });
    await host.invokeCommand("nudo.selectCase", [URI, "add2", 0, "one"]);
    expect(host.state.requests).toEqual([
      {
        method: "nudo/selectCase",
        params: { uri: URI, functionName: "add2", caseIndex: 0 },
      },
    ]);
    expect(host.state.warnings).toEqual([]);
    const ranges = host.state.decorations.at(-1) ?? [];
    expect(ranges.length).toBeGreaterThan(0);
  });

  it("服务端的结构化错误被显式呈现（result ≠ JSON-RPC error ⇒ catch 不触发）", async () => {
    host.state.responses.set("nudo/selectCase", {
      success: false,
      error: "Error: unknown function 'nope' in target file",
      isError: true,
    });
    await host.invokeCommand("nudo.selectCase", [URI, "nope", 0, "one"]);
    expect(host.state.errors.join("\n")).toContain(
      "Error: unknown function 'nope' in target file",
    );
  });

  it("服务端拒绝时回滚乐观高亮（不留幽灵高亮）", async () => {
    host.state.responses.set("nudo/selectCase", { success: true });
    await host.invokeCommand("nudo.selectCase", [URI, "add2", 0, "one"]);
    const before = host.state.decorations.at(-1) ?? [];
    expect(before.length).toBeGreaterThan(0);

    host.state.responses.set("nudo/selectCase", {
      success: false,
      error: "Error: unknown function 'nope' in target file",
      isError: true,
    });
    await host.invokeCommand("nudo.selectCase", [URI, "nope", 0, "one"]);
    const after = host.state.decorations.at(-1) ?? [];
    // 幽灵条目被删除 ⇒ 高亮回到「只有 add2」的那一份。
    expect(after).toEqual(before);
  });
});
