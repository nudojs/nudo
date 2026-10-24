/**
 * Bug 379（单元层）：类**实例方法桥**的 throws 证据。
 *
 * check-may-throw.ts 的类分支此前只有静态桥（`$staticInvoke`）⇒ 实例方法
 * 走静态桥只会折 unknown（**不抛**）⇒ 拿不到任何 throws 证据 ⇒ L2 门禁对
 * 类实例方法完全无感（假绿）。
 *
 * 修法：补实例方法桥（类 Abs → `$new`（构造实参 any）→ `$invoke`）；
 * 静态/实例按**源码类声明**判定（运行期无法用返回值区分）。
 */
import { describe, it, expect } from "vitest";
import { pTrue } from "../index.ts";
import { evalThrowsOutcome } from "../check-may-throw.ts";
import { parseSource } from "../parse-source.ts";
import { throwAbsToKinds } from "../may-throw.ts";

const clsSrc = `export class Counter {
  boom() { throw new TypeError("explicit"); }
  inc(by) { return by + 1; }
  static smake() { return 1 + Symbol("x"); }
}
`;

describe("Bug 379：类实例方法桥（单元层）", () => {
  it("实例方法 ⇒ analyzed 且 throws 域带 TypeError（改前：absent / 无证据）", () => {
    const file = parseSource(clsSrc);
    const out = evalThrowsOutcome(clsSrc, "Counter.boom", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") return;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  });

  it("静态方法口径不变（仍走 $staticInvoke）", () => {
    const file = parseSource(clsSrc);
    const out = evalThrowsOutcome(clsSrc, "Counter.smake", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") return;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  });

  it("export default class 的实例方法同样走实例桥（导出槽兜底）", () => {
    const src = `export default class D { boom() { throw new TypeError("x"); } }`;
    const file = parseSource(src);
    const out = evalThrowsOutcome(src, "D.boom", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") return;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  });
});
