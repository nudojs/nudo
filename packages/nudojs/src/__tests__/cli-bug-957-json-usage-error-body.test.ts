/**
 * Bug 957：`nudo test --json` 的**用法错误**路径产出「**空 stdout + 非零
 * exit**」⇒ 违反「`--json` 下 stdout 永不为空 / 绝不出现空 stdout + 非零
 * exit」的机器面契约；而**同一动词**的路径失败路径**有**合法
 * `pathErrors[]` 信封 ⇒ 机器面自相矛盾。
 *
 * 根因：全部用法错误分支都排在 CaseJson 序列化点**之前**，且沿用「写
 * stderr + exit 1 + return」的人类面约定 ⇒ `--json` 下机器面根本没有机会
 * 产出。
 *
 * 修复：用法错误在 `--json` 下也走**同一条** CaseJson 失败信封
 * （`pathErrors[{code:"nudo:usage-error"}]` + exit 1）；非 `--json` 面的人读
 * 文案**不变**。
 *
 * ⚠ 码：用法错误码本地定义在 `commands/test.ts`（不改 `shared.ts` 的
 * `PathError["code"]` 联合）——**Bug 1087**：该码原为 `"usage-error"`，与
 * `check` / `contract` 的 `"nudo:usage-error"` **分叉** ⇒ 同一类错误在三个
 * 动词产出不同的机器码 ⇒ 消费者要为 test 单独维护一张码表 ⇒ 已统一为
 * `"nudo:usage-error"`（`"syntax-error"` 保持不变）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

const SRC = `export function one() {
  return 1;
}
`;

function makeProject(): { cwd: string; file: string; other: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-cli-957-"));
  const file = join(cwd, "one.js");
  const other = join(cwd, "two.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(other, SRC, "utf-8");
  return { cwd, file, other };
}

describe("Bug 957 — test --json 的用法错误也必须有机器可读 body", () => {
  const cases: Array<{ name: string; args: (p: { file: string; other: string }) => string[] }> = [
    { name: "无路径", args: () => ["test", "--json"] },
    { name: "--json + --abs", args: (p) => ["test", p.file, "--json", "--abs"] },
    { name: "--json 多文件", args: (p) => ["test", p.file, p.other, "--json"] },
    { name: "--json + --freeze（旗标吞路径）", args: (p) => ["test", "--json", "--freeze", p.file] },
    { name: "--json + --from（变参吞路径）", args: (p) => ["test", "--json", "--from", p.file] },
    { name: "--json + --exit-on-diff（无 --freeze）", args: (p) => ["test", p.file, "--json", "--exit-on-diff"] },
  ];

  for (const c of cases) {
    it(`CLI：${c.name} ⇒ stdout 是 CaseJson 信封（pathErrors[{code:\"nudo:usage-error\"}]）+ exit 1`, () => {
      const p = makeProject();
      try {
        const r = runCli(c.args(p), { cwd: p.cwd });
        expect(r.status).toBe(1);
        // 旧症状：stdout 0 字节 ⇒ 机器面 JSON.parse 炸
        expect(r.stdout.trim().length, `stdout 为空：${r.stderr}`).toBeGreaterThan(0);
        const doc = JSON.parse(r.stdout);
        expect(doc.version).toBe(1);
        expect(Array.isArray(doc.pathErrors)).toBe(true);
        expect(doc.pathErrors.length).toBeGreaterThan(0);
        // Bug 1087：用法错误码与 check / contract 同码（`nudo:usage-error`）
        expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
        expect(doc.pathErrors[0].message.length).toBeGreaterThan(0);
        // 与路径错误信封同形（同一动词不再有两条失败通道）
        expect(Array.isArray(doc.functions)).toBe(true);
        expect(Array.isArray(doc.diagnostics)).toBe(true);
        expect(doc.assertions).toEqual({ passed: 0, failed: 0, unchecked: 0 });
      } finally {
        rmSync(p.cwd, { recursive: true, force: true });
      }
    }, 30000);
  }

  it("CLI：非 --json 面的人读文案不变（stderr 一行 + stdout 空 + exit 1）", () => {
    const p = makeProject();
    try {
      const r = runCli(["test"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Usage error: `nudo test` needs at least one path.");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("CLI：非 --json 面的其它用法错误文案不变（--exit-on-diff 无 --freeze）", () => {
    const p = makeProject();
    try {
      const r = runCli(["test", p.file, "--exit-on-diff"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("--exit-on-diff");
      expect(r.stderr).toContain("--freeze");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("CLI：路径错误信封（对照）仍是 pathErrors 机器码，两条通道同形", () => {
    const p = makeProject();
    try {
      const r = runCli(["test", join(p.cwd, "missing.js"), "--json"], { cwd: p.cwd });
      expect(r.status).toBe(1);
      expect(r.stdout.trim().length).toBeGreaterThan(0);
      const doc = JSON.parse(r.stdout);
      expect(doc.pathErrors.length).toBeGreaterThan(0);
      expect(doc.pathErrors[0].code).toBe("nudo:path-not-found");
    } finally {
      rmSync(p.cwd, { recursive: true, force: true });
    }
  }, 30000);
});
