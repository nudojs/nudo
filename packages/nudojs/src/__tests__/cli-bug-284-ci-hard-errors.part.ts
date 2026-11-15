/**
 * BUG-284 —— 文件级**硬错误**（语法错 / 路径不存在）在两个 **CI 注解通道**上
 * 完全静默：`--gitlab` 的 stdout 塌成 0 字节（消费方 `JSON.parse` 直接抛）、
 * `--gha` 产出 0 条 `::error`；三个机器面对同一失败文件给出 1 / 0 / 0。
 *
 * 现在硬错误也进注解通道：`--gitlab` 的 stdout **恰好一份**可解析数组
 * （含该文件的条目），`--gha` 至少一条 `::error`。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

type Row = {
  check_name: string;
  description: string;
  location: { path: string; lines: { begin: number } };
};

/** `.js` 里的 TS-only 语法 ⇒ 语法错通道 */
const BAD = `export function bad(x) {
  return x as number;
}
`;

function makeProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug284-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({ name: "b284", private: true, type: "module" }),
    "utf-8",
  );
  writeFileSync(join(cwd, "bad.js"), BAD, "utf-8");
  return cwd;
}

const annCount = (r: { stdout: string; stderr: string }): number =>
  `${r.stdout}${r.stderr}`.split("::error").length - 1;

describe("BUG-284 — 文件级硬错误进 CI 注解通道", () => {
  it("--gitlab 语法错文件 ⇒ stdout 是**可解析数组**且含该文件的条目", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gitlab", "bad.js"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout.trimStart().startsWith("[")).toBe(true);
      const rows = JSON.parse(r.stdout) as Row[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.some((x) => x.check_name === "syntax-error")).toBe(true);
      expect(rows[0]?.location?.path).toContain("bad.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("--gitlab 路径不存在 ⇒ stdout 仍是可解析数组（不是 0 字节）", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gitlab", "nope.js"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout.trimStart().startsWith("[")).toBe(true);
      const rows = JSON.parse(r.stdout) as Row[];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.location?.path).toContain("nope.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("--gha 语法错文件 ⇒ 至少一条 ::error 注解", () => {
    const cwd = makeProject();
    try {
      const r = runCliTsx(["check", "--gha", "bad.js"], { cwd });
      expect(r.status).toBe(1);
      expect(annCount(r)).toBeGreaterThanOrEqual(1);
      expect(`${r.stdout}${r.stderr}`).toContain("::error file=");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("批量（坏 + 绿）⇒ 一份数组里同时有语法错行与绿文件无关行（不丢坏文件）", () => {
    const cwd = makeProject();
    try {
      writeFileSync(join(cwd, "ok.js"), "export function ok() {\n  return 1;\n}\n", "utf-8");
      const r = runCliTsx(["check", "--gitlab", "bad.js", "ok.js"], { cwd });
      expect(r.status).toBe(1);
      const rows = JSON.parse(r.stdout) as Row[];
      expect(rows.some((x) => x.check_name === "syntax-error")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
