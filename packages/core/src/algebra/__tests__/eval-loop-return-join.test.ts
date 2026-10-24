/**
 * Bug 99 回归：抽象 test 的 while/for 体内 return 丢 0 迭代路径。
 *
 * 根因：$for/$whileSeq 把体内 NudoReturn 令牌当异常原样重抛——函数边界
 * 只收体内返回值，0 迭代（test 首轮即假）与后续退出路径的 post-loop 语句
 * 被吞。`while (x < 0) { return 0; } return x` 在 any 参下折 `0 #exact`
 * （unsound：原生 x≥0 时返回 x）。
 *
 * 修复（exec/runtime/control.ts，$switch/$fork 同构）：抽象条件轮的体内
 * return 收为一臂（loopExits 侧信道，函数边界 joinControlExits 汇合），
 * 循环按出口收口后 post-loop 语句作为兄弟臂继续；definite-true 轮
 * （for(;;){return}）与裸宿主调用（无 exits 通道）保持原样冒泡。
 * NudoThrow 是真异常，始终照抛。
 *
 * thunk 边界（exec/runtime/async.ts）：$gen/$async 体自带 try/catch
 * （$catchReturn）是体内 $loopReturn 的目标边界——本地开 loopExits 作用域
 * 收臂，并入终末值域 / promise inner（`while (c) return 5; return 9;` →
 * 终末 5 | 9 / promise<9 | 5>），不再漏成外层函数幻影臂（genObj | 5 /
 * promise<9> | 5）。
 */
import { describe, it, expect } from "vitest";
import { call, callLit, isNever, throwsError } from "./eval-helpers.ts";
import { formatAbs } from "../format.ts";
import { anyAbs } from "../abs.ts";
import { sigOf, issuesOf } from "./nudo-constraints.ts";

