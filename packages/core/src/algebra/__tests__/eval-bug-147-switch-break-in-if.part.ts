/**
 * Bug 147 回归（core 转译层）：switch 臂内（含 **if 臂内**）的 break 必须
 * **退出 switch**。
 *
 * 修复前：switch 臂内的 break 发射 `return;`——只结束**最近的 thunk**。
 * 于是 if 臂里的 break 只结束 if 臂 thunk ⇒ 臂内后续语句照跑（静态贯穿
 * 合流也照串）：`switch (1) { case 1: if (true) break; r += "x"; }` 原生
 * 返回 ""，修复前返回 "x"。
 *
 * 修复后：switch 臂内的 break 发射**带标签**的 break 信号
 * （`$loopBreak(<switch 标签>)`）——信号穿过嵌套 thunk（if 臂），由 switch
 * 臂入口的 catch 吸收 ⇒ 臂结束、switch 随之结束；带标签 ⇒ 外层循环不吸收
 * （`$isBreakTo` 只匹配同标签）。
 *
 * 负控制钉住：① 循环内的 break 仍退出**循环**（不是 switch）；② 循环内的
 * continue 仍退出**循环**；③ 带标签 break 仍指向带标签块；④ 裸 break（臂
 * 顶层）仍退出 switch。
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

describe("Bug 147: switch 臂内（含 if 臂内）的 break 退出 switch", () => {
  it("if 臂里的 break 退出 switch（原生 \"\"）", () => {
    const body = `let r = ""; switch (1) { case 1: if (true) break; r += "x"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  });

  it("if 臂里的 break 退出 switch（块形态）", () => {
    const body = `let r = ""; switch (1) { case 1: if (true) { break; } r += "x"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  });

  it("if/else 形态：else 分支的 break 也退出 switch", () => {
    const body = `let r = ""; switch (1) { case 1: if (false) { r += "n"; } else { break; } r += "y"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  });

  it("命中第二个 case 时，if 臂里的 break 不影响 default 臂", () => {
    const body = `let r = ""; switch (2) { case 1: r += "1"; break; case 2: if (true) break; r += "2"; default: r += "d"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  });

  it("条件 break：假分支继续贯穿（原生 \"bb\"）", () => {
    const body = `function f(c) { let r = ""; switch (1) { case 1: if (c) break; r += "b"; case 2: r += "b"; break; } return r; } return f(false);`;
    expect(native(body)).toBe("bb");
    expect(engine(body)).toBe("bb");
  });

  it("条件 break：真分支退出 switch（原生 \"\"）", () => {
    const body = `function f(c) { let r = ""; switch (1) { case 1: if (c) break; r += "b"; case 2: r += "b"; break; } return r; } return f(true);`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  });

  // --- 负控制 ---------------------------------------------------------
  it("负控制：臂内循环的 break 退出循环（不是 switch）", () => {
    const body = `let r = ""; switch (1) { case 1: for (let i = 0; i < 3; i++) { if (i === 1) break; r += "f"; } r += "g"; } return r;`;
    expect(native(body)).toBe("fg");
    expect(engine(body)).toBe("fg");
  });

  it("负控制：臂内循环的 continue 退出循环（不是 switch）", () => {
    const body = `let r = ""; switch (1) { case 1: for (let i = 0; i < 3; i++) { if (i === 1) continue; r += "f"; } r += "g"; } return r;`;
    expect(native(body)).toBe("ffg");
    expect(engine(body)).toBe("ffg");
  });

  it("负控制：带标签 break 仍指向带标签块", () => {
    const body = `let r = ""; outer: { switch (1) { case 1: break outer; } r += "x"; } return r;`;
    expect(native(body)).toBe("");
    expect(engine(body)).toBe("");
  });

  it("负控制：臂顶层的裸 break 仍退出 switch", () => {
    const body = `let r = ""; switch (1) { case 1: r += "a"; break; } r += "b"; return r;`;
    expect(native(body)).toBe("ab");
    expect(engine(body)).toBe("ab");
  });
});
