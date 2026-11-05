/**
 * Bug 954：`nudo check --json` 下的**用法错误** ⇒ stdout 空 + exit 1
 * （机器面 `JSON.parse(stdout)` 直接炸；且违反「exit 只由打印出的 ok 决定 /
 * 绝不出现空 stdout + 非零 exit」的机器面契约）。
 *
 * 症状：用法错误（无路径 / --json+--abs / --profile 非法 / --entry-throws 非法 /
 * variadic 吞路径 / --fix+--json）此前只往 stderr 写文案 ⇒ stdout 空、exit 1。
 * 修复：`--json` 面下用法错误也落一份机器可读信封（ok:false + pathErrors[]
 * 带 `nudo:usage-error`），exit 只由信封的 ok 决定；非 `--json` 面文案不变。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-954-"));
  const file = join(dir, "one.js");
  writeFileSync(file, SRC, "utf-8");
  return { cwd: dir, file };
}

describe("Bug 954 — --json 下用法错误也有机器可读信封（stdout 不得为空）", () => {
  const cases: Array<{ name: string; args: (file: string) => string[] }> = [
    { name: "无路径", args: () => ["check", "--json"] },
    { name: "--json + --abs", args: (f) => ["check", f, "--json", "--abs"] },
    { name: "--profile 非法", args: (f) => ["check", f, "--json", "--profile", "bogus"] },
    {
      name: "--entry-throws 非法",
      args: (f) => ["check", f, "--json", "--entry-throws", "bogus"],
    },
    { name: "variadic 吞路径", args: (f) => ["check", "--json", "--from", f] },
    { name: "--fix + --json", args: (f) => ["check", f, "--json", "--fix"] },
  ];

  for (const c of cases) {
    it(`CLI：${c.name} ⇒ stdout 是信封（ok:false + nudo:usage-error）+ exit 1`, () => {
      const { cwd, file } = makeProject();
      try {
        const r = runCliTsx(c.args(file), { cwd });
        expect(r.status).toBe(1);
        // 旧症状：stdout 空 ⇒ 机器面 JSON.parse 炸
        expect(r.stdout.trim().length).toBeGreaterThan(0);
        const doc = JSON.parse(r.stdout);
        expect(doc.kind).toBe("multi");
        expect(doc.ok).toBe(false);
        expect(doc.pathErrors.length).toBeGreaterThan(0);
        expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
        expect(doc.pathErrors[0].message.length).toBeGreaterThan(0);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }

  it("CLI：非 --json 面仍是 stderr 文案 + exit 1（旧口径不回归）", () => {
    const { cwd } = makeProject();
    try {
      const r = runCliTsx(["check"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Usage error: `nudo check` needs at least one path.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：非 --json 面的组合拒绝仍是 stderr 文案（--fix + --watch）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(["check", file, "--fix", "--watch"], { cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--fix cannot be combined with");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
