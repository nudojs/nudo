/**
 * Bug 724 —— LSP **hover** 的 interface tier 行**硬编码 `active=true`**。
 *
 * 改前：hover 首行恒 `● contract / <src>`，而同一文件的 CodeLens 在
 * 选中 case 后已翻成 `○ contract / <src>` ⇒ 同一个 IDE 里两个面打架
 * （并与 `core/algebra/interface.ts` 写明的语义「○ = 当前观察的是 case」
 * 直接矛盾）。
 *
 * 原生 oracle：hover 首行的 `●/○` 必须与 CodeLens 的契约选项标题**同源**
 * （观察选择器互斥：激活 case ⇒ 契约档 ○）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNudoServer } from "../server.ts";
import { createMockConnection } from "./helpers.ts";

const SRC = `/**
 * @nudo:case "c1" (1) => 2
 */
export function classify(x) {
  return x + 1;
}
`;

type Hover = { contents: { value: string } } | null;
type Lens = { command?: { title: string; command: string } };

async function open(file: string, text: string) {
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  const uri = `file://${file}`;
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri, languageId: "javascript", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 250));
  const hover = mock.requests.get("textDocument/hover")!;
  const codeLens = mock.requests.get("textDocument/codeLens")!;
  const exec = mock.requests.get("workspace/executeCommand")!;
  const firstLine = (): string | undefined =>
    (hover({
      textDocument: { uri },
      position: { line: 3, character: 17 },
    }) as Hover)?.contents.value.split("\n")[0];
  const contractLens = (): Lens | undefined =>
    (codeLens({ textDocument: { uri } }) as Lens[]).find(
      (l) => l.command?.command === "nudo.selectContract",
    );
  return { mock, uri, firstLine, contractLens, exec };
}

describe("Bug 724 hover tier 行：与 CodeLens 同源（选中 case ⇒ 契约档 ○）", () => {
  it("选中 case 后 hover 首行翻成 ○ contract / imp（与 CodeLens 标题逐字相同）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug724-"));
    const file = join(dir, "tier.js");
    writeFileSync(file, SRC);
    try {
      const { firstLine, contractLens, exec } = await open(file, SRC);

      // 初始：契约档激活 ⇒ ●
      expect(firstLine()).toBe("● contract / imp");
      expect(contractLens()?.command?.title).toBe("● contract / imp");

      exec({
        command: "nudo.selectCase",
        arguments: [`file://${file}`, "classify", 0, "c1"],
      });
      await new Promise((r) => setTimeout(r, 250));

      // 选中 case 后：CodeLens 翻 ○，hover 必须同步（改前 hover 仍恒 ●）
      expect(contractLens()?.command?.title).toBe("○ contract / imp");
      expect(firstLine()).toBe("○ contract / imp");
      // 两个面逐字一致
      expect(firstLine()).toBe(contractLens()?.command?.title);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("取消 case 选择（selectContract）后 hover 首行回到 ●", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug724b-"));
    const file = join(dir, "tier.js");
    writeFileSync(file, SRC);
    try {
      const { uri, firstLine, contractLens, exec } = await open(file, SRC);
      exec({
        command: "nudo.selectCase",
        arguments: [uri, "classify", 0, "c1"],
      });
      await new Promise((r) => setTimeout(r, 250));
      expect(firstLine()).toBe("○ contract / imp");

      exec({ command: "nudo.selectContract", arguments: [uri, "classify"] });
      await new Promise((r) => setTimeout(r, 250));
      expect(contractLens()?.command?.title).toBe("● contract / imp");
      expect(firstLine()).toBe("● contract / imp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
