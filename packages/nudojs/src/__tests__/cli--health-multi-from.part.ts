/**
 * Bug 688：`nudo health` 拒绝**多文件** `--from`（`check` / `contract` 接受）
 * ⇒ 错误文案**失实**（"received no paths"，但 paths 明明收到了）+ 建议的
 * 解法把**目标与使用点对调** ⇒ 照做后静默分析错文件、exit 0。
 *
 * 钉（与 check / contract 同口径）：
 * - `nudo health <target> --from a.js b.js`：**接受**多文件 --from，
 *   分析目标仍是 <target>（不得静默换成 b.js）；
 * - 没有任何位置路径时（`nudo health --from a.js b.js`）：仍是 usage error，
 *   且文案**如实**（此时 paths 确实为空——"received no paths" 属实），
 *   与 check / test / contract 同款。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
let lib: string;
let a: string;
let b: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-688-"));
  lib = join(dir, "lib.js");
  a = join(dir, "a.js");
  b = join(dir, "b.js");
  // ESM 包（使用点 import 目标 ⇒ 需要 type:module，否则求值失败 ⇒ 无调用记录）
  writeFileSync(join(dir, "package.json"), '{\n  "name": "nudo-bug-688-fixture",\n  "type": "module"\n}\n');
  // 目标：已固化两条 call@ 见证（与使用点一致 ⇒ 无 witness drift ⇒ 干净的 OK）
  writeFileSync(
    lib,
    '/**\n * @nudo:case "call@a.js:L2" (1)\n * @nudo:case "call@b.js:L2" (2)\n */\nexport function libFn(x) {\n  return x + 1;\n}\n',
  );
  // 使用点：顶层调用（调用发生在函数体内 ⇒ 模块求值期没有调用记录）
  writeFileSync(a, 'import { libFn } from "./lib.js";\nexport const rA = libFn(1);\n');
  writeFileSync(b, 'import { libFn } from "./lib.js";\nexport const rB = libFn(2);\n');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 688: health --from 多文件与 check/contract 同口径", () => {
  it("health <target> --from a.js b.js：接受多文件 --from，分析目标不变", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", lib, "--from", a, b]);
    expect(r.status).toBe(0);
    // 不得再报 variadic 吞噬错误（paths 明明收到了目标）
    expect(r.stderr).not.toContain("variadic");
    expect(r.stderr).not.toContain("received no paths");
    // 分析对象是 lib.js（目标），不是 b.js（使用点）
    expect(r.stdout).toContain(lib);
    expect(r.stdout).not.toContain(b);
    expect(r.stdout).toContain("Result: OK");
  });

  it("同一形态在 --json 面：files[] 只含目标文件", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", lib, "--json", "--from", a, b]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ file: string }>;
    };
    expect(r.status).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.files.length).toBe(1);
    expect(parsed.files[0]!.file).toContain("lib.js");
  });

  it("无位置路径时仍是 usage error，且文案如实（paths 确实为空）", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", "--from", a, b]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("`nudo health` received no paths");
    expect(r.stderr).toContain("fix:");
    // 不得静默扫 cwd
    expect(r.stdout).not.toContain("Result: OK");
  });

  it("单文件 --from 且无位置路径：仍是「requires explicit paths」定向错误", { timeout: 30_000 }, () => {
    const r = runCliTsx(["health", "--from", a]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--from requires explicit paths");
    expect(r.stderr).not.toContain("consumed");
  });
});