/** 结果显示串（去 conf 尾注，锚定值域） */
function disp(r: { result?: unknown }): string {
  return (formatAbs(r.result as never) ?? "").replace(/\s+#[a-z]+(\s+join\([^)]*\))?$/, "");
}

/**
 * 生成器身份探针：**调用被测的同一个生成器函数** ⇒ 检验迭代器协议面
 * （`next` / `return` / `throw` 三个方法槽都是函数）。
 *
 * ⚠ 旧探针调的是**另一个**生成器 `g`（`GEN_PROTO_PROBE`）⇒ 探针恒绿、
 * 对被测函数零信息；叠上投影面的 `/^\{/`（`{}` 也匹配）⇒ 断言整体失效
 * （「是生成器」这件事没人钉）。本探针必须把**被测源**拼进去。
 */
function genIdentityProbe(genSrc: string): string {
  return `${genSrc}
export function probe() { const gi = f(1); return typeof gi.next + "|" + typeof gi.return + "|" + typeof gi.throw; }`;
}

describe("Bug 99: while/for 体内 return 的 0 迭代路径（exec 面）", () => {
  it("while：any 参 → 返回臂与出口续体 join（不再折 0 #exact）", () => {
    const r = call(
      `export function f(x) { while (x < 0) { return 0; } return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("any | 0");
  });

  it("while：具体参 x=5 → 5 精确（0 迭代路径独占，红线）", () => {
    const r = callLit(`export function f(x) { while (x < 0) { return 0; } return x; }`, "f", 5);
    expect(disp(r)).toBe("5");
  });

  it("while：具体参 x=-1 → 0 精确（体内 return 独占）", () => {
    const r = callLit(`export function f(x) { while (x < 0) { return 0; } return x; }`, "f", -1);
    expect(disp(r)).toBe("0");
  });

  it("for：同构——any 参 join、具体参精确", () => {
    const r = call(
      `export function f(x) { for (; x < 0;) { return 0; } return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("any | 0");
    expect(disp(callLit(`export function f(x) { for (; x < 0;) { return 0; } return x; }`, "f", 5))).toBe("5");
  });

  it("post-loop 语句存活：体内 return 后的写与 return 汇合", () => {
    const r = call(
      `export function f(x) { while (x < 0) { return 1; } x = 2; return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("2 | 1");
  });

  it("报告 Repro（守卫形式）：whileGuard any 参 → any | 0", () => {
    const r = call(
      `export function whileGuard(x) { while (x < 0) { return 0; } return x; }`,
      "whileGuard",
      [anyAbs],
    );
    expect(disp(r)).toBe("any | 0");
    expect(disp(callLit(`export function whileGuard(x) { while (x < 0) { return 0; } return x; }`, "whileGuard", 5))).toBe("5");
  });

  it("do-while：体先执行——return 无条件独占（native: 0 恒成立）", () => {
    // 原生语义：do 体先跑 → return 0 无条件到达 → 0 #exact 正确
    const r = call(
      `export function f(x) { do { return 0; } while (x < 0); return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("0");
  });

  it("do-while 抽象条件 + 条件 return：体至少一次与出口续体 join", () => {
    const r = call(
      `export function f(x) { do { if (x < -1) { return 0; } } while (x < 0); return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("any | 0");
  });

  it("嵌套 while：外层 return 与内层出口逐层汇合", () => {
    const r = call(
      `export function f(x) { while (x < 0) { while (x < -1) { return 0; } return 1; } return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("any | 0 | 1");
  });

  it("循环体内 try-catch return：catch 不可达路径正确汇合", () => {
    const r = call(
      `export function f(x) { while (x < 0) { try { return 0; } catch (e) { return 2; } } return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("any | 0");
  });

  it("continue 后 return：出口续体带循环后绑定", () => {
    // 0 迭代臂 x=any（含非数成员：`"a" < 0` 假 → 返回 "a"），体内写 0 的
    // 出口精确 0，return 3 经 exits 汇合——不再吞出口续体
    const r = call(
      `export function f(x) { while (x < 0) { if (x < -5) { return 3; } x = 0; continue; } return x; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("any | 0 | 3");
  });
});

describe("Bug 99: Controls——既有循环面不回归", () => {
  it("while(false)：出口独占（any，体内 return 不可达）", () => {
    expect(disp(call(`export function f(x) { while (false) { return 0; } return x; }`, "f", [anyAbs]))).toBe("any");
    expect(disp(call(`export function f(x) { while (x < 0) { } return x; }`, "f", [anyAbs]))).toBe("any");
  });

  it("definite-true：for(;;)/while(true) 体内 return 保持 #exact（出口臂不可达）", () => {
    expect(disp(callLit(`export function f() { while (true) { return 7; } }`, "f"))).toBe("7");
    expect(disp(callLit(`export function f() { for (;;) { return 7; } }`, "f"))).toBe("7");
  });

  it("具体计数循环：for 精确", () => {
    expect(disp(callLit(`export function f() { let n = 0; for (let i = 0; i < 3; i++) { n++; } return n; }`, "f"))).toBe("3");
  });

  it("体内 throw：NudoThrow 始终照抛（throws 面 / never）", () => {
    const r = call(`export function f(x) { while (x < 0) { throw new TypeError("neg"); } return x; }`, "f", [anyAbs]);
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("无 return 体：出口绑定域不回归（Bug 47/48 宽化口径）", () => {
    // 循环携带累加器 → 无上界 number（sound 超集）；具体参 → 精确 0
    const r = call(
      `export function f(x) { let s = 0; while (x < 0) { s = s + 1; } return s; }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe("number");
    expect(disp(callLit(`export function f(x) { let s = 0; while (x < 0) { s = s + 1; } return s; }`, "f", 5))).toBe("0");
  });

  it("switch 同构对照：抽象 disc 臂 return 正常（值域 join）", () => {
    const r = call(
      `export function f(x) { switch (x) { case 1: return "one"; default: return "other"; } }`,
      "f",
      [anyAbs],
    );
    expect(disp(r)).toBe('"one" | "other"');
  });
});

describe("Bug 99: thunk 边界——gen/async 体内循环 return 不产幻影臂", () => {
  it("async：体内 return 进 promise inner（promise<9 | 5>，无裸 number 臂）", () => {
    const r = call(
      `export async function f(x) { while (x < 0) { return 5; } return 9; }`,
      "f",
      [anyAbs],
    );
    const d = disp(r);
    expect(d).toContain("promise<");
    expect(d).toContain("9 | 5");
    expect(d).not.toMatch(/^promise<[^>]*>\s*\|\s*\d/);
  });

  it("async + await：同构（循环体含 await）", () => {
    const r = call(
      `export async function f(x, p) { while (x < 0) { await p; return 5; } return 9; }`,
      "f",
      [anyAbs, anyAbs],
    );
    const d = disp(r);
    expect(d).toContain("promise<");
    expect(d).toContain("9 | 5");
    expect(d).not.toMatch(/^promise<[^>]*>\s*\|\s*\d/);
  });

  it("generator：循环 return 并入终末值域（对象形状不染 number 臂）", () => {
    const SRC = `export function* f(x) { while (x < 0) { return 5; } return 9; }`;
    const r = call(SRC, "f", [anyAbs]);
    const d = disp(r);
    // Bug 240：生成器的协议槽（next/return/throw/constructor/@@iterator）是
    // internal 槽 ⇒ 不进投影面（`constructor: GeneratorFunction` 不再出现）；
    // 「是生成器对象」改由**运行面**协议槽钉（探针调的是**同一个** `f`）。
    expect(d).toMatch(/^\{/);
    expect(d).not.toMatch(/\|\s*5\b/);
    expect(disp(call(genIdentityProbe(SRC), "probe"))).toBe('"function|function|function"');
  });

  it("generator + switch/fork 臂 return：同款不染（$gen 本地作用域）", () => {
    const SRC = `export function* f(x) { switch (x) { case 1: return 5; } yield 1; return 9; }`;
    const r = call(SRC, "f", [anyAbs]);
    const d = disp(r);
    expect(d).toMatch(/^\{/);
    expect(d).not.toMatch(/\|\s*5\b/);
    expect(disp(call(genIdentityProbe(SRC), "probe"))).toBe('"function|function|function"');
  });

  it("负控制：非生成器函数的同一探针 ⇒ 协议槽是 undefined（探针有鉴别力）", () => {
    const probe = `export function plain(x) { return 42; }
export function probe() { const gi = plain(1); return typeof gi.next + "|" + typeof gi.return + "|" + typeof gi.throw; }`;
    expect(disp(call(probe, "probe"))).toBe('"undefined|undefined|undefined"');
  });
});

describe("Bug 99: 签名面（checkSource）", () => {
  it("whileGuard 入口签名：any 入参返回 any | 0（0 迭代路径入签）", () => {
    const r = issuesOf(`
function whileGuard(x) {
  while (x < 0) { return 0; }
  return x;
}
whileGuard;
`, "/t/loop-ret-sig.js");
    const sig = sigOf(r, "whileGuard");
    expect(sig).toContain("any | 0");
  });

  it("forGuard 入口签名：同构", () => {
    const r = issuesOf(`
function forGuard(x) {
  for (; x < 0;) { return 0; }
  return x;
}
forGuard;
`, "/t/loop-ret-sig.js");
    expect(sigOf(r, "forGuard")).toContain("any | 0");
  });
});
