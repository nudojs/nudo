/**
 * Bug 790 —— 项目侧的 `nudo.inlayHints.parameters` 与宿主侧**两套规则**。
 *
 * 症状：项目 `package.json` 写 `nudo.inlayHints.parameters: "false"`
 * （字符串）⇒ IDE 里参数 inlay 仍然**开着**；同一台机器把宿主设置
 * `nudo.inlayHints.parameters` 改成 `false` ⇒ 参数 inlay **关掉**。
 * 同一个键、同一个值、两种行为。
 *
 * 根因（片 D · `server.ts`）：宿主侧走 `parseInlayParams`
 * （`typeof raw === "boolean" ? raw : undefined` ⇒ 非法值回落默认），
 * 项目侧却**原样返回**原始值 ⇒ 字符串 `"false"` 是真值 ⇒ 反而**开启**。
 *
 * 修法：项目侧与宿主侧**同一个归一化函数**——非法值（非 boolean）一律
 * 回落默认（关），并记一条可读告警。
 *
 * 钉：① 项目 `"false"` ⇒ 参数 inlay **关**（与宿主同口径）；
 * ② 项目 `true` ⇒ 参数 inlay **开**；③ 宿主 `"false"` ⇒ 关（不回归）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SRC = "export function getName(user) {\n  return user.name;\n}\n";
const SIDECAR = `import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ user: shape({ name: string() }) }, string());
`;

async function hintLabels(
  pkg: unknown,
  initOptions?: unknown,
): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug790-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
    writeFileSync(join(dir, "lib.js"), SRC, "utf-8");
    writeFileSync(join(dir, "lib.nudo.js"), SIDECAR, "utf-8");
    const uri = `file://${join(dir, "lib.js")}`;
    const mock = createMockConnection();
    createNudoServer(mock as unknown as never);
    mock.requests.get("initialize")!({
      processId: null,
      rootUri: `file://${dir}`,
      workspaceFolders: [{ uri: `file://${dir}`, name: "ws" }],
      capabilities: {},
      ...(initOptions ? { initializationOptions: initOptions } : {}),
    });
    mock.notifications.get("textDocument/didOpen")!({
      textDocument: { uri, languageId: "javascript", version: 1, text: SRC },
    });
    await sleep(700);
    const hints = (await mock.requests.get("textDocument/inlayHint")!({
      textDocument: { uri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 10, character: 0 },
      },
    })) as { label?: string }[];
    return hints.map((h) => String(h.label ?? ""));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isParamInlay = (labels: string[]): boolean =>
  labels.some((l) => l.includes("where "));

describe("Bug 790 — 项目侧 inlayHints.parameters 与宿主侧同口径", () => {
  it("项目侧字符串 \"false\" ⇒ 参数 inlay 关（非法值回落默认）", async () => {
    const labels = await hintLabels({
      name: "inlay",
      private: true,
      type: "module",
      nudo: { inlayHints: { parameters: "false" } },
    });
    expect(isParamInlay(labels)).toBe(false);
  }, 30_000);

  it("项目侧布尔 true ⇒ 参数 inlay 开", async () => {
    const labels = await hintLabels({
      name: "inlay",
      private: true,
      type: "module",
      nudo: { inlayHints: { parameters: true } },
    });
    expect(isParamInlay(labels)).toBe(true);
  }, 30_000);

  it("宿主侧字符串 \"false\" ⇒ 参数 inlay 关（既有行为不回归）", async () => {
    const labels = await hintLabels(
      { name: "inlay", private: true, type: "module" },
      { inlayHints: { parameters: "false" } },
    );
    expect(isParamInlay(labels)).toBe(false);
  }, 30_000);
});
