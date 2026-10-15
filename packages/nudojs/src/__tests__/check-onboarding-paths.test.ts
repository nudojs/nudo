/**
 * #7 诊断路径口径 + #1 零配置 onboarding 块 + #9 缓存 opt-in 提示。
 * 进程内驱动 commander action（与 check-file-directive-warn 同型；
 * vitest alias 使 @nudojs/* 解析到 src，无需 dist 重建）。
 *
 * - #7：test 诊断行（check 的报告头/issue 行本就打绝对路径，无 relative 渲染）
 *   ——目标在 cwd 外打绝对路径；cwd 内维持相对展示（displayPathOf 单源）。
 * - #1：exit 1 ∧ 全部 error 为 nudo:entry-may-throw ∧ 全部目标零 @nudo:*
 *   指令 ∧ 零 package.json#nudo 配置 → issues 段之后、docs 段之前打 onboarding；
 *   任一条件破坏（@nudo:case / nudo 配置 / 混入 L1 error）或 --json 模式不打。
 *   门禁语义不变（仍 exit 1）。
 * - #9：多路径或目录 check 跑完且磁盘缓存未启用 → stderr 一行提示；
 *   单文件 / --json / nudo.cache 已启用不打。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerCheckCommand } from "../commands/check.ts";
import { registerTestCommand } from "../commands/test.ts";

async function runCheckCli(args: string[]): Promise<void> {
  const program = new Command();
  registerCheckCommand(program);
  await program.parseAsync(["node", "nudo", ...args]);
}

async function runTestCli(args: string[]): Promise<void> {
  const program = new Command();
  registerTestCommand(program);
  await program.parseAsync(["node", "nudo", ...args]);
}

let logs: string[] = [];
let errs: string[] = [];

beforeEach(() => {
  process.exitCode = undefined;
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** 诊断行 `[severity] <path>:<line>:<col> message (code)` → 抽出 path */
function diagnosticPaths(out: string): string[] {
  const re = /\[(?:info|warning|error)\] (\S+):\d+:\d+ /g;
  return [...out.matchAll(re)].map((m) => m[1]!);
}

// 零注解入口（any 形参原生 may TypeError → L2 entry-may-throw error）
const PLAIN_SRC = `export function double(x) { return x * 2; }
`;
const CASE_SRC = `/**
 * @nudo:case double(2) => 4
 */
export function double(x) { return x * 2; }
`;

