/**
 * `nudo check --gitlab` 机器契约：GitLab Code Quality 只接受一份
 * JSON 数组报告（gl-code-quality-report.json）。多 target 时 action
 * 层聚合 rows 后一次打印——旧实现逐文件各打一个数组，拼接产物
 * 无法 JSON.parse。附带锁定：--gitlab 面 stdout 不混入 docs 深链
 * （终端面专属），单文件面保持单数组可解析。
 * 进程内驱动 commander action（与 check-injection-fail-gate 同型）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerCheckCommand } from "../commands/check.ts";

async function runCheckCli(args: string[]): Promise<void> {
  const program = new Command();
  registerCheckCommand(program);
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

// L2 entry may-throw：每个文件各出一条 error 级 issue → Code Quality row
const BOOM_A = `export function boomA() {
  throw new TypeError("a");
}
`;
const BOOM_B = `export function boomB() {
  throw new RangeError("b");
}
`;

describe("check --gitlab 多文件聚合", () => {
  it("两文件输出恰为一个可 JSON.parse 的数组，rows 覆盖两文件", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-gitlab-multi-"));
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, BOOM_A, "utf-8");
    writeFileSync(b, BOOM_B, "utf-8");
    try {
      await runCheckCli(["check", a, b, "--gitlab"]);
      // 核心契约：stdout 是单个 JSON 数组（旧实现是两个数组拼接 → parse 失败）
      const rows = JSON.parse(logs.join("\n"));
      expect(Array.isArray(rows)).toBe(true);
      // 聚合自两个文件（workspaceRoot 裁剪后的相对路径）
      const paths = rows.map((r: { location: { path: string } }) => r.location.path);
      expect(paths.some((p: string) => p.endsWith("a.js"))).toBe(true);
      expect(paths.some((p: string) => p.endsWith("b.js"))).toBe(true);
      // 每行是 Code Quality 形状
      for (const r of rows) {
        expect(r.check_name).toBeTruthy();
        expect(r.fingerprint).toBeTruthy();
        expect(r.severity).toBeTruthy();
      }
      // 门禁语义不变：两文件各有 error → exit 1；简报走 stderr 便于日志
      expect(process.exitCode).toBe(1);
      expect(errs.join("\n")).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("干净文件混排：绿文件不出 row，数组仍可解析，任一红即 exit 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-gitlab-mixed-"));
    const clean = join(dir, "clean.js");
    const boom = join(dir, "boom.js");
    writeFileSync(clean, "export function id(x) { return x; }\nid(1);\n", "utf-8");
    writeFileSync(boom, BOOM_A, "utf-8");
    try {
      await runCheckCli(["check", clean, boom, "--gitlab"]);
      const rows = JSON.parse(logs.join("\n"));
      expect(Array.isArray(rows)).toBe(true);
      const paths = rows.map((r: { location: { path: string } }) => r.location.path);
      expect(paths.some((p: string) => p.endsWith("boom.js"))).toBe(true);
      expect(paths.some((p: string) => p.endsWith("clean.js"))).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check --gitlab 单文件面", () => {
  it("有 error 时 stdout 仍是纯单数组（docs 深链不上机器面）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-gitlab-single-"));
    const a = join(dir, "a.js");
    writeFileSync(a, BOOM_A, "utf-8");
    try {
      await runCheckCli(["check", a, "--gitlab"]);
      const rows = JSON.parse(logs.join("\n"));
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("绿文件：空数组 [] 且 exit 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-gitlab-green-"));
    const a = join(dir, "ok.js");
    writeFileSync(a, "export function id(x) { return x; }\nid(1);\n", "utf-8");
    try {
      await runCheckCli(["check", a, "--gitlab"]);
      expect(logs.join("\n").trim()).toBe("[]");
      // 绿面不置红：exitCode 未被置 1（undefined = 进程默认 0）
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("对照组：docs 深链只在终端面", () => {
  it("无 --gitlab 的默认面仍打 docs 深链（抑制不越界）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-gitlab-doctrl-"));
    const a = join(dir, "a.js");
    writeFileSync(a, BOOM_A, "utf-8");
    try {
      await runCheckCli(["check", a]);
      const out = logs.join("\n");
      expect(out).toContain("docs");
      expect(out).toContain("nudo:entry-may-throw");
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
