/**
 * export — schema / dialect 命令面（Phase B）。
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cliEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(
    process.execPath,
    [join(repoRoot, "node_modules/tsx/dist/cli.mjs"), cliEntry, ...args],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 1 };
}

function writeFixture(dir: string, name: string, src: string): string {
  const p = join(dir, name);
  writeFileSync(p, src, "utf-8");
  return p;
}

describe("nudo export --format schema", () => {
  it("prints zod dialect schema by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-schema-"));
    const file = writeFixture(
      dir,
      "scale.js",
      `export function scale(x) {\n  return x + 1;\n}\n`,
    );
    const r = runCli(["export", file, "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Schema (zod)");
    expect(r.stdout).toContain("z.");
  });

  it("accepts --dialect zod and writes *.nudo.schema.zod.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-schema-"));
    const file = writeFixture(
      dir,
      "scale.js",
      `export function scale(x) {\n  return x + 1;\n}\n`,
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "schema", "--dialect", "zod", "--out", out]);
    expect(r.status).toBe(0);
    const schemaPath = join(out, "scale.nudo.schema.zod.ts");
    expect(existsSync(schemaPath)).toBe(true);
    const body = readFileSync(schemaPath, "utf-8");
    expect(body).toContain("Schema (zod)");
  });

  it("emits Standard Schema module with --format standard", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-schema-"));
    const file = writeFixture(
      dir,
      "scale.js",
      `export function scale(x) {\n  return x + 1;\n}\n`,
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);
    const p = join(out, "scale.nudo.standard.ts");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf-8");
    expect(body).toContain('"~standard"');
    expect(body).toContain('vendor: "nudo"');
    expect(body).toContain("scaleOutput");
  });

  it("rejects unknown format and unknown dialect", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-export-schema-"));
    const file = writeFixture(dir, "a.js", `export function a(x){ return x; }\n`);
    const badFormat = runCli(["export", file, "--format", "zodx"]);
    expect(badFormat.status).toBe(1);
    expect(badFormat.stderr).toContain("Unknown --format");
    const badDialect = runCli(["export", file, "--format", "schema", "--dialect", "valibot"]);
    expect(badDialect.status).toBe(1);
    expect(badDialect.stderr).toContain("Unknown --dialect");
  });
});
