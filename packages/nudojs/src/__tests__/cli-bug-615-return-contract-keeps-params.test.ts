/**
 * Bug 615 —— `nudo export --format standard` 在「**只有返回契约**」时整份参数面
 * 丢失（standard 面一个 `<fn>_<param>` 导出都不产）⇒ 同一次导出里 zod / dts /
 * standard 三个方言的**参数个数互相矛盾**。
 *
 * 该缺陷已修（standard 面的参数位统一取统一参数面 `paramExps`，契约返回位不再
 * 压掉观测参数位）——本文件只补**跨方言一致性回归钉**，防止再次回退。
 *
 * 钉：zod `<fn>Input` 槽数 == dts 形参数 == standard `<fn>_<param>` 导出数。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

/** 有返回契约 + 一个形参的导出函数。 */
function writeReturnContractFixture(dir: string): void {
  writeFileSync(
    join(dir, "withRet.js"),
    `/**
 * @nudo:case "one" (1) => number()
 * @nudo:contract return number()
 */
export function withRet(a) {
  return a;
}
`,
    "utf-8",
  );
}

describe("export — 返回契约不影响参数面（Bug 615 回归钉）", () => {
  it("standard 面仍产出参数位（<fn>_<param>）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug615-"));
    writeReturnContractFixture(dir);

    const r = runCli(["export", join(dir, "withRet.js"), "--format", "standard"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("withRet_a");
  });

  it("跨方言参数个数一致（zod 槽数 == dts 形参数 == standard 参数导出数）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug615-parity-"));
    writeReturnContractFixture(dir);

    const r = runCli(["export", join(dir, "withRet.js"), "--format", "all"]);
    expect(r.status).toBe(0);

    // zod 面：<fn>Input 的槽数 = 1（形参 a）
    const input = /export const withRetInput = z\.object\(\{([\s\S]*?)\}\)/.exec(r.stdout);
    expect(input).not.toBeNull();
    const zodSlots = (input![1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(zodSlots).toHaveLength(1);

    // dts 面：形参数 = 1
    const dts = /export declare function withRet\(([^)]*)\)/.exec(r.stdout);
    expect(dts).not.toBeNull();
    const dtsFormals = (dts![1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(dtsFormals).toHaveLength(1);

    // standard 面：`<fn>_<param>` 导出数 = 1
    const stdParams = [...r.stdout.matchAll(/export const withRet_([A-Za-z_$][\w$]*) =/g)].map(
      (m) => m[1]!,
    );
    expect(stdParams).toHaveLength(1);
    expect(stdParams[0]!.startsWith("a")).toBe(true);

    // 三个方言的参数个数一致
    expect(zodSlots).toHaveLength(dtsFormals.length);
    expect(stdParams).toHaveLength(dtsFormals.length);
  });
});
