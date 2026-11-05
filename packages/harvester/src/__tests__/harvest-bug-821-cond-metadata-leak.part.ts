/**
 * Bug 821 回归（harvester 收割面）：条件类型的 `infer` 元数据经**上下文级单槽**
 * （`ctx.pendingCond`）泄漏进**下一条**签名 ⇒ **逐字相同**的两条声明得到
 * **不同**类型 ⇒ 门禁**冷缓存假红 / 热缓存绿**（结论随缓存状态翻转）。
 *
 * 泄漏链（改前）：接口**属性位**的条件类型把元数据写进上下文级单槽 ⇒ 没人
 * 消费（属性不是签名）⇒ **下一条**函数签名无条件捡走 ⇒ 该签名的返回被换成
 * `condFallback`（假支）⇒ 调用点折出 `0` 而不是 `string`。
 *
 * 改前（tmp/probe/fix-r27/h1a/probe.ts，BEFORE 行）：
 *   one.inferFrom = {"fromVar":"T","via":"promise","inferVar":"U"}   ← 捡来的
 *   two.inferFrom = undefined
 *   one(x) => 0        ← ★ 泄漏的 condFallback（假支）
 *   two(x) => string
 * 改后：
 *   one.inferFrom = undefined   two.inferFrom = undefined
 *   one(x) => string            two(x) => string
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h1a/ts/oracle.ts）：exit=0
 * ⇒ TS 认为 one / two 都返回 string（逐字相同 ⇒ 必须一致）。
 *
 * 契约（双向）：
 *   1. 条件元数据**按条目隔离**：属性位 / 类型位的元数据不属于任何签名，
 *      不许被下一条签名捡走；
 *   2. **逐字相同**的两条声明必须得到**完全相同**的类型（不论遍历顺序、
 *      不论收割几次 ⇒ 冷 / 热缓存两种状态同口径）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, getFnImpl, instantiateReturn, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug821-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn 的 relation 元数据 */
function relOf(env: { globals: Record<string, Abs> }, name: string) {
  return getFnImpl(env.globals[name]!)?.relation;
}

/** 声明的返回类型展示面 */
function retOf(env: { globals: Record<string, Abs> }, name: string): string {
  const rel = relOf(env, name);
  const rt = rel?.returnType;
  return rt ? formatShape(rt) : "<none>";
}

/** 调用点实例化后的返回类型展示面 */
function callOf(env: { globals: Record<string, Abs> }, name: string, arg: Abs): string {
  return formatShape(instantiateReturn(env.globals[name]!, [arg]));
}

const sameFile = [
  `export declare interface Box<T> {`,
  `  payload: T extends Promise<infer U> ? U : 0;`,
  `}`,
  `export declare function one(x: Box<Promise<string>>): string;`,
  `export declare function two(x: Box<Promise<string>>): string;`,
].join("\n");

describe("Bug 821 —— 条件元数据按条目隔离（不跨签名泄漏）", () => {
  it("逐字相同的两条声明 ⇒ 调用点返回类型完全一致", () => {
    const p = writeTemp("a.d.ts", sameFile);
    const env = harvestDts([p]);
    const arg = env.globals.Box!;
    expect(callOf(env, "one", arg)).toBe("string");
    expect(callOf(env, "two", arg)).toBe("string");
    // 反向：不得出现泄漏的假支（0）
    expect(callOf(env, "one", arg)).not.toBe("0");
    expect(callOf(env, "two", arg)).not.toBe("0");
  });

  it("属性位的条件元数据不被下一条签名捡走（inferFrom 必须为空）", () => {
    const p = writeTemp("a.d.ts", sameFile);
    const env = harvestDts([p]);
    // 两条声明的返回位都是 `string`（不是条件类型）⇒ 谁都不该带 inferFrom
    expect(relOf(env, "one")?.inferFrom).toBeUndefined();
    expect(relOf(env, "two")?.inferFrom).toBeUndefined();
    // 反向：显式否掉「捡到了」
    expect(relOf(env, "one")?.inferFrom).not.toBeDefined();
  });

  it("冷 / 热缓存两种状态同口径（重复收割结果不变）", () => {
    const p = writeTemp("a.d.ts", sameFile);
    const cold = harvestDts([p]);
    const hot = harvestDts([p]);
    const arg1 = cold.globals.Box!;
    const arg2 = hot.globals.Box!;
    expect(callOf(cold, "one", arg1)).toBe(callOf(hot, "one", arg2));
    expect(callOf(cold, "two", arg1)).toBe(callOf(hot, "two", arg2));
    expect(callOf(cold, "one", arg1)).toBe("string");
    expect(callOf(hot, "two", arg2)).toBe("string");
  });

  it("遍历顺序不影响结论（接口单独一个文件 / 换文件顺序）", () => {
    const iface = writeTemp(
      "box.d.ts",
      `export declare interface Box<T> { payload: T extends Promise<infer U> ? U : 0; }\n`,
    );
    const fns = writeTemp(
      "fns.d.ts",
      `export declare function one(x: Box<Promise<string>>): string;\n` +
        `export declare function two(x: Box<Promise<string>>): string;\n`,
    );
    const a = harvestDts([iface, fns]);
    const b = harvestDts([fns, iface]);
    expect(callOf(a, "one", a.globals.Box!)).toBe("string");
    expect(callOf(a, "two", a.globals.Box!)).toBe("string");
    expect(callOf(b, "one", b.globals.Box!)).toBe("string");
    expect(callOf(b, "two", b.globals.Box!)).toBe("string");
    expect(retOf(a, "one")).toBe(retOf(b, "one"));
    expect(retOf(a, "two")).toBe(retOf(b, "two"));
  });

  it("真支就是 infer 变量时，元数据仍挂在**自己那条**签名上", () => {
    const p = writeTemp(
      "a.d.ts",
      `export declare function unpack<T>(x: T): T extends Promise<infer U> ? U : T;\n`,
    );
    const env = harvestDts([p]);
    // 自己那条签名必须拿到 inferFrom（否则调用点解不出 U）
    expect(relOf(env, "unpack")?.inferFrom?.via).toBe("promise");
    expect(relOf(env, "unpack")?.inferFrom?.inferVar).toBe("U");
  });
});
