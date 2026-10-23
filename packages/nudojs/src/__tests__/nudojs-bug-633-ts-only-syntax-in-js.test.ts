/**
 * Bug 633 — `nudo check` 对 `.js` 里的 **TS-only 语法**判 **OK / exit 0**
 * （CI 门禁假绿）：`node --check` 自己拒绝该文件（SyntaxError）。
 *
 * 修法（族 18 片 4）：
 * - core `parseSource` 新增 `filename` 选项 ⇒ **按扩展名**选解析插件
 *   （`.js` / `.mjs` / `.cjs` / `.jsx` **不开** typescript 插件）；
 * - check 面按扩展名复核（`parseForCheck`）⇒ TS-only 语法走既有**语法错
 *   通道**（人类面 tsc 风格块 / `--json` 面 pathErrors + ok:false / `--fix`
 *   面残余 error ⇒ exit 1），不再静默判绿。
 *
 * oracle（改前 → 改后）：
 *   改前 `nudo check privfield.js` ⇒ OK / 0 error / exit 0
 *   改后 `nudo check privfield.js` ⇒ 语法错块（2:11 — syntax error:
 *         TypeScript-only syntax is not valid in a .js file）/ exit 1
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

/** `.js` 里的 TS-only 语法（Node 自己拒绝：`node --check` ⇒ SyntaxError） */
const TS_ONLY_JS = `export class A {
  private x = 0;
  m() { return this.x; }
}
`;

const PLAIN_JS = `export function f(x) {
  return x;
}
`;

function project(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b633-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "b633", version: "1.0.0", type: "module" }),
    "utf-8",
  );
  writeFileSync(join(dir, "lib.js"), src, "utf-8");
  return dir;
}

describe("Bug 633 — .js 里的 TS-only 语法不得判绿", () => {
  it("人类面：语法错块 + exit 1（此前 OK / exit 0）", { timeout: 60_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toContain("syntax error");
    expect(out).toContain("TypeScript-only syntax");
    // 不得再出现「判绿」的签名面
    expect(out).not.toContain("A.m() => 0");
  });

  it("--json 面：信封 ok:false + pathErrors[0].code=syntax-error", { timeout: 60_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", "--json", join(dir, "lib.js")]);
    const json = JSON.parse(r.stdout) as {
      ok: boolean;
      pathErrors?: Array<{ code: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    expect(json.pathErrors?.[0]?.code).toBe("syntax-error");
    expect(json.pathErrors?.[0]?.message).toContain("TypeScript-only syntax");
    expect(r.status).toBe(1);
  });

  it("check --fix 不得静默跳过：残余 error ⇒ exit 1", { timeout: 60_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const r = runCli(["check", "--fix", join(dir, "lib.js")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(1);
    expect(out).toContain("residual error");
    expect(out).toContain("TypeScript-only syntax");
  });

  it("磁盘缓存不得把「假绿」固化：连跑两轮都判红", { timeout: 90_000 }, () => {
    const dir = project(TS_ONLY_JS);
    const cacheDir = mkdtempSync(join(tmpdir(), "nudo-b633-cache-"));
    const file = join(dir, "lib.js");
    const first = runCli(["check", file], { env: { NUDO_CACHE_DIR: cacheDir } });
    expect(first.status, first.stdout + first.stderr).toBe(1);
    const second = runCli(["check", file], { env: { NUDO_CACHE_DIR: cacheDir } });
    expect(second.status, second.stdout + second.stderr).toBe(1);
    expect(second.stdout + second.stderr).toContain("TypeScript-only syntax");
  });

  it("纯 JS 文件不受影响：仍判绿（exit 0）", { timeout: 60_000 }, () => {
    const dir = project(PLAIN_JS);
    const r = runCli(["check", join(dir, "lib.js")]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("`.ts` 文件仍允许 TS 语法（按扩展名收紧，不误伤 TS 面）", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b633-ts-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "b633ts", version: "1.0.0", type: "module" }),
      "utf-8",
    );
    writeFileSync(join(dir, "lib.ts"), TS_ONLY_JS, "utf-8");
    const r = runCli(["check", join(dir, "lib.ts")]);
    const out = r.stdout + r.stderr;
    expect(r.status, out).toBe(0);
    expect(out).not.toContain("TypeScript-only syntax");
  });
});
