/**
 * Bug 466：`nudo test --from` 指向**解析/求值失败**的现场文件时静默零记录、exit 0
 * （假绿）——`collectCallRecords`（service）把求值异常 blanket 吞成「0 条记录」，
 * 于是「现场文件读失败」与「现场文件里确实没有调用」在下游同形。
 *
 * 修法（CLI 面，packages/nudojs/src/commands/shared.ts）：该现场文件产出 0 条
 * 记录时复跑一次求值（同参数 ⇒ 命中 eval memo）：解析失败 / 求值失败都判为
 * 「现场文件读失败」，与「文件不存在」同口径报错并非零退出。
 *
 * 本文件锁：读失败必须报错 + 非 0 退出；可读但无调用 / 有调用两种邻近形态
 * **不得**被这条修复波及（负控制）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 被测文件：导出 add（entry-only） */
const TARGET_SRC = `export function add(a, b) {
  return a + b;
}
`;
/** 坏现场文件：缺右括号 → 解析失败 */
const BROKEN_SRC = `import { add } from "./target.js";
const x = add(1, 2
`;
/** 好现场文件：可解析可求值，但没有调用 */
const NO_CALL_SRC = `export function helper() {
  return 0;
}
`;
/** 好现场文件：有调用 → 产出 call@ 记录 */
const CALL_SRC = `import { add } from "./target.js";
const r = add(1, 2);
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-466-"));
  writeFileSync(join(dir, "target.js"), TARGET_SRC, "utf-8");
  writeFileSync(join(dir, "broken.js"), BROKEN_SRC, "utf-8");
  writeFileSync(join(dir, "nocall.js"), NO_CALL_SRC, "utf-8");
  writeFileSync(join(dir, "call.js"), CALL_SRC, "utf-8");
  return dir;
}

describe("Bug 466: nudo test --from 现场文件读失败", () => {
  it("解析失败 → 明确报错 + exit 1（改前：静默 0 记录 + exit 0 假绿）", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "broken.js"], { cwd: dir });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Callsite file failed to load");
      expect(r.stderr).toContain("broken.js");
      expect(r.stderr).toContain("fix:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json 面：pathErrors 收录该失败 + exit 1", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "--json", "target.js", "--from", "broken.js"], { cwd: dir });
      expect(r.status).toBe(1);
      const json = JSON.parse(r.stdout) as {
        pathErrors: { path: string; code: string; message: string }[];
      };
      expect(json.pathErrors).toHaveLength(1);
      expect(json.pathErrors[0]!.path).toContain("broken.js");
      expect(json.pathErrors[0]!.message).toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：现场文件可读但没有调用 → 不报错、exit 0", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "nocall.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：现场文件有调用 → 记录被采集（call@ 而非 entry@）、exit 0", () => {
    const dir = fixture();
    try {
      const r = runCli(["test", "target.js", "--from", "call.js"], { cwd: dir });
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("Callsite file failed to load");
      expect(r.stdout).toContain("call@");
      expect(r.stdout).not.toContain("entry@");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