describe("test 诊断行路径口径 (#7)", () => {
  it("目标在 cwd 外 → 诊断行打绝对路径（无 ../.. 逃逸段）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-path-out-"));
    const file = join(dir, "calc.js");
    writeFileSync(file, PLAIN_SRC, "utf-8");
    try {
      await runTestCli(["test", file]);
      const paths = diagnosticPaths(logs.join("\n"));
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every((p) => p === file)).toBe(true);
      expect(logs.join("\n")).not.toContain("../../");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("目标在 cwd 内 → 维持相对路径展示", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-path-in-"));
    const file = join(dir, "calc.js");
    writeFileSync(file, PLAIN_SRC, "utf-8");
    const prevCwd = process.cwd();
    try {
      process.chdir(dir);
      await runTestCli(["test", "calc.js"]);
      const paths = diagnosticPaths(logs.join("\n"));
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.every((p) => p === "calc.js")).toBe(true);
    } finally {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check 零配置 onboarding 块 (#1)", () => {
  it("零指令 + 零配置 + 全 L2 error → issues 段之后、docs 段之前", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-onb-pos-"));
    const file = join(dir, "plain.js");
    writeFileSync(file, PLAIN_SRC, "utf-8");
    try {
      await runCheckCli(["check", file]);
      const out = logs.join("\n");
      expect(out).toContain("onboarding");
      expect(out).toContain("nudo init");
      expect(out).toContain("nudo contract --draft <file>");
      expect(out).toContain("nudo check --profile adoption");
      // 位置：issues 段（ERROR 行）之后、docs 段之前
      const idxIssue = out.indexOf("[ERROR");
      const idxOnboarding = out.indexOf("onboarding");
      const idxDocs = out.indexOf("\ndocs");
      expect(idxIssue).toBeGreaterThanOrEqual(0);
      expect(idxOnboarding).toBeGreaterThan(idxIssue);
      expect(idxOnboarding).toBeLessThan(idxDocs);
      // 门禁语义不变：仍 exit 1
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("有 @nudo:case 指令 → 不打（非纯净新项目指纹）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-onb-case-"));
    const file = join(dir, "cased.js");
    writeFileSync(file, CASE_SRC, "utf-8");
    try {
      await runCheckCli(["check", file]);
      expect(logs.join("\n")).not.toContain("onboarding");
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("发现 package.json#nudo 配置 → 不打", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-onb-cfg-"));
    const file = join(dir, "plain.js");
    writeFileSync(file, PLAIN_SRC, "utf-8");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ nudo: {} }), "utf-8");
    try {
      await runCheckCli(["check", file]);
      expect(logs.join("\n")).not.toContain("onboarding");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("混入 L1 error（侧车契约违例，源文件零指令）→ 不打", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-onb-l1-"));
    const file = join(dir, "one.js");
    writeFileSync(file, `export function one() { return 1; }\n`, "utf-8");
    writeFileSync(
      join(dir, "one.nudo.js"),
      `import { fn, number } from "@nudojs/core";

export const one = fn({}, number().gt(10));
`,
      "utf-8",
    );
    try {
      await runCheckCli(["check", file]);
      const out = logs.join("\n");
      expect(out).toContain("nudo:constraint-violated");
      expect(out).not.toContain("onboarding");
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json 模式 → stdout 纯信封、stderr 干净、无 onboarding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-onb-json-"));
    const file = join(dir, "plain.js");
    writeFileSync(file, PLAIN_SRC, "utf-8");
    try {
      await runCheckCli(["check", file, "--json"]);
      const out = logs.join("\n");
      expect(out).not.toContain("onboarding");
      expect(errs).toEqual([]);
      const json = JSON.parse(out) as {
        ok: boolean;
        issues: Array<{ code: string; severity: string }>;
      };
      expect(json.ok).toBe(false);
      expect(json.issues.every((i) => i.code === "nudo:entry-may-throw")).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check 缓存 opt-in 提示 (#9)", () => {
  it("多文件 check 且缓存未启用 → stderr 一行提示", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-hint-multi-"));
    writeFileSync(join(dir, "a.js"), PLAIN_SRC, "utf-8");
    writeFileSync(join(dir, "b.js"), `export function greet(n) { return "hi " + n; }\n`, "utf-8");
    try {
      await runCheckCli(["check", join(dir, "a.js"), join(dir, "b.js")]);
      expect(errs.join("\n")).toContain('[hint] repeat runs: enable "nudo": { "cache": true }');
      expect(errs.join("\n")).toContain("docs/design/persistent-cache.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("目录目标 → stderr 有提示", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-hint-dir-"));
    writeFileSync(join(dir, "a.js"), PLAIN_SRC, "utf-8");
    try {
      await runCheckCli(["check", dir]);
      expect(errs.join("\n")).toContain("[hint] repeat runs:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("单文件 → stderr 无提示", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-hint-single-"));
    writeFileSync(join(dir, "a.js"), PLAIN_SRC, "utf-8");
    try {
      await runCheckCli(["check", join(dir, "a.js")]);
      expect(errs.join("\n")).not.toContain("[hint]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json 多文件 → stderr 干净无提示，信封结构不变", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-hint-json-"));
    writeFileSync(join(dir, "a.js"), PLAIN_SRC, "utf-8");
    writeFileSync(join(dir, "b.js"), `export function greet(n) { return "hi " + n; }\n`, "utf-8");
    try {
      await runCheckCli(["check", join(dir, "a.js"), join(dir, "b.js"), "--json"]);
      expect(errs).toEqual([]);
      const envelope = JSON.parse(logs.join("\n")) as {
        ok: boolean;
        reports: Array<{ file: string; ok: boolean }>;
      };
      expect(envelope.reports).toHaveLength(2);
      expect(envelope.ok).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nudo.cache 已启用 → 无提示", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-hint-cached-"));
    writeFileSync(join(dir, "a.js"), PLAIN_SRC, "utf-8");
    writeFileSync(join(dir, "b.js"), PLAIN_SRC, "utf-8");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ nudo: { cache: true } }),
      "utf-8",
    );
    try {
      await runCheckCli(["check", join(dir, "a.js"), join(dir, "b.js")]);
      expect(errs.join("\n")).not.toContain("[hint]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
