/**
 * 族 53 · 第 8 条 —— **manifest 漏登记 `nudo.selectContract`**。
 *
 * 症状：扩展的 handler 认 `nudo.selectContract`（`NUDO_CLIENT_COMMAND_IDS`
 *   里有 ⇒ languageclient 自动注册成 VS Code 命令 ⇒ 可被 CodeLens 调用），
 *   但 manifest 的 `contributes.commands` **没有**它 ⇒ **命令面板里看不见**
 *   （用户只能从 CodeLens 点，命令面板搜不到）。
 *
 * 修法：登记进 `packages/vscode/package.json` 的 `contributes.commands`
 *   （标题与兄弟命令同款风格）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

type Manifest = {
  contributes?: {
    commands?: Array<{ command?: string; title?: string }>;
  };
};

const manifest = JSON.parse(
  readFileSync(join(PKG_ROOT, "package.json"), "utf-8"),
) as Manifest;

describe("族 53 · 第 8 条：manifest 登记 nudo.selectContract", () => {
  it("contributes.commands 里有 nudo.selectContract（非空标题）", () => {
    const commands = manifest.contributes?.commands ?? [];
    const entry = commands.find((c) => c.command === "nudo.selectContract");
    expect(entry).toBeDefined();
    expect(typeof entry!.title).toBe("string");
    expect(entry!.title!.trim().length).toBeGreaterThan(0);
  });

  it("既有命令条目逐字不变（selectCase / trace / contract 三条仍在）", () => {
    const ids = (manifest.contributes?.commands ?? []).map((c) => c.command);
    expect(ids).toContain("nudo.selectCase");
    expect(ids).toContain("nudo.trace");
    expect(ids).toContain("nudo.contract");
    expect(ids).toContain("nudo.contract.draft");
    expect(ids).toContain("nudo.contract.emit");
  });
});
