/**
 * Bug 228 回归（core 转译层）：`for (let i = …)` 主路径——`continue` **之前**对
 * 循环变量的写不得被丢弃。
 *
 * 修复前：循环变量是**状态线程形参**（`(i) => { … return i; }`），体对它的写
 * 留在形参槽里；`continue` 抛信号跳出体 ⇒ 体的 `return i` 不执行 ⇒ `$for` 的
 * continue 臂只能拿「体入口的旧 state」⇒ 迭代次数与结果全错
 * （`for (var i)` 走 fallback 路径、循环变量是真绑定 ⇒ 行为分叉）。
 *   `for (let i=0;i<3;i++){ c=c+1; i=5; continue; }` 原生 c=1，修复前 c=3。
 *
 * 修复后：体用 try/finally 把「体退出瞬间的循环变量最新写」写回共享槽，
 * `$for` 的 continue 臂经 `loopVar` 回调取用 ⇒ 步进基于本轮真实值
 * （原生：for (let i…) 每轮绑定独立，continue 前的 `i = 5` 写进本轮绑定
 * ⇒ 下一轮 i++ 得 6 ⇒ 6 < 3 为假 ⇒ 只跑 1 轮）。
 *
 * 负控制钉住：① `for (var i)` 路径不变；② 无写时 continue 行为不变；
 * ③ 不带 continue 的写仍生效（步进基于最新值）；④ break 路径不变。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

/** 原生 oracle（node 直接求值） */
function native(body: string): unknown {
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/** 引擎求值（结果字面量值；非字面量 → "not-lit"） */
function engine(body: string): unknown {
  const r = call(`export function f() { ${body} }`, "f");
  const lv = litValue(r.result);
  return lv.ok ? lv.value : `not-lit:${r.result}`;
}

describe("Bug 228: for (let i) 的 continue 之前的循环变量写不得丢弃", () => {
  it("continue 之前的写生效：只跑 1 轮", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; continue; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("continue 之前的写生效（条件 continue 形态）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; if(c<9){ continue; } } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("continue 之前的写生效（累加形态）", () => {
    const body = `let s=0; for(let i=0;i<4;i++){ s=s+i; i=i+2; continue; } return s;`;
    expect(native(body)).toBe(3);
    expect(engine(body)).toBe(3);
  });

  it("continue 之前的写生效（if 臂内 continue）", () => {
    const body = `let c=0; for(let i=0;i<5;i++){ if(i===1){ i=9; continue; } c=c+1; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：for (var i) 路径不变（循环变量是真绑定）", () => {
    const body = `let c=0; for(var i=0;i<3;i++){ c=c+1; i=5; continue; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：无写时 continue 行为不变（跑满 3 轮）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; continue; } return c;`;
    expect(native(body)).toBe(3);
    expect(engine(body)).toBe(3);
  });

  it("负控制：不带 continue 的写仍生效（步进基于最新值）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：break 路径不变（退出循环，计数停在 break 点）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; break; } return c;`;
    expect(native(body)).toBe(1);
    expect(engine(body)).toBe(1);
  });

  it("负控制：同块多个 for 循环不互相污染（捕获槽唯一）", () => {
    const body = `let c=0; for(let i=0;i<3;i++){ c=c+1; i=5; continue; } for(let j=0;j<3;j++){ c=c+1; } return c;`;
    expect(native(body)).toBe(4);
    expect(engine(body)).toBe(4);
  });
});
