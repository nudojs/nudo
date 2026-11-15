/**
 * BUG-037：`nudo health --from` 对**从未冻结**（没有任何 `call@` 见证）的文件
 * 发**假红**——重新固化后多出来的见证被算成 `added`。
 *
 * 代码自己的不变量（health.ts 的 683 注释 / CHANGELOG 936）：
 * 「只有**存在待验证的冻结见证**时才判『无法判定』——没有冻结见证时
 * 『0 drift』属实（不得因此给合法用法发假红）」。
 *
 * 修复：漂移判定同时要求 `frozenWitnesses > 0`。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string): string => join(dir, f);

/** 从未冻结：没有任何 @nudo:case / call@ 指令 */
const LIB = `export function shout(s) {
  return String(s).toUpperCase();
}
`;

const USAGE = `import { shout } from "../lib2.js";
shout("hi");
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-037-"));
  mkdirSync(p("tests"));
  writeFileSync(p("lib2.js"), LIB);
  writeFileSync(p("tests/usage.js"), USAGE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BUG-037: 从未冻结的文件 + --from ⇒ 0 drift（不发假红）", () => {
  it("文本面：0 case drift / Result: OK / exit 0（旧行为：1 case drift / FAIL / exit 1）", () => {
    const r = runCliTsx(["health", p("lib2.js"), "--from", p("tests/usage.js")], { cwd: dir });
    expect(r.stdout, r.stdout).toContain("0 case drift");
    expect(r.stdout).not.toContain("drift:");
    expect(r.stdout).toContain("Result: OK");
    expect(r.status).toBe(0);
  }, 60_000);

  it("--json 面：ok:true 且 files[0] 无 drift 字段", () => {
    const r = runCliTsx(["health", "--json", p("lib2.js"), "--from", p("tests/usage.js")], {
      cwd: dir,
    });
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ drift?: unknown }>;
      summary: { drift: number };
    };
    expect(json.ok).toBe(true);
    expect(json.summary.drift).toBe(0);
    expect(json.files[0]?.drift).toBeUndefined();
  }, 60_000);
});
