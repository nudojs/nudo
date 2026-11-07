/**
 * Bug 644：`nudo check --json --what-if …` **静默吞掉 --json**（stdout 是人读文本）。
 *
 * 症状：--what-if 是早退分支 ⇒ --json/--abs/--gha/--gitlab/--from/--watch/--verbose
 * 全部被静默丢弃（stdout 变成 `Type of "raw": …` 的人读文本、exit 0 ⇒ 机器面
 * `JSON.parse(stdout)` 直接炸）；且多文件时**静默塌缩**成第 1 个（其余文件从未被分析）。
 * 修复：组合表显式拒绝（与 --fix 的拒绝表同款纪律）+ 多文件显式报错。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = `const raw = 1;

export function useRaw() {
  return raw + 1;
}
`;

function makeProject(): { cwd: string; file: string; other: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-644-"));
  const file = join(dir, "a.js");
  const other = join(dir, "b.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(other, SRC, "utf-8");
  return { cwd: dir, file, other };
}

describe("Bug 644 — --what-if 不再静默吞掉机器 / 观察旗标", () => {
  it("CLI：--json --what-if ⇒ 显式 usage error（stdout 是机器可读信封）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(
        ["check", file, "--json", "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(1);
      // 旧症状：stdout 是 `Type of "raw": string` 的人读文本 ⇒ JSON.parse 炸
      expect(r.stdout).not.toContain('Type of "raw"');
      const doc = JSON.parse(r.stdout);
      expect(doc.kind).toBe("multi");
      expect(doc.ok).toBe(false);
      expect(doc.pathErrors[0].code).toBe("nudo:usage-error");
      expect(doc.pathErrors[0].message).toContain("--what-if cannot be combined with --json");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：--abs / --gha / --gitlab / --from / --watch 与 --what-if ⇒ 显式拒绝（exit 1）", () => {
    const { cwd, file, other } = makeProject();
    try {
      const combos: string[][] = [
        ["--abs"],
        ["--gha"],
        ["--gitlab"],
        ["--from", other],
        ["--watch"],
      ];
      for (const combo of combos) {
        const r = runCliTsx(
          ["check", file, ...combo, "--what-if", "raw:string", "--target", "raw"],
          { cwd },
        );
        expect(r.status, combo.join(" ")).toBe(1);
        const out = r.stdout + r.stderr;
        expect(out, combo.join(" ")).toContain("--what-if cannot be combined with");
        expect(out, combo.join(" ")).not.toContain('Type of "raw"');
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：多文件 --what-if 不再静默塌缩成第 1 个（显式报错）", () => {
    const { cwd, file, other } = makeProject();
    try {
      const r = runCliTsx(
        ["check", file, other, "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(1);
      const out = r.stdout + r.stderr;
      expect(out).toContain("--what-if needs exactly one file (got 2)");
      expect(out).not.toContain('Type of "raw"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI：单文件 + 无机器旗标的 --what-if 仍正常回答（旧口径不回归）", () => {
    const { cwd, file } = makeProject();
    try {
      const r = runCliTsx(
        ["check", file, "--what-if", "raw:string", "--target", "raw"],
        { cwd },
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Type of "raw": string');
      expect(r.stdout).toContain("Bindings applied: raw: string");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
