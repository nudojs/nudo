/**
 * Bug 683 — `nudo health --from` 的使用点若**一条调用记录都没有**，整段 drift
 * 检测被跳过 ⇒ **假绿**（见证早已陈旧仍报 `Result: OK` / exit 0）。
 *
 * 口径：零调用记录 ⇒「**无法判定漂移**」，不是「无漂移」⇒ 必须显式报出并判红。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string) => join(dir, f);

/** 已固化一条见证（现场调用点） */
const LIB = `/**
 * @nudo:case "call@L2" ("Hello World")
 */
export function slugify(s) {
  return s.toLowerCase();
}
`;

/** 使用现场：import 了被分析函数但**从不调用** ⇒ 零调用记录 */
const USAGE_NO_CALL = `import { slugify } from "./lib.js";
console.log(typeof slugify);
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-683-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("usage-no-call.js"), USAGE_NO_CALL);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 683: --from 零调用记录 ⇒ 不得静默跳过漂移检测", () => {
  it("文本面：显式报「无法判定漂移」+ exit 1（不得 Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage-no-call.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stderr).toContain("Cannot determine witness drift");
    expect(r.stderr).toContain("fix:");
  });

  it("--json 面：ok:false + pathErrors 给出原因（机器面不得读到「一切正常」）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("usage-no-call.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.pathErrors?.[0].message).toContain("Cannot determine witness drift");
  });

  it("对照组：没有任何冻结见证时，零记录不判红（不得给合法用法发假红）", { timeout: 60_000 }, () => {
    const plain = join(dir, "plain.js");
    writeFileSync(plain, "export function id(x) {\n  return x;\n}\n");
    const r = runCliTsx(["health", "--json", plain, "--from", p("usage-no-call.js")]);
    const parsed = JSON.parse(r.stdout) as { ok: boolean; pathErrors?: unknown[] };
    expect(parsed.pathErrors ?? []).toEqual([]);
    expect(parsed.ok).toBe(true);
    expect(r.status).toBe(0);
  });
});
