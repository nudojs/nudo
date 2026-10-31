/**
 * BUG-026 —— `export --format all` 把 rest 参数投影成「**数组的数组**」，
 * 而 dts 面是单数组 ⇒ 同一份产物集里两个方言给出不同的接受集。
 *
 * 根因：`observedRestAbs` 按「rest 位之后每个实参一个槽」遍历 `argAbs`，但
 * 入口见证（`entry@`）把剩余参数编码成**一个数组实参** ⇒ 那个数组被当成
 * 「单个 rest 实参」再包一层。
 *
 * 钉：zod / standard 的 rest 槽是**一层**数组（`z.array(z.unknown())` /
 * `{"k":"arr","element":{"k":"unknown"}}`），与 dts 的 `...rest: any[]` 同形。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function withRest(a, ...rest) {\n  return rest.length;\n}\n";

describe("BUG-026 — rest 参数在 zod / standard 面是**一层**数组", () => {
  it("zod 入参槽 = z.array(z.unknown())（不是数组的数组）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b026-"));
    dirs.push(dir);
    writeFileSync(join(dir, "rest.js"), SRC, "utf-8");
    const r = runCliTsx(["export", join(dir, "rest.js"), "--format", "schema"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rest: z.array(z.unknown())");
    expect(r.stdout).not.toContain("z.array(z.array(");
  }, 60000);

  it("standard 面 rest 槽节点只有一层 arr（与 dts 的 ...rest: any[] 同形）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-b026-std-"));
    dirs.push(dir);
    writeFileSync(join(dir, "rest.js"), SRC, "utf-8");
    const all = runCliTsx(["export", join(dir, "rest.js"), "--format", "all"]);
    expect(all.status).toBe(0);
    // BUG-109：rest 槽恒可选 ⇒ standard 槽带 "optional":true（一层数组不变）
    expect(all.stdout).toContain('{"key":"rest","node":{"k":"arr","element":{"k":"unknown"}},"optional":true}');
    expect(all.stdout).not.toContain('{"key":"rest","node":{"k":"arr","element":{"k":"arr"');
    expect(all.stdout).toContain("...rest: any[]");
  }, 60000);
});
