/**
 * Bug 1057 —— `nudo.contract.emit` 的处理器把 `functionName` 设为**必填**
 * ⇒ 命令面板入口（面板执行命令**不传任何参数**）100% 不可达 ⇒ 文档承诺的
 * 「先 dry-run → Output 预览 → 确认 → 真实写盘」三步流程在面板路径上
 * **永远走不到第一步**（兄弟命令 `nudo.contract` / `nudo.contract.draft` 的
 * `functionName` 恰恰是可选的 ⇒ 同族命令内部风格不一致）。
 *
 * 修法：面板路径下 `functionName` 走**交互式选择**（从服务端自己的
 * `nudo.contract.emit` CodeLens 取可固化目标）⇒ 三步门禁
 * （dry-run → Output 预览 → 确认 → 写盘）**不被绕过**：交互式选择只补齐
 * 缺失的 `functionName`，不跳过任何一步。
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

/** 服务端为该文件产出的 `nudo.contract.emit` CodeLens（可固化目标）。 */
const PERSIST_LENS = {
  command: {
    title: "⚡ persist interface",
    command: "nudo.contract.emit",
    arguments: [URI, "add2", "add"],
  },
};

describe("Bug 1057 —— nudo.contract.emit 的命令面板入口可达（三步门禁不绕过）", () => {
  beforeAll(async () => {
    const { activate } = await import("../extension.ts");
    await activate(makeExtensionContext() as never);
  });

  beforeEach(() => {
    host.state.reset();
    host.state.editorUri = URI;
    host.state.editorText = "export function add2(a, b) {\n  return a + b;\n}\n";
    host.state.responses.clear();
    host.state.codeLens = [PERSIST_LENS];
    host.state.responses.set("nudo/contract.emit", {
      content: [{ type: "text", text: "[dry-run] would add add2" }],
    });
  });

  it("面板路径（不传参）：交互式选择后进入 dry-run 预览（三步的第一步）", async () => {
    await host.invokeCommand("nudo.contract.emit");
    expect(host.state.quickPickCalls.length).toBe(1);
    expect(host.state.requests).toEqual([
      {
        method: "nudo/contract.emit",
        params: {
          file: URI,
          functionName: "add2",
          mode: "add",
          dryRun: true,
        },
      },
    ]);
    expect(host.state.outputLines.join("\n")).toContain(
      "persist dry-run preview add2",
    );
    expect(host.state.infos.join("\n")).toContain(
      "persist contract for add2?",
    );
  });

  it("面板路径：用户不确认 ⇒ 不写盘（门禁第二步）", async () => {
    host.state.infoAnswer = undefined;
    await host.invokeCommand("nudo.contract.emit");
    const writes = host.state.requests.filter(
      (r) => r.method === "nudo/contract.emit" && !("dryRun" in (r.params as object)),
    );
    expect(writes).toEqual([]);
  });

  it("面板路径：用户确认 ⇒ 写盘请求照发（门禁第三步）", async () => {
    host.state.infoAnswer = "Write sidecar";
    await host.invokeCommand("nudo.contract.emit");
    expect(host.state.requests.map((r) => r.params)).toEqual([
      { file: URI, functionName: "add2", mode: "add", dryRun: true },
      { file: URI, functionName: "add2", mode: "add" },
    ]);
  });

  it("dry-run 失败（isError）⇒ 不提供写盘、不发写盘请求", async () => {
    host.state.responses.set("nudo/contract.emit", {
      content: [{ type: "text", text: "Error: not an analysis target" }],
      isError: true,
    });
    await host.invokeCommand("nudo.contract.emit");
    expect(host.state.requests).toHaveLength(1);
    expect(host.state.infos).toEqual([]);
  });

  it("CodeLens 路径（带 functionName）：不弹交互式选择，直接 dry-run", async () => {
    await host.invokeCommand("nudo.contract.emit", [URI, "add2", "update"]);
    expect(host.state.quickPickCalls).toEqual([]);
    expect(host.state.requests).toEqual([
      {
        method: "nudo/contract.emit",
        params: {
          file: URI,
          functionName: "add2",
          mode: "update",
          dryRun: true,
        },
      },
    ]);
  });

  it("文件里没有可固化目标 ⇒ 提示且不发请求", async () => {
    host.state.codeLens = [];
    await host.invokeCommand("nudo.contract.emit");
    expect(host.state.requests).toEqual([]);
    expect(host.state.warnings.length).toBeGreaterThan(0);
  });
});
