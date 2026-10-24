/**
 * Bug 785 —— LSP 面**从不采集**行内指令（`@nudo:as` / `@nudo:replace`）
 * ⇒ CLI 与 LSP 对同一份文件给出**相反**的门禁结论与签名 ⇒ IDE 侧**假红**。
 *
 * 根因：`collectEvalReplacements`（service 的行内指令收集器）在
 * `packages/lsp/src/` **一次都没被调用** ⇒ LSP 的两条 `checkSource` 入口
 * （诊断面 `validation.ts` / agent 工具面 `agent-tools.ts`）拿不到覆盖表；
 * CLI 侧经 `buildCheckInjection`（`packages/nudojs/src/commands/check.ts`）
 * 显式传了 `asOverrides` / `asOverrideTargets` / `replacements` /
 * `replacementTargets` ⇒ 两个产品面跑的不是同一份注入。
 *
 * 修法（片 F）：`packages/lsp/src/agent-tools.ts` 新增**注入装配器**
 * `buildLspInjection`（与 CLI `buildCheckInjection` 同口径，**不从 lsp 反向
 * import nudojs**），agent check 工具面把它交给 `checkSource({ inject })`。
 *
 * 钉（agent 门禁面，本片能改的一侧）：
 * - `@nudo:as number()` 夹具 ⇒ `nudo/check` 判绿（0 error）且签名是
 *   `string`（CLI 同款结论），不再 `unknown #partial throws TypeError`；
 * - `@nudo:replace makeRaw() number()` 夹具 ⇒ 同上。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockConnection } from "./helpers.ts";
import { createNudoServer } from "../server.ts";

/** `@nudo:as`：把 `raw` 覆盖成 number（源码里是 string） */
const AS_SRC = `// @nudo:as number()
const raw = "abc";

export function usesToFixed() {
  return raw.toFixed(2);
}
`;

/** `@nudo:replace`：把 `makeRaw()` 的调用点覆盖成 number */
const REPL_SRC = `function makeRaw() {
  return "abc";
}

// @nudo:replace makeRaw() number()
const raw = makeRaw();

export function usesToFixed() {
  return raw.toFixed(2);
}
`;

type CheckJsonLike = {
  ok: boolean;
  summary: { errors: number; warnings: number; functions: number };
  signatures: Array<{ name: string; display: string }>;
  issues: Array<{ severity: string; code?: string; message: string }>;
};

function openSession(src: string, name: string): {
  mock: ReturnType<typeof createMockConnection>;
  file: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug785-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: `bug785-${name}`, private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, `${name}.js`);
  writeFileSync(file, src, "utf-8");
  const mock = createMockConnection();
  createNudoServer(mock as unknown as never);
  mock.notifications.get("textDocument/didOpen")!({
    textDocument: { uri: `file://${file}`, languageId: "javascript", version: 1, text: src },
  });
  return {
    mock,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function checkJson(
  mock: ReturnType<typeof createMockConnection>,
  file: string,
): Promise<CheckJsonLike> {
  const res: any = await mock.requests.get("nudo/check")!({ file, format: "json" });
  const text = String(res?.content?.[0]?.text ?? "");
  return JSON.parse(text) as CheckJsonLike;
}

describe("Bug 785 — LSP 门禁面必须与 CLI 同源采集行内指令", () => {
  it("@nudo:as：agent nudo/check 判绿且签名与 CLI 同款（string，非 unknown）", async () => {
    const { mock, file, cleanup } = openSession(AS_SRC, "as");
    try {
      const json = await checkJson(mock, file);
      expect(
        json.issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.message}`),
        "行内指令未生效 ⇒ IDE 假红",
      ).toEqual([]);
      expect(json.ok, "nudo/check 未判绿").toBe(true);
      expect(json.summary.errors).toBe(0);
      const sig = json.signatures.find((s) => s.name === "usesToFixed");
      expect(sig?.display, "签名面仍与 CLI 分叉").toContain("string");
      expect(sig?.display).not.toContain("unknown");
    } finally {
      cleanup();
    }
  }, 30_000);

  it("@nudo:replace：agent nudo/check 判绿且签名与 CLI 同款", async () => {
    const { mock, file, cleanup } = openSession(REPL_SRC, "repl");
    try {
      const json = await checkJson(mock, file);
      expect(
        json.issues.filter((i) => i.severity === "error").map((i) => `${i.code} ${i.message}`),
        "行内指令未生效 ⇒ IDE 假红",
      ).toEqual([]);
      expect(json.ok, "nudo/check 未判绿").toBe(true);
      const sig = json.signatures.find((s) => s.name === "usesToFixed");
      expect(sig?.display).toContain("string");
      expect(sig?.display).not.toContain("unknown");
    } finally {
      cleanup();
    }
  }, 30_000);
});
