/**
 * Bug 1019 —— vscode 扩展的 **active-case 高亮从不随文档编辑重算**：
 * 装饰是**基于文本快照算出的绝对行号区间**，而刷新只挂在
 * `window.onDidChangeActiveTextEditor` 上 ⇒ `workspace.onDidChangeTextDocument`
 * **未订阅** ⇒ 任何**不切换编辑器**的编辑（打字 / 粘贴 / 格式化）都会让
 * 高亮整体漂移到别的代码上（函数体高亮落在别的函数上、case 注释行落在别的行）。
 *
 * 修法：在 `activate()` 里补 `workspace.onDidChangeTextDocument` 订阅
 * （推进 `context.subscriptions`）⇒ 编辑后按**新文本**重算装饰。
 * （纯函数侧 `computeCaseDecorationSpans` 本来就按传入文本算 ⇒ 不用改。）
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

/** 顶部插入 5 行 ⇒ 真实位置整体下移 5 行。 */
const SHIFTED = ["// 1", "// 2", "// 3", "// 4", "// 5", ""].join("\n") + SOURCE;

describe("Bug 1019 —— active-case 高亮随文档编辑重算", () => {
  beforeAll(async () => {
    const { activate } = await import("../extension.ts");
    await activate(makeExtensionContext() as never);
  });

  beforeEach(() => {
    host.state.reset();
    host.state.editorUri = URI;
    host.state.editorText = SOURCE;
    host.state.responses.clear();
    host.state.responses.set("nudo/selectCase", { success: true });
  });

  it("activate() 订阅了 workspace.onDidChangeTextDocument", () => {
    expect(host.state.docListeners.length).toBeGreaterThan(0);
  });

  it("编辑后高亮按新文本重算（不再冻结在旧行号）", async () => {
    await host.invokeCommand("nudo.selectCase", [URI, "add2", 0, "one"]);
    const before = host.state.decorations.at(-1) ?? [];
    expect(before.length).toBeGreaterThan(0);
    const beforeStart = before[0]!.range.start.line;

    host.state.editorText = SHIFTED;
    host.fireDocumentChange(URI);
    const after = host.state.decorations.at(-1) ?? [];

    expect(after.length).toBeGreaterThan(0);
    expect(after[0]!.range.start.line).toBe(beforeStart + 5);
  });

  it("编辑其它文档不影响当前编辑器的装饰", async () => {
    await host.invokeCommand("nudo.selectCase", [URI, "add2", 0, "one"]);
    const before = host.state.decorations.at(-1) ?? [];

    host.state.editorText = SHIFTED;
    host.fireDocumentChange("file:///workspace/other.js");
    const after = host.state.decorations.at(-1) ?? [];

    expect(after).toEqual(before);
  });
});
