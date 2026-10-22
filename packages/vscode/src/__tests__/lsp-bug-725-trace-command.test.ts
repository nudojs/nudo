/**
 * Bug 725 —— VS Code 扩展**从不注册 `nudo.trace` 命令** ⇒ 观察透镜
 * （`entry@` / `call@` CodeLens）在 IDE 里是**死链**（点了报
 * 「command 'nudo.trace' not found」）。
 *
 * 改前：服务端 CodeLens 把 `command: "nudo.trace"` 交给客户端执行，
 * 但扩展的 `commands.registerCommand` 名单里没有它，manifest 的
 * `contributes.commands` 里也没有它。
 *
 * 原生 oracle：CodeLens 的 `command.command` 是**客户端命令名**（由编辑器
 * 解析并派发）⇒ 扩展必须注册同名命令；服务端产出的每个 CodeLens 命令名
 * 都必须在扩展的注册名单里。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const vscodeDir = fileURLToPath(new URL("../../", import.meta.url));
const vscodeSrcDir = fileURLToPath(new URL("../", import.meta.url));
const repoPackages = fileURLToPath(new URL("../../../", import.meta.url));

const extensionSrc = readFileSync(`${vscodeSrcDir}extension.ts`, "utf-8");
const manifest = JSON.parse(
  readFileSync(`${vscodeDir}package.json`, "utf-8"),
) as { contributes: { commands: Array<{ command: string; title: string }> } };
const serverIdeSrc = readFileSync(`${repoPackages}lsp/src/server-ide.ts`, "utf-8");

/** 扩展实际注册的命令（`commands.registerCommand("nudo.x", …)`） */
const registered = [
  ...extensionSrc.matchAll(/commands\.registerCommand\(\s*"(nudo\.[A-Za-z.]+)"/g),
].map((m) => m[1]!);

/** manifest 声明的命令（`contributes.commands[].command`） */
const declared = manifest.contributes.commands.map((c) => c.command);

/** 服务端 CodeLens 交给客户端执行的命令名 */
const codeLensCommands = [
  ...new Set(
    [...serverIdeSrc.matchAll(/command:\s*"(nudo\.[A-Za-z.]+)"/g)].map((m) => m[1]!),
  ),
];

describe("Bug 725 VS Code 扩展：nudo.trace 命令必须注册（观察透镜不是死链）", () => {
  it("扩展注册了 nudo.trace", () => {
    expect(registered).toContain("nudo.trace");
  });

  it("manifest 的 contributes.commands 登记了 nudo.trace", () => {
    expect(declared).toContain("nudo.trace");
  });

  it("服务端 CodeLens 产出的每个命令名都在扩展的注册名单里（一致性闸）", () => {
    // 服务端确实把 nudo.trace 交给客户端（观察透镜）
    expect(codeLensCommands).toContain("nudo.trace");
    const missing = codeLensCommands.filter((c) => !registered.includes(c));
    expect(missing).toEqual([]);
  });
});
