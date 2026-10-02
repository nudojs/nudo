/**
 * sanitizeErrorMessage（BUG-023 / S5-005）：
 * LSP 诊断 / agent 工具结果会进 IDE 与远端 LLM
 * 会话——原始 err.message 的绝对路径等于回传
 * 工作区布局。
 */
import { describe, it, expect } from "vitest";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { sanitizeErrorMessage } from "../sanitize.ts";
import { checkToLspDiagnostics, validateText, type ValidateTextDeps } from "../validation.ts";
import { checkTool, type AgentToolDeps } from "../agent-tools.ts";
import type { MarkupContent } from "vscode-languageserver/node";

describe("sanitizeErrorMessage (BUG-023)", () => {
  it("replaces home-directory prefix with ~", () => {
    const home = homedir();
    const msg = `ENOENT: no such file or directory, open '${home}/proj/a.js'`;
    expect(sanitizeErrorMessage(msg, [])).toBe(
      `ENOENT: no such file or directory, open '~/proj/a.js'`,
    );
  });

  it("replaces tracked root prefixes with .", () => {
    const msg =
      "Cannot find module '/workspace/nudo/x.js' imported from '/workspace/nudo/a.js'";
    expect(sanitizeErrorMessage(msg, ["/workspace/nudo"])).toBe(
      "Cannot find module './x.js' imported from './a.js'",
    );
  });

  it("home wins first, roots second (both applied)", () => {
    const home = homedir();
    const msg = `at f (${home}/repo/nudo/src/a.ts:1:1)`;
    expect(sanitizeErrorMessage(msg, [`${home}/repo/nudo`])).toBe(
      "at f (./src/a.ts:1:1)",
    );
  });

  it("passes through messages without tracked prefixes", () => {
    expect(sanitizeErrorMessage("boom", ["/nonexistent-root-xyz"])).toBe("boom");
  });

  it("ignores degenerate roots (/, ., ~)", () => {
    expect(sanitizeErrorMessage("/a/boom", ["/", ".", "~"])).toBe("/a/boom");
  });

  it("G7: non-cwd, non-home root (WSL mount style) only sanitized when passed in", () => {
    const root = "/wsl/repo";
    const msg = `ENOENT: no such file or directory, open '${root}/x.js'`;
    // 显式传根 → `.`
    expect(sanitizeErrorMessage(msg, [root])).toBe(
      `ENOENT: no such file or directory, open './x.js'`,
    );
    // 缺省根是 [cwd]——工作区不在 cwd 下（扩展宿主 fork 的 server）时泄漏
    expect(sanitizeErrorMessage(msg).includes(root)).toBe(true);
  });

  it("G7: real tmp dir root (non-cwd, non-home) is replaced", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-g7-"));
    try {
      const msg = `cannot analyze ${dir}/src/a.js`;
      expect(sanitizeErrorMessage(msg, [dir])).toBe(`cannot analyze ./src/a.js`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * G7（接线回归）：生产调用点必须把 LSP 真实 workspaceRoots 传给
 * sanitizeErrorMessage——server 由扩展宿主 fork，cwd ≠ 工作区根，
 * 多根工作区更无单一 cwd；不传则绝对路径完整进诊断 / agent 结果。
 * 修复前：validateText / checkToLspDiagnostics / agent 工具都用缺省
 * [cwd] 根，工作区根路径原样泄漏。
 */
describe("G7: production error faces use injected workspaceRoots", () => {
  const ROOT = "/wsl/repo";
  const asText = (m: string | MarkupContent): string =>
    typeof m === "string" ? m : m.value;

  function boomLoad(spec: string, fromFile: string): string | undefined {
    throw new Error(`cannot load ${resolve(dirname(fromFile), spec)}`);
  }

  const SRC = `/// @nudo:import ./c.nudo.js\nimport { lit } from "contract:nudo";\nexport function f(a) { return lit(a); }\n`;

  it("checkToLspDiagnostics sanitizes Check error with passed roots", () => {
    const diags = checkToLspDiagnostics(`${ROOT}/a.js`, SRC, boomLoad, [ROOT]);
    const msg = diags.map((d) => asText(d.message)).find((m) => m.startsWith("Check error:"));
    expect(msg).toBeDefined();
    expect(msg).not.toContain(ROOT);
    expect(msg).toContain("cannot load ./");
  });

  it("validateText forwards deps.workspaceRoots to the check error face", async () => {
    const published: string[] = [];
    const deps: ValidateTextDeps = {
      sendDiagnostics: (p) => published.push(...p.diagnostics.map((d) => asText(d.message))),
      loadModule: boomLoad,
      workspaceRoots: [ROOT],
    };
    await validateText(`${ROOT}/vt.js`, `file://${ROOT}/vt.js`, SRC, 1, deps, false, true);
    const checkErr = published.find((m) => m.startsWith("Check error:"));
    expect(checkErr).toBeDefined();
    expect(checkErr).not.toContain(ROOT);
    expect(checkErr).toContain("cannot load ./");
    // 同输入不注入 roots → 泄漏（cwd ≠ /wsl/repo）——钉住注入才是生效来源
    const leaked: string[] = [];
    await validateText(`${ROOT}/vt2.js`, `file://${ROOT}/vt2.js`, SRC, 2, {
      sendDiagnostics: (p) => leaked.push(...p.diagnostics.map((d) => asText(d.message))),
      loadModule: boomLoad,
    }, false, true);
    const leakedErr = leaked.find((m) => m.startsWith("Check error:"));
    expect(leakedErr).toBeDefined();
    expect(leakedErr).toContain(ROOT);
  });

  it("agent tool analysisError sanitizes with deps.workspaceRoots", () => {
    const deps: AgentToolDeps = {
      readFile: () => {
        throw new Error(`ENOENT: no such file or directory, open '${ROOT}/x.js'`);
      },
      workspaceRoots: [ROOT],
    };
    const res = checkTool({ file: `${ROOT}/x.js` }, deps);
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).not.toContain(ROOT);
    expect(res.content[0]!.text).toContain(`open './x.js'`);
  });
});
