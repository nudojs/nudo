/**
 * BUG-253 回归：顶层「值位置接口声明」的**接口成员**被提升成 envoy 模块的
 * **全局** ⇒ 引用该 env 的工程里裸写 `x` 被判 `number | undefined`，而 tsc 报
 * TS2304 ⇒ 假绿。
 *
 * 口径（BUG-253 完整修法）：成员提升**只对模块作用域**成立。顶层值位置声明
 * （`export declare const o: Opts;`）的 `p.scope` 是全局作用域 ⇒ 那里**不提升**
 * ⇒ 收割面的 `env.globals` 本身就不含 `x` / `y`（早先只在出口
 * `emitEnvModule` 过滤，收割面仍留着幽灵名字；现已消除源头）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harvestDts, emitEnvModule, promotedNamesOf } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug253-"));
  dirs.push(dir);
  const p = join(dir, "index.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

const WITH_VALUE_DECL = `export interface Opts { x?: number; y: string; }
export declare const o: Opts;
`;
const WITHOUT_VALUE_DECL = "export interface Opts { x?: number; y: string; }\n";

describe("BUG-253 —— 接口成员不得落成 env 模块的全局", () => {
  it("收割面不产生提升成员（x / y 只在接口内部可见）", () => {
    const env = harvestDts([writeTemp(WITH_VALUE_DECL)]);
    expect([...promotedNamesOf(env.globals)]).toEqual([]);
    expect(env.globals.x).toBeUndefined();
    expect(env.globals.y).toBeUndefined();
    // var 本体仍在（default / namespace 消费）
    expect(env.globals.o).toBeDefined();
    // 严格单变量对照：没有值位置声明时同样没有这些名字
    const ctl = harvestDts([writeTemp(WITHOUT_VALUE_DECL)]);
    expect([...promotedNamesOf(ctl.globals)]).toEqual([]);
  });

  it("emitEnvModule 的 globals 只落真实声明（o），不落提升成员", () => {
    const code = emitEnvModule(harvestDts([writeTemp(WITH_VALUE_DECL)]), "optpkg");
    expect(/^\s*o:/m.test(code)).toBe(true);
    expect(/^\s*x:/m.test(code)).toBe(false);
    expect(/^\s*y:/m.test(code)).toBe(false);
  });
});
