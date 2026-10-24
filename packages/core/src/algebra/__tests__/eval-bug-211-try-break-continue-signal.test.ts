/**
 * Bug 211 回归（core 运行时）：`try` 块里的 `break` / `continue` **不是异常**——
 * catch 体不得吞掉控制流信号。
 *
 * 修复前：循环信号（NudoLoopSignal，Error 子类）能被 catch 接住，catch 体的
 * 逃逸门只重抛 NudoReturn（`$rethrowIfNudoReturn`）⇒ 信号被「吃掉」：
 * catch 体的副作用照样执行、循环还不退出。
 *   `for (let i=0;i<4;i++){ try{ if(i===1) break; s+=i; } catch(e){ s+="c"; } }`
 *   原生 "0"，修复前 "0c23"（catch 体跑了 3 次，循环跑满 4 轮）。
 *
 * 修复后：catch 体的取值入口 `$catchVal` 遇控制流信号**重抛** ⇒ catch 体不执行、
 * 信号透传到循环捕获点（原生：break 是控制流完成值，根本到不了 catch 处理器）。
 *
 * 负控制钉住：① 真异常仍被 catch 吞掉（catch 体照跑）；② 无 try 的 break/continue
 * 不变；③ try/finally 路径不变（finally 照跑）；④ catch 体内的 break 仍透传
 * （不被 catch 自身的内层 try 吞掉）。
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

describe("Bug 211: try 块里的 break / continue 不被 catch 体吞掉", () => {
  it("try 里的 break：catch 体不跑、循环退出", () => {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ if(i===1) break; s+=i; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("0");
    expect(engine(body)).toBe("0");
  });

  it("try 里的 break：循环计数停在 break 点", () => {
    const body = `let c=0; for(let i=0;i<100;i++){ try{ if(i===3) break; c++; }catch(e){ } } return c;`;
    expect(native(body)).toBe(3);
    expect(engine(body)).toBe(3);
  });

  it("try 里的 continue：catch 体不跑、迭代继续", () => {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ if(i===1) continue; s+=i; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("023");
    expect(engine(body)).toBe("023");
  });

  it("嵌套循环：try 里的 break 退出**内层**循环（外层继续）", () => {
    const body = `let s=""; for(let i=0;i<3;i++){ for(let j=0;j<3;j++){ try{ if(j===1) break; s+="x"; }catch(e){ s+="c"; } } s+="|"; } return s;`;
    expect(native(body)).toBe("x|x|x|");
    expect(engine(body)).toBe("x|x|x|");
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：真异常仍被 catch 吞掉（catch 体照跑）", () => {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ throw 1; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("cccc");
    expect(engine(body)).toBe("cccc");
  });

  it("负控制：无 try 的 break 仍退出循环", () => {
    const body = `let s=""; for(let i=0;i<4;i++){ if(i===1) break; s+=i; } return s;`;
    expect(native(body)).toBe("0");
    expect(engine(body)).toBe("0");
  });

  it("负控制：try/finally 路径不变（finally 照跑、break 生效）", () => {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ if(i===1) break; s+=i; }finally{ s+="f"; } } return s;`;
    expect(native(body)).toBe("0ff");
    expect(engine(body)).toBe("0ff");
  });

  it("负控制：try 块正常路径不受影响", () => {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ s+=i; }catch(e){ s+="c"; } } return s;`;
    expect(native(body)).toBe("0123");
    expect(engine(body)).toBe("0123");
  });

  it("负控制：catch 体里的 break 仍透传到循环（不被 catch 体自身的内层 try 吞掉）", () => {
    const body = `let s=""; for(let i=0;i<4;i++){ try{ throw 1; }catch(e){ if(i===1) break; s+=i; } } return s;`;
    expect(native(body)).toBe("0");
    expect(engine(body)).toBe("0");
  });
});
