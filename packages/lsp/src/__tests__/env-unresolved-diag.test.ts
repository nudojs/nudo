import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearValidationState, validateText, type LspDiagnostic, type ValidateTextDeps } from "../validation.ts";
import { clearPathEnvCaches } from "@nudojs/service";
import { DiagnosticSeverity } from "vscode-languageserver/node";

/**
 * LSP 侧 nudo:env-unresolved（issue #88 后续）：验证链路此前只 preload path env
 * 不查错误表——env 加载失败/文件缺失在 IDE 面完全静默。契约：
 * - 坏 env（缺失/导入失败）→ warning 诊断，code=nudo:env-unresolved，
 *   消息与 CLI 同源（`path env failed to load: <path> — <error>`）
 * - 好 env → 无该诊断；env 项移除后陈旧错误不误报；缓存命中轮仍发布（live 瞬态）
 */
const OK_ENV = `export function defineEnv() {
  return { globals: {}, modules: {} };
}
`;

const PROBE = `export function f(x) { return x; }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeProject(envEntries: string[], envFiles: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-env-unresolved-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "t", private: true, nudo: { env: envEntries } }),
    "utf-8",
  );
  for (const [name, content] of Object.entries(envFiles)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

function collector(): { sent: LspDiagnostic[]; deps: ValidateTextDeps } {
  const sent: LspDiagnostic[] = [];
  return {
    sent,
    deps: {
      sendDiagnostics: (p) => {
        sent.push(...p.diagnostics);
      },
    },
  };
}

async function validate(dir: string, version = 1): Promise<LspDiagnostic[]> {
  const { sent, deps } = collector();
  const file = join(dir, "probe.js");
  await validateText(file, `file://${file}`, PROBE, version, deps);
  return sent;
}

function envDiags(sent: LspDiagnostic[]): LspDiagnostic[] {
  return sent.filter((d) => d.code === "nudo:env-unresolved");
}

describe("LSP nudo:env-unresolved 诊断（validation 面）", () => {
  beforeEach(() => {
    clearValidationState();
    clearPathEnvCaches();
  });

  it("缺失 env 文件 → 恰 1 条 warning，消息与 CLI 同源", async () => {
    const dir = makeProject(["./nope.mjs"]);
    const sent = await validate(dir);

    const env = envDiags(sent);
    expect(env).toHaveLength(1);
    expect(env[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(env[0]!.source).toBe("nudo-check");
    expect(env[0]!.message).toContain("path env failed to load");
    expect(env[0]!.message).toContain(join(dir, "nope.mjs"));
    expect(env[0]!.message).toContain("path env not found");
  });

  it("导入失败的 env 文件（存在但 defineEnv 不可达）同样告警", async () => {
    const dir = makeProject(["./broken.mjs"], {
      "broken.mjs": `import "@nudojs/env/does-not-exist";\nexport function defineEnv() { return { globals: {}, modules: {} }; }\n`,
    });
    const sent = await validate(dir);

    const env = envDiags(sent);
    expect(env).toHaveLength(1);
    expect(env[0]!.severity).toBe(DiagnosticSeverity.Warning);
    expect(env[0]!.message).toContain("path env failed to load");
    expect(env[0]!.message).toContain(join(dir, "broken.mjs"));
  });

  it("好 env → 无该诊断", async () => {
    const dir = makeProject(["./env.mjs"], { "env.mjs": OK_ENV });
    const sent = await validate(dir);
    expect(envDiags(sent)).toHaveLength(0);
  });

  it("缓存命中轮（源码未变再 validate）仍发布 live 告警", async () => {
    const dir = makeProject(["./nope.mjs"]);
    expect(envDiags(await validate(dir, 1))).toHaveLength(1);
    // 同源码同 version：analysisCache 命中（analyzeFileAsync 不再 preload），
    // env 告警是 live 瞬态——显式补 preload 后仍须恰 1 条
    expect(envDiags(await validate(dir, 1))).toHaveLength(1);
  });

  it("env 项从配置移除后不再误报陈旧错误", async () => {
    const dir = makeProject(["./nope.mjs"]);
    expect(envDiags(await validate(dir))).toHaveLength(1);

    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", private: true, nudo: {} }),
      "utf-8",
    );
    // 进程级错误表仍有旧条目——本轮 env 名单不含它，不得继续发布
    expect(envDiags(await validate(dir, 2))).toHaveLength(0);
  });
});
