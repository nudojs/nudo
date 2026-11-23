/**
 * CLI `check --json` 与 LSP check / parse 通道的**机器面对拍**：
 * - 同一份源码：两边都出现的 code 必须同 severity；
 * - 语法错：CLI `pathErrors[].code` 与 LSP `parseFailureDiagnostic().code`
 *   必须是同一个协议码。
 *
 * 这是 P5 的诊断面不变量：两通道可以因作用域不同而**多/少**诊断（CLI 有
 * 外部记录 / 路径面，LSP 是单文件），但同一 code 不得给出相反 severity。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "@nudojs/parser";
import {
  checkToLspDiagnostics,
  parseFailureDiagnostic,
  type LspDiagnostic,
} from "../validation.ts";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const tsxBin = join(repoRoot, "node_modules/.bin/tsx");
const cliEntry = join(repoRoot, "packages/nudojs/src/index.ts");

const CLI_ENV = {
  ...process.env,
  NO_COLOR: "1",
  GITHUB_ACTIONS: "false",
  TSX_TSCONFIG_PATH: join(repoRoot, "tsconfig.json"),
};

type CliIssue = {
  code?: string;
  severity?: "error" | "warning" | "info";
  line?: number;
  column?: number;
};
type CliJson = {
  issues?: CliIssue[];
  pathErrors?: Array<{ code?: string }>;
};

function runCliJson(dir: string, file: string): CliJson {
  const r = spawnSync(tsxBin, [cliEntry, "check", file, "--json"], {
    cwd: dir,
    encoding: "utf8",
    env: CLI_ENV,
  });
  if (r.status === null) throw new Error(`CLI did not finish: ${r.error?.message ?? "unknown"}`);
  const text = r.stdout ?? "";
  if (text.trim() === "") throw new Error(`CLI produced empty stdout (status ${r.status})`);
  return JSON.parse(text) as CliJson;
}

function lspSeverity(
  d: LspDiagnostic,
): "error" | "warning" | "info" {
  // vscode-languageserver DiagnosticSeverity: Error=1 / Warning=2 / Info=3
  return d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info";
}

describe("CLI check --json ↔ LSP check 诊断面", () => {
  it("同一份源码的共有 code 同 severity", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-diag-parity-"));
    try {
      const file = join(dir, "semantic.js");
      const source = `/** @nudo:case "x" (1) */\nexport function f(n) { return n + 1; }\n`;
      writeFileSync(file, source, "utf-8");

      const cli = runCliJson(dir, "semantic.js");
      const lsp = checkToLspDiagnostics(file, source);

      const cliByCode = new Map(
        (cli.issues ?? [])
          .filter((i): i is CliIssue & { code: string; severity: NonNullable<CliIssue["severity"]> } =>
            typeof i.code === "string" && i.severity !== undefined,
          )
          .map((i) => [i.code, i.severity] as const),
      );
      const lspByCode = new Map(
        lsp
          .filter((d): d is LspDiagnostic & { code: string } => typeof d.code === "string")
          .map((d) => [d.code, lspSeverity(d)] as const),
      );

      // 门禁主通道必须两边都在（CLI 可能多 info 补充诊断；那是作用域差异）。
      expect(cliByCode.get("nudo:entry-may-throw")).toBe("error");
      expect(lspByCode.get("nudo:entry-may-throw")).toBe("error");

      for (const [code, severity] of lspByCode) {
        if (cliByCode.has(code)) expect(severity, `severity drift for ${code}`).toBe(cliByCode.get(code));
      }

      // 同一 code 的源码锚点必须一致：CLI 行号 1-based，LSP 0-based。
      const cliIssue = (cli.issues ?? []).find((i) => i.code === "nudo:entry-may-throw");
      const lspIssue = lsp.find((d) => d.code === "nudo:entry-may-throw");
      expect(cliIssue?.line).toBeGreaterThan(0);
      expect(lspIssue).toBeDefined();
      expect(lspIssue!.range.start.line + 1).toBe(cliIssue!.line);
      if (cliIssue!.column !== undefined && cliIssue!.column < 999) {
        expect(lspIssue!.range.start.character).toBe(cliIssue!.column);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("语法错：CLI pathErrors 与 LSP parseFailureDiagnostic 同协议码", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-diag-parity-syntax-"));
    try {
      const file = join(dir, "bad.js");
      const source = `/** @nudo:case "x" (1) */\nexport function (\n`;
      writeFileSync(file, source, "utf-8");

      const cli = runCliJson(dir, "bad.js");
      let parseErr: unknown;
      try {
        parse(source);
      } catch (err) {
        parseErr = err;
      }
      expect(parseErr).toBeDefined();
      const lsp = parseFailureDiagnostic(file, source, parseErr);

      expect(cli.pathErrors?.[0]?.code).toBe("syntax-error");
      expect(lsp.code).toBe("syntax-error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
