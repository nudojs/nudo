/**
 * BUG-112 —— `nudo migrate --json <未知 action>` ⇒ **stdout 空**（0 字节）
 * ⇒ 机器消费方 `JSON.parse("")` 抛「Unexpected end of JSON input」。
 *
 * 违反设计文档的明文契约（`docs/design/cli-semantics.md`）：
 * 「**`--json` 下 stdout 永不为空** —— 即使全部路径失败也输出信封」
 * 「绝不出现空 stdout + 非零 exit」。
 *
 * 反向闸：合法 action 的 `--json` 输出仍是合法 JSON（不得因修失败面而改成功面）。
 */
import { describe, it, expect } from "vitest";
import { runCliTsx } from "./helpers/run-cli.ts";

describe("Bug 112: 未知 action 在 --json 下必须出合法信封", () => {
  it("stdout 非空、可解析、ok:false、error 点名 action", () => {
    const r = runCliTsx(["migrate", "--json", "frobnicate"]);
    expect(r.status).toBe(1);
    expect(r.stdout.length).toBeGreaterThan(0);
    // BUG-017：`--json` 顶层形状恒为数组（信封是单元素数组）
    const __env = JSON.parse(r.stdout) as Array<{ ok: boolean; action: string; error: string }>;
    const parsed = __env[0]!;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("frobnicate");
    expect(parsed.error).toContain("Unknown migrate action");
  });

  it("人类面（无 --json）：错误仍进 stderr", () => {
    const r = runCliTsx(["migrate", "strp"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown migrate action");
  });

  it("反向闸：合法 action 的 --json 仍是合法 JSON", () => {
    const r = runCliTsx(["migrate", "strip", "--json", "packages/nudojs/src/migrate.ts"]);
    // 该目标不是 strip 源 ⇒ 走 no-files 分支，但 stdout 必须是合法 JSON
    expect(r.stdout.length).toBeGreaterThan(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});
