/**
 * package.json#nudo.check.profile typo 警告（DX P1）：
 * 非法 profile（如 "adpotion"）此前被 checkGateFromConfig 静默丢弃回落
 * strict，零警告——用户以为在 adoption 档。CLI 旗标有 validateGateFlags
 * 校验而配置面没有；本测试钉住配置面的 stderr warning（不影响 exit code）。
 * entryThrows typo 由 service 层 checkConfig 单源告警（同链必经），不在此重复。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 无 may-throw 的绿文件：warning 是 stderr 上唯一预期的噪音源 */
const CLEAN_SRC = "export function id(x) { return x; }\n";

function makeProject(pkgNudoCheck: string | null): { cwd: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-gate-typo-"));
  const file = join(dir, "id.js");
  writeFileSync(file, CLEAN_SRC, "utf-8");
  if (pkgNudoCheck !== null) {
    writeFileSync(
      join(dir, "package.json"),
      `{"name":"typo-proj","version":"0.0.0","nudo":{"check":${pkgNudoCheck}}}\n`,
      "utf-8",
    );
  }
  return { cwd: dir, file };
}

describe("package.json nudo.check.profile typo warning", () => {
  it("typo profile → stderr warning（期望值串 + 回落 strict），不影响 exit code", () => {
    const { cwd, file } = makeProject(`{"profile":"adpotion"}`);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).toContain(
        'warning: package.json nudo.check.profile: unknown value "adpotion" (expected: adoption | strict) — using default strict',
      );
      // 配置层警告不挡门禁：绿文件仍 exit 0
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("合法配置（adoption + warning）零 warning", () => {
    const { cwd, file } = makeProject(`{"profile":"adoption","entryThrows":"warning"}`);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).not.toContain("warning: package.json nudo.check");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("合法 strict 配置零 warning", () => {
    const { cwd, file } = makeProject(`{"profile":"strict"}`);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).not.toContain("warning: package.json nudo.check");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("无 package.json → 无 warning（未设置不是 typo）", () => {
    const { cwd, file } = makeProject(null);
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.stderr).not.toContain("warning: package.json nudo.check");
      expect(r.status).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
