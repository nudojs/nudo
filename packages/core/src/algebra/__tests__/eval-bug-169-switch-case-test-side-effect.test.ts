/**
 * Bug 169 回归（core 转译层）：`switch` 的 **case 测试副作用不被臂入口快照抹掉**。
 *
 * 修复前：臂入口按「switch 前的快照」恢复绑定（`n = $copy(__sw0_n)`）——而
 * case 测试的副作用发生在**快照之后、臂体之前** ⇒ 被恢复动作**整体抹掉**：
 * `switch (1) { case t(1): n = n + 10; break; }` 原生 n = 11，修复前 n = 10。
 *
 * 修复后：case 测试求值后**刷新基线**（`__sw0_*`）⇒ 臂入口恢复的是「case
 * 测试之后」的状态 ⇒ 测试里的写保留（臂体仍以基线为起点 ⇒ 臂间隔离不变）。
 *
 * 负控制钉住：① 臂体的写仍以基线为起点（臂间隔离不破）；② 无 case 测试的
 * switch 不受影响；③ case 测试求值**恰好一次**（不重复计数）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";
import { anyAbs } from "../abs.ts";

/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string, withArg = false): unknown {
  const r = call(`export function f(x) { ${body} }`, "f", withArg ? [anyAbs] : []);
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}

describe("Bug 169: switch 的 case 测试副作用不被臂入口快照抹掉", () => {
  it("case 测试的写保留（原生 11）", () => {
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (1){case t(1): n = n + 10; break;} return n;`;
    expect(native(body)).toBe(11);
    expect(engine(body)).toBe(11);
  });

  it("case 测试的副作用日志保留（原生 \"t1,one\"）", () => {
    const body = `const log=[]; function t(v){log.push("t"+v);return v;} switch (1){case t(1): log.push("one"); break;} return log.join(",");`;
    expect(native(body)).toBe("t1,one");
    expect(engine(body)).toBe("t1,one");
  });

  it("未命中时前面 case 测试的副作用保留（原生 \"t1,t2,two\"）", () => {
    const body = `const log=[]; function t(v){log.push("t"+v);return v;} switch (2){case t(1): log.push("one"); break; case t(2): log.push("two"); break;} return log.join(",");`;
    expect(native(body)).toBe("t1,t2,two");
    expect(engine(body)).toBe("t1,t2,two");
  });

  it("抽象判别式下 case 测试的副作用同样保留（上界）", () => {
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (x){case t(1): break; case t(2): break;} return n;`;
    expect(engine(body, true)).toBe(2);
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：case 测试只求值一次（不重复计数，原生 1）", () => {
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (1){case t(1): break;} return n;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：无 case 测试的 switch 不受影响（原生 5）", () => {
    const body = `let n = 0; switch (1){default: n = 5;} return n;`;
    expect(native(body)).toBe(5);
    expect(engine(body)).toBe(5);
  });

  it("负控制：臂体的写仍以基线为起点（臂间隔离不破）", () => {
    // 命中 case 1 时：t(1) 的写（n=1）在基线里 ⇒ 臂体 n = 1 + 10 = 11
    const body = `let n = 0; const t = (v) => { n = n + 1; return v; }; switch (1){case t(1): n = n + 10; break; case t(2): n = n + 20; break;} return n;`;
    expect(native(body)).toBe(11);
    expect(engine(body)).toBe(11);
  });
});
