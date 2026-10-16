/**
 * `nudo init [path]`（#8）：package.json adoption 基线写入。
 * 三条路径（无 package.json / 已有 nudo 键幂等 / 合法写入）+ 语法
 * 错误不写盘；进程内驱动 commander action（与 check-gitlab 同型）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { registerInitCommand, runInit } from "../commands/init.ts";

async function runInitCli(args: string[]): Promise<void> {
  const program = new Command();
  registerInitCommand(program);
  await program.parseAsync(["node", "nudo", ...args]);
}

function tmpPkg(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-init-"));
  if (content !== undefined) writeFileSync(join(dir, "package.json"), content);
  return dir;
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

describe("nudo init — no package.json", () => {
  it("usage error + exit 1 when nothing upward has a package.json", async () => {
    const dir = tmpPkg(); // 目录内无 package.json，/tmp 之上也不会有
    await runInitCli(["init", dir]);
    expect(process.exitCode).toBe(1);
    expect(errs[0]).toContain("error: no package.json found");
    expect(
      errs.some((l) => l.startsWith("fix:  run `nudo init` inside a package directory")),
    ).toBe(true);
    expect(logs).toHaveLength(0);
  });
});

describe("nudo init — fresh write", () => {
  it("merges nudo key, preserves key order, writes 2-space JSON + trailing newline", async () => {
    const dir = tmpPkg('{\n  "name": "demo",\n  "version": "0.1.0"\n}\n');
    await runInitCli(["init", dir]);
    expect(process.exitCode).toBe(0);
    const written = readFileSync(join(dir, "package.json"), "utf-8");
    const parsed = JSON.parse(written);
    expect(parsed).toEqual({ name: "demo", version: "0.1.0", nudo: { check: { profile: "adoption" } } });
    expect(Object.keys(parsed)).toEqual(["name", "version", "nudo"]);
    expect(written.endsWith("\n")).toBe(true);
    expect(logs.some((l) => l.startsWith("nudo init: wrote adoption baseline to"))).toBe(true);
    expect(logs.join("\n")).toContain('"nudo": {');
    expect(logs.join("\n")).toContain("next steps:");
    expect(logs.some((l) => l.includes("nudo check ."))).toBe(true);
    expect(logs.some((l) => l.includes("nudo contract --draft <file>"))).toBe(true);
    expect(logs.some((l) => l.includes("https://nudojs.github.io/nudo/"))).toBe(true);
  });

  it("finds the nearest package.json walking up from a nested dir or file path", () => {
    const dir = tmpPkg('{"name":"up"}');
    const deep = join(dir, "src", "deep");
    mkdirSync(deep, { recursive: true });
    expect(runInit(deep, { out: () => {}, err: () => {} })).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"))).toEqual({
      name: "up",
      nudo: { check: { profile: "adoption" } },
    });
    // 文件路径：从其 dirname 起向上找（deep 无 package.json → 命中 dir，
    // 已带 nudo 键走幂等路径；旁边的 sibling-pkg 不在向上路径上，不受影响）
    const file = join(deep, "mod.js");
    writeFileSync(file, "export const x = 1;\n");
    mkdirSync(join(deep, "sibling-pkg"));
    writeFileSync(join(deep, "sibling-pkg", "package.json"), '{"name":"nearest"}');
    expect(runInit(file, { out: () => {}, err: () => {} })).toBe(0);
    expect(JSON.parse(readFileSync(join(deep, "sibling-pkg", "package.json"), "utf-8"))).toEqual({
      name: "nearest",
    });
  });

  it("defaults [path] to the current working directory", async () => {
    const dir = tmpPkg('{"name":"cwd"}');
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await runInitCli(["init"]);
    } finally {
      process.chdir(cwd);
    }
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"))).toEqual({
      name: "cwd",
      nudo: { check: { profile: "adoption" } },
    });
  });
});

describe("nudo init — idempotent when nudo key exists", () => {
  it("prints existing config, exit 0, no disk write", async () => {
    const dir = tmpPkg(
      JSON.stringify(
        {
          name: "demo",
          version: "0.1.0",
          nudo: { check: { profile: "strict", ignoreThrows: ["TypeError"] } },
        },
        null,
        2,
      ) + "\n",
    );
    const before = readFileSync(join(dir, "package.json"), "utf-8");
    await runInitCli(["init", dir]);
    expect(process.exitCode).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(before);
    expect(logs.some((l) => l.endsWith("already has a nudo config — nothing written."))).toBe(true);
    expect(logs.join("\n")).toContain('"profile": "strict"');
    expect(logs.join("\n")).toContain('"ignoreThrows"');
  });

  it("second run after a fresh write changes nothing", async () => {
    const dir = tmpPkg('{"name":"demo"}');
    await runInitCli(["init", dir]);
    expect(process.exitCode).toBe(0);
    const afterFirst = readFileSync(join(dir, "package.json"), "utf-8");
    logs = [];
    await runInitCli(["init", dir]);
    expect(process.exitCode).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(afterFirst);
    expect(logs.some((l) => l.endsWith("already has a nudo config — nothing written."))).toBe(true);
  });
});

describe("nudo init — malformed package.json", () => {
  it("syntax error: exit 1, file untouched", async () => {
    const dir = tmpPkg("{ oops\n");
    await runInitCli(["init", dir]);
    expect(process.exitCode).toBe(1);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe("{ oops\n");
    expect(errs[0]).toContain("is not valid JSON — nothing written");
    expect(errs[1]).toContain("fix:  repair it first (parse error:");
  });

  it("non-object JSON (number): exit 1, nothing written", () => {
    const dir = tmpPkg("42\n");
    const io = { out: () => {}, err: () => {} };
    expect(runInit(dir, io)).toBe(1);
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe("42\n");
  });
});
