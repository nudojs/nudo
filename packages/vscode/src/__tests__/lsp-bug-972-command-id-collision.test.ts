/**
 * Bug 972 —— VS Code 扩展**自己注册**的 `nudo.*` 命令 id 与 LSP 服务端在
 * `initialize` 的 `executeCommandProvider.commands` 广告的**同一批 id**
 * 撞名 ⇒ `vscode-languageclient`（10.1.2）在**客户端初始化**路径上对每个
 * 服务端 id 调 `vscode.commands.registerCommand` ⇒ 同一 id 在命令注册表出现
 * 两次 ⇒ VS Code 1.91 `extHostCommands.registerCommand` 直接抛
 * `command '<id>' already exists` ⇒ 抛在客户端初始化路径上 ⇒
 * **整个 language client 起不来**（诊断 / hover / CodeLens / inlay hint 全无）。
 *
 * 修法（**只能扩展侧解** —— 服务端广告面 `NUDO_EXECUTE_COMMANDS` 是
 * `packages/lsp/PUBLIC_API.md` §3 的 stable inventory，不许从服务端删 id）：
 * 扩展**不再**用 `commands.registerCommand` 注册与服务端同名的 id，改用
 * `LanguageClientOptions.middleware.executeCommand` 拦截；扩展侧独有的行为
 * （本地乐观高亮 / Output 预览 / 写盘门禁）一并搬进 middleware。
 *
 * 本钉断言（两条）：
 *   1. **扩展注册名 ∩ 服务端广告名 = ∅**（运行时实测 + 源码静态闸）；
 *   2. 「扩展先注册 → languageclient 再注册服务端 12 个 id」不再撞名。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { host, makeExtensionContext } from "./vscode-host-stub.ts";

vi.mock("vscode", async () => {
  const { host: h } = await import("./vscode-host-stub.ts");
  return h.vscodeModule;
});
vi.mock("vscode-languageclient/node", async () => {
  const { host: h } = await import("./vscode-host-stub.ts");
  return h.languageClientModule;
});

const vscodeSrcDir = fileURLToPath(new URL("../", import.meta.url));
const repoPackages = fileURLToPath(new URL("../../../", import.meta.url));

/** 服务端广告的 executeCommand id（stable inventory，冻结面）。 */
const serverAdvertised: string[] = (() => {
  const src = readFileSync(`${repoPackages}lsp/src/public-api.ts`, "utf-8");
  const block =
    /export const NUDO_EXECUTE_COMMANDS = \[([\s\S]*?)\] as const;/.exec(src)?.[1] ??
    "";
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
})();

/** 扩展源码里 `commands.registerCommand("nudo.x", …)` 的 id。 */
const sourceRegistered: string[] = [
  ...readFileSync(`${vscodeSrcDir}extension.ts`, "utf-8").matchAll(
    /commands\.registerCommand\(\s*"(nudo\.[A-Za-z.]+)"/g,
  ),
].map((m) => m[1]!);

describe("Bug 972 —— 扩展命令 id 不与服务端广告 id 撞名", () => {
  beforeAll(async () => {
    const { activate } = await import("../extension.ts");
    await activate(makeExtensionContext() as never);
  });

  it("服务端广告面是 12 个 id（stable inventory 的形状没变）", () => {
    expect(serverAdvertised).toHaveLength(12);
  });

  it("扩展运行时注册的 id ∩ 服务端广告 id = ∅", () => {
    const registered = [...host.state.registered.keys()];
    expect(registered.filter((id) => serverAdvertised.includes(id))).toEqual([]);
  });

  it("扩展源码里 registerCommand 的 id ∩ 服务端广告 id = ∅（静态闸）", () => {
    expect(sourceRegistered.filter((id) => serverAdvertised.includes(id))).toEqual(
      [],
    );
  });

  it("扩展先注册 → languageclient 再注册服务端 12 个 id：不再抛 already exists", () => {
    // 复刻 vscode-languageclient@10.1.2 `lib/common/executeCommand.js:82-90`
    // 的注册循环 + VS Code 1.91 `extHostCommands.registerCommand` 的重复 id 抛错。
    const registry = new Map<string, unknown>(host.state.registered);
    const conflicts: string[] = [];
    for (const id of serverAdvertised) {
      if (registry.has(id)) {
        conflicts.push(id);
        continue;
      }
      registry.set(id, () => undefined);
    }
    expect(conflicts).toEqual([]);
    expect(registry.size).toBe(
      host.state.registered.size + serverAdvertised.length,
    );
  });

  it("扩展侧自有的 6 个命令 id 改由 middleware 接管（不再重复注册）", () => {
    for (const id of [
      "nudo.selectCase",
      "nudo.selectContract",
      "nudo.trace",
      "nudo.contract",
      "nudo.contract.draft",
      "nudo.contract.emit",
    ]) {
      expect(host.state.registered.has(id)).toBe(false);
    }
    expect(typeof host.middleware.executeCommand).toBe("function");
  });

  it("middleware 只接管扩展自有的 id，其余 id 原样转发给服务端", async () => {
    const forwarded: { command: string; args: unknown[] }[] = [];
    await host.middleware.executeCommand?.(
      "nudo.check",
      ["file:///a.js"],
      (command: string, args: unknown[]) => {
        forwarded.push({ command, args });
        return "forwarded";
      },
    );
    expect(forwarded).toEqual([
      { command: "nudo.check", args: ["file:///a.js"] },
    ]);
  });
});
