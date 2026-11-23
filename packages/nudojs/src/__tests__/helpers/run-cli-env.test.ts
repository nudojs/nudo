/**
 * CLI runner 的源解析回退：临时夹具没有 tsconfig 时必须注入仓根 tsconfig，
 * 否则 tsx 会从夹具 cwd 解析到各包 dist（陈旧构建）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliEnvForCwd, repoRoot } from "./run-cli.ts";

const savedTsx = process.env.TSX_TSCONFIG_PATH;
const savedDist = process.env.NUDO_TEST_CLI;

beforeEach(() => {
  delete process.env.TSX_TSCONFIG_PATH;
  delete process.env.NUDO_TEST_CLI;
});

afterEach(() => {
  if (savedTsx === undefined) delete process.env.TSX_TSCONFIG_PATH;
  else process.env.TSX_TSCONFIG_PATH = savedTsx;
  if (savedDist === undefined) delete process.env.NUDO_TEST_CLI;
  else process.env.NUDO_TEST_CLI = savedDist;
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "nudo-cli-env-"));
}

describe("cliEnvForCwd：临时夹具的源解析", () => {
  it("cwd 无 tsconfig ⇒ 注入仓根 tsconfig", () => {
    const dir = tempDir();
    try {
      expect(cliEnvForCwd(dir).TSX_TSCONFIG_PATH).toBe(join(repoRoot, "tsconfig.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cwd 已有 tsconfig ⇒ 尊重夹具（不覆盖）", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "tsconfig.json"), "{}\n", "utf-8");
      expect(cliEnvForCwd(dir).TSX_TSCONFIG_PATH).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("显式 TSX_TSCONFIG_PATH ⇒ 尊重调用方", () => {
    const dir = tempDir();
    try {
      expect(
        cliEnvForCwd(dir, { TSX_TSCONFIG_PATH: "/custom/tsconfig.json" }).TSX_TSCONFIG_PATH,
      ).toBe("/custom/tsconfig.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("NUDO_TEST_CLI=dist ⇒ 不注入（CI 跑构建产物）", () => {
    process.env.NUDO_TEST_CLI = "dist";
    const dir = tempDir();
    try {
      expect(cliEnvForCwd(dir).TSX_TSCONFIG_PATH).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
