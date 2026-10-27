/**
 * BUG-056：同文件/同源被**二次求值**——evaluator 的模块执行缓存（
 * generalize.ts / check-may-throw.ts 的 `evalRunMemo`）存的是**活的 run
 * 表**，表里住着模块级 `let` 状态。跨轮复用 ⇒ 上一轮（analyzer 的一次
 * generalize）已经 ++ 过的实例漏给下一轮（check 闸门）⇒ 同一份源码在不同
 * 路径下读出 1 / 2 / 3；且两个**字节相同**的不同文件共用同一个活实例。
 *
 * 修复：求值轮次（epoch）——`runWithCollectorScope` 开新作用域时 +1，两张
 * run 表按轮作废（嵌套入口共享外层轮次，不重复涨轮）；check-may-throw 的
 * 键另带调用点路径（字节相同的不同文件即便同轮也不共用）。
 *
 * 复现口径：`let n = 0; export function bump(){ return ++n; }`——原生恒 1。
 */
import { describe, it, expect } from "vitest";
import { checkSource, generalizeFromAst, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `let n = 0;
export function bump() { return ++n; }
`;

/** check 闸门面：bump() 的签名显示串（原生恒 "1"）。 */
function bumpSig(file: string): string {
  return sigOf(checkSource(file, SRC, pTrue), "bump");
}

describe("BUG-056 module-eval instance identity is round-scoped", () => {
  it("analyzer round 之后 check 闸门仍读到 1（不接续上一轮的活状态）", () => {
    // analyzer 面（service 的 analyzer-abs-eval 同款调用：无 opts）
    generalizeFromAst("bump", SRC);
    expect(bumpSig("/t/bug-056-a.js")).toBe("1");
  });

  it("字节相同的第二个文件不共用实例（各自 1，不是 2/3）", () => {
    generalizeFromAst("bump", SRC);
    expect(bumpSig("/t/bug-056-b.js")).toBe("1");
    expect(bumpSig("/t/bug-056-c.js")).toBe("1");
  });

  it("同一文件重复分析也是新一轮（每次 1）", () => {
    expect(bumpSig("/t/bug-056-d.js")).toBe("1");
    expect(bumpSig("/t/bug-056-d.js")).toBe("1");
  });
});
