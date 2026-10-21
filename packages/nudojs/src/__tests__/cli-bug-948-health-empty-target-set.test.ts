/**
 * Bug 948 — `nudo health --json` 在**空目标集**时给出 `"ok": true` + `"files": []`
 * + exit 0 ⇒ 机器消费者读到「一切正常」，而实际上**一个文件都没检查**（文本面
 * 仅一行「No files to check.」）。
 *
 * 口径：空目标集 = 「一个文件都没检查」⇒ 与 `nudo check` 同口径判红
 * （pathEmptyDir 错误 + ok:false + 非零 exit）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
let emptyDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-948-"));
  emptyDir = join(dir, "emptydir");
  mkdirSync(emptyDir);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 948: 空目标集不得报「一切正常」", () => {
  it("--json 面：ok:false + files:[] + 非零 exit", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", emptyDir]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: unknown[];
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(parsed.files).toEqual([]);
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.pathErrors?.[0].code).toBe("nudo:path-empty-dir");
  });

  it("文本面：不得只给一行「No files to check.」——必须说清没检查任何文件并判红", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", emptyDir]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("No nudo files found in directory");
  });

  it("跨动词同口径：nudo check 对同一空目录也判红", { timeout: 60_000 }, () => {
    const check = runCliTsx(["check", emptyDir]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("No nudo files found in directory");
  });
});
