/**
 * ABS-12 · CLI `--capabilities strict|trusted` 开关。
 *
 * strict（默认）：denied 宿主面报 `nudo:capability-denied`；
 * trusted：退回旧面 `nudo:builtin-unknown`；
 * 非法取值：usage error（exit 1，直指旗标）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode } from "./helpers/run-cli.ts";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-abs12-flag-"));
  file = join(dir, "fetch.js");
  writeFileSync(
    file,
    '/** @nudo:case "f" () */\nexport function f() {\n  return fetch("https://example.com/");\n}\n',
    "utf-8",
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const out = (r: { stdout: string; stderr: string }): string => `${r.stdout}\n${r.stderr}`;

describe("ABS-12 · CLI --capabilities", () => {
  it("默认 strict：denied 全局报 capability-denied", () => {
    const r = runCliNode(["test", file]);
    expect(r.status).toBe(0);
    expect(out(r)).toContain("nudo:capability-denied");
  });

  it("--capabilities trusted：退回 builtin-unknown", () => {
    const r = runCliNode(["test", "--capabilities", "trusted", file]);
    expect(r.status).toBe(0);
    expect(out(r)).toContain("nudo:builtin-unknown");
    expect(out(r)).not.toContain("nudo:capability-denied");
  });

  it("非法取值：usage error（exit 1）", () => {
    const r = runCliNode(["test", "--capabilities", "nope", file]);
    expect(r.status).toBe(1);
    expect(out(r)).toContain('--capabilities expects "strict" or "trusted"');
  });

  it("check 同样接受该开关（trusted 下不再报 capability-denied）", () => {
    const r = runCliNode(["check", "--capabilities", "trusted", file]);
    expect(r.status).toBe(0);
    expect(out(r)).not.toContain("nudo:capability-denied");
  });
});
