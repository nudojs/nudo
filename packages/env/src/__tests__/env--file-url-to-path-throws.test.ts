/**
 * Bug 881 — `node:url.fileURLToPath` 的 apply **把原生异常 catch 掉** ⇒ 恒不抛。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 *   fileURLToPath("file:///tmp/x.txt")  ⇒ OK（"/tmp/x.txt"）
 *   fileURLToPath("not-a-url")          ⇒ 抛 TypeError [ERR_INVALID_URL]
 *                                         （"Invalid URL"）
 *   fileURLToPath("http://example.com/x") ⇒ 抛 TypeError [ERR_INVALID_URL_SCHEME]
 *                                         （"The URL must be of scheme file"）
 *
 * 旧实现：apply 的 catch 分支 `return undefined` ⇒ envFn 回落「返回 string、
 * **永不抛**」——而源码注释却写着「保留 returnType/throws 面」——**envFn 当时
 * 根本没有 throws 面**（注释与实现直接矛盾）⇒ 非法 URL 被静默吞掉 ⇒
 * L2 门禁假绿（原生必抛的入口恒不抛）。
 *
 * 新建模（走 core 的 throws 通道）：非法 URL ⇒ **may-throw TypeError**；
 * 抽象实参 ⇒ 原生可能抛 ⇒ **may-throw TypeError**；合法 URL ⇒ 零抛 + 字面量结果。
 *
 * 断言双向：正向钉住「非法 ⇒ 有 TypeError throws 面 / 合法 ⇒ 零抛且值正确」；
 * 反向（把 catch 分支改回 `return undefined`）本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath as nodeFileURLToPath } from "node:url";
import { strLit, type Abs } from "@nudojs/core";
import { prim } from "../abs-helpers.ts";
import { defineEnv } from "../node.ts";
import { brandName, callSite } from "./env-bug-s4-helpers.ts";

const env = defineEnv();
const url = env.modules!.url!;

/** 原生 oracle：调用 fn，取原生抛出的错误名 / code（不抛 ⇒ undefined） */
function nativeError(fn: () => unknown): { name?: string; code?: string } {
  try {
    fn();
    return {};
  } catch (e) {
    const err = e as Error & { code?: string };
    return { name: err.name, code: err.code };
  }
}

describe("Bug 881 · fileURLToPath 不再吞掉原生异常", () => {
  it("1. 非法 URL ⇒ 有 TypeError throws 面（旧实现恒不抛）", () => {
    // 原生 oracle
    const oracle = nativeError(() => nodeFileURLToPath("not-a-url"));
    expect(oracle.name).toBe("TypeError");
    expect(oracle.code).toBe("ERR_INVALID_URL");

    const site = callSite(url.fileURLToPath!, [strLit("not-a-url")]);
    expect(site.threw, "may-throw must not be a hard throw").toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");
  });

  it("2. 非 file: scheme ⇒ 同样有 TypeError throws 面", () => {
    const oracle = nativeError(() => nodeFileURLToPath("http://example.com/x"));
    expect(oracle.name).toBe("TypeError");
    expect(oracle.code).toBe("ERR_INVALID_URL_SCHEME");

    const site = callSite(url.fileURLToPath!, [strLit("http://example.com/x")]);
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");
  });

  it("3. 合法 file: URL ⇒ 零抛 + 字面量结果（与原生一致）", () => {
    expect(nodeFileURLToPath("file:///tmp/x.txt")).toBe("/tmp/x.txt");
    const site = callSite(url.fileURLToPath!, [strLit("file:///tmp/x.txt")]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(0);
    const term = site.value!.term as { op?: string; value?: unknown };
    expect(term.op).toBe("lit");
    expect(term.value).toBe("/tmp/x.txt");
  });

  it("4. 抽象实参 ⇒ may-throw TypeError（原生在该域上确实可能抛）", () => {
    const site = callSite(url.fileURLToPath!, [prim.str()]);
    expect(site.threw).toBeUndefined();
    expect(site.exits).toHaveLength(1);
    expect(brandName(site.exits[0]!)).toBe("TypeError");
  });

  it("5. 反向对照：throws 面存在 ⇒ 旧实现（恒不抛）会让本文件失败", () => {
    const site = callSite(url.fileURLToPath!, [strLit("not-a-url")]);
    expect(site.exits.length, "old behavior recorded no throw exit at all").toBeGreaterThan(0);
    const exits: Abs[] = site.exits;
    expect(brandName(exits[0]!)).toBe("TypeError");
  });
});
