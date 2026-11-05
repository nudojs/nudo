/**
 * Bug 637 —— 非法 `nudo.check.profile` 的告警文案与**实际生效档位**脱节。
 *
 * 旧文案写死「using default strict」⇒ 诊断说假话：配置里同层还有显式
 * `check.entryThrows:"warning"` 时，实际生效档位是 warning（门禁放行、
 * exit 0），告警却说「using default strict」（用户以为自己的文件没过）。
 *
 * 修复：文案按**最终解析出的档位**生成（解析链 = CLI 显式 > CLI profile >
 * 配置 entryThrows > 配置 profile > 默认 strict）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** L2-only：export 上未消化 may-throw ⇒ 档位可从 exit code 观测 */
const L2_SRC = "export function getName(user){ return user.name; }\n";

function makeProject(nudoCheck: string): { cwd: string; file: string } {
  const cwd = mkdtempSync(join(tmpdir(), "nudo-bug637-"));
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "bug637",
      version: "0.0.0",
      nudo: { check: JSON.parse(nudoCheck) },
    }),
    "utf-8",
  );
  const file = join(cwd, "a.js");
  writeFileSync(file, L2_SRC, "utf-8");
  return { cwd, file };
}

describe("bug 637: profile typo 告警文案按生效档位生成", () => {
  it("profile:\"bogus\" + entryThrows:\"warning\" ⇒ 告警说 using warning（且不说 default strict）", () => {
    const { cwd, file } = makeProject(`{"profile":"bogus","entryThrows":"warning"}`);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).toContain(
        'warning: package.json nudo.check.profile: unknown value "bogus" (expected: adoption | strict) — using warning',
      );
      expect(r.stderr).not.toContain("using default strict");
      // 生效档位 = warning ⇒ L2 降级 ⇒ exit 0（文案与实际一致）
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("1 warning");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("profile:\"bogus\" 单独 ⇒ 仍是 using default strict（默认档文案不变）+ strict 门禁 exit 1", () => {
    const { cwd, file } = makeProject(`{"profile":"bogus"}`);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).toContain(
        'warning: package.json nudo.check.profile: unknown value "bogus" (expected: adoption | strict) — using default strict',
      );
      expect(r.status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("CLI --entry-throws warning 压过配置 profile typo ⇒ 告警说 using warning", () => {
    const { cwd, file } = makeProject(`{"profile":"bogus"}`);
    try {
      const r = runCliTsx(["check", file, "--entry-throws", "warning"], { cwd });
      expect(r.stderr).toContain("— using warning");
      expect(r.stderr).not.toContain("using default strict");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
