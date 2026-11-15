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
 * 解析并派发）⇒ 该命令名必须**被某个注册面接住**。
 *
 * ⚠ Bug 972 之后接住的方式变了（**同批改**）：
 *   - 服务端在 `initialize` 的 `executeCommandProvider.commands` 里广告了
 *     `nudo.trace` ⇒ `vscode-languageclient` 会**自动**把它注册成 VS Code
 *     命令 ⇒ 扩展**再**用 `commands.registerCommand` 注册同名 id 会抛
 *     `command '<id>' already exists`（客户端初始化期抛 ⇒ language client
 *     起不来）。
 *   - ⇒ 扩展不再注册同名 id，改由 `middleware.executeCommand` 接管
 *     （`NUDO_CLIENT_COMMAND_IDS` / `NUDO_CLIENT_COMMAND_HANDLERS`）。
 *
 * ⇒ 不变量从「CodeLens 名 ⊆ 扩展注册名单」改成
 *   「CodeLens 名 ∈ 扩展注册名单 ∪ **服务端广告名单**」，
 *   并新增「**扩展注册名 ∩ 服务端广告名 = ∅**」。
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
const publicApiSrc = readFileSync(
  `${repoPackages}lsp/src/public-api.ts`,
  "utf-8",
);

/** 扩展实际注册的命令（`commands.registerCommand("nudo.x", …)`） */
const registered = [
  ...extensionSrc.matchAll(/commands\.registerCommand\(\s*"(nudo\.[A-Za-z.]+)"/g),
].map((m) => m[1]!);

/** 扩展用 middleware 接管的命令 id（服务端也广告 ⇒ 不得重复注册） */
const middlewareHandled = [
  ...(
    /export const NUDO_CLIENT_COMMAND_IDS = \[([\s\S]*?)\] as const;/.exec(
      extensionSrc,
    )?.[1] ?? ""
  ).matchAll(/"([^"]+)"/g),
].map((m) => m[1]!);

/** middleware 分发表里真正登记的 handler */
const handlerIds = [
  ...(
    /const NUDO_CLIENT_COMMAND_HANDLERS: Record<string, NudoCommandHandler> = \{([\s\S]*?)\n\};/.exec(
      extensionSrc,
    )?.[1] ?? ""
  ).matchAll(/"([^"]+)":/g),
].map((m) => m[1]!);

/** manifest 声明的命令（`contributes.commands[].command`） */
const declared = manifest.contributes.commands.map((c) => c.command);

/** 服务端 CodeLens 交给客户端执行的命令名 */
const codeLensCommands = [
  ...new Set(
    [...serverIdeSrc.matchAll(/command:\s*"(nudo\.[A-Za-z.]+)"/g)].map((m) => m[1]!),
  ),
];

/** 服务端广告的 executeCommand id（stable inventory） */
const serverAdvertised = [
  ...(
    /export const NUDO_EXECUTE_COMMANDS = \[([\s\S]*?)\] as const;/.exec(
      publicApiSrc,
    )?.[1] ?? ""
  ).matchAll(/"([^"]+)"/g),
].map((m) => m[1]!);

describe("Bug 725 VS Code 扩展：nudo.trace 命令必须被接住（观察透镜不是死链）", () => {
  it("扩展接管了 nudo.trace（972 后由 middleware 拦截，不再重复注册）", () => {
    expect(middlewareHandled).toContain("nudo.trace");
    expect(registered).not.toContain("nudo.trace");
  });

  it("manifest 的 contributes.commands 登记了 nudo.trace", () => {
    expect(declared).toContain("nudo.trace");
  });

  it("服务端 CodeLens 产出的每个命令名都被接住（一致性闸）", () => {
    // 服务端确实把 nudo.trace 交给客户端（观察透镜）
    expect(codeLensCommands).toContain("nudo.trace");
    // 接住者 = 扩展注册 ∪ 服务端广告（languageclient 自动注册）∪ 扩展 middleware
    const missing = codeLensCommands.filter(
      (c) =>
        !registered.includes(c) &&
        !serverAdvertised.includes(c) &&
        !middlewareHandled.includes(c),
    );
    expect(missing).toEqual([]);
  });

  it("扩展注册名 ∩ 服务端广告名 = ∅（972：二次注册会让 language client 起不来）", () => {
    expect(registered.filter((c) => serverAdvertised.includes(c))).toEqual([]);
  });

  it("middleware 分发表覆盖全部声明接管的命令 id", () => {
    expect([...handlerIds].sort()).toEqual([...middlewareHandled].sort());
  });
});
