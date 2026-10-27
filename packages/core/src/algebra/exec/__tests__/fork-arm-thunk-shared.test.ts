/**
 * fork 臂包装共享实现钉（`emit.ts` 的 `forkArmThunkExpr`）。
 *
 * 背景：语句位 if 分叉（`stmt/statement.ts`）与早退提升（`stmt/fn-body.ts`）
 * 此前各有一份**逐字相同**的 inline `wrapArm`（名字成对一致靠手工同步）。
 * 现两处共用 `forkArmThunkExpr`；本测试钉住：
 * - 无绑定名 ⇒ 原样返回 thunk（不引入包装层）；
 * - 有绑定名 ⇒ 臂入口快照恢复 / try-catch-finally / 臂尾槽位 + set 标志；
 * - 内部临时名仍走 `forkTmpNames`（声明点与引用点成对一致 / 用户撞名避让）；
 * - 两条语句路径的产物逐字一致（同协议同源）。
 */
import { describe, it, expect } from "vitest";
import { forkArmThunkExpr } from "../transpile/emit.ts";
import { transpileSource } from "../../index.ts";

const THUNK = `() => {\n  return $lit(1);\n}`;

/** 无碰撞时 cons 臂的完整包装（与 refactor 前 inline 副本逐字相同） */
const CONS_WRAPPER = [
  `() => {`,
  `  const __fkArmMemo = new WeakMap();`,
  `  a = $copy(__fk0_a, __fkArmMemo);`,
  `  let __cont = true;`,
  `  try {`,
  `    return (() => {`,
  `  return $lit(1);`,
  `})();`,
  `  } catch (e) {`,
  `    if ($isForkExit(e)) __cont = false;`,
  `    throw e;`,
  `  } finally {`,
  `    if (__cont) {`,
  `      __fk1_a = a;`,
  `      __fk1_set_a = true;`,
  `    }`,
  `  }`,
  `}`,
].join("\n");

/** 无碰撞时 alt 臂的完整包装（槽位/标志换 alt 族） */
const ALT_WRAPPER = CONS_WRAPPER.replaceAll("__fk1", "__fk2");

describe("forkArmThunkExpr：if 分叉与早退提升共用臂包装", () => {
  it("无绑定名 ⇒ 原样返回 thunk（不引入包装层）", () => {
    expect(forkArmThunkExpr(THUNK, 0, [], "  ", {})).toBe(THUNK);
    expect(forkArmThunkExpr(THUNK, 1, [], "  ", {})).toBe(THUNK);
  });

  it("cons / alt 臂包装逐字确定", () => {
    expect(forkArmThunkExpr(THUNK, 0, ["a"], "  ", {})).toBe(CONS_WRAPPER);
    expect(forkArmThunkExpr(THUNK, 1, ["a"], "  ", {})).toBe(ALT_WRAPPER);
  });

  it("内部临时名走 forkTmpNames：撞用户标识符时改名且成对一致", () => {
    const js = forkArmThunkExpr(THUNK, 0, ["a"], "  ", {
      userIdents: new Set(["__cont", "__fk0_a"]),
    });
    // 快照名与臂标志名避让（`_1` 后缀）；槽位名未撞 ⇒ 基名
    expect(js).toContain("const __fkArmMemo = new WeakMap();");
    expect(js).toContain("a = $copy(__fk0_a_1, __fkArmMemo);");
    expect(js).toContain("let __cont_1 = true;");
    expect(js).toContain("if ($isForkExit(e)) __cont_1 = false;");
    expect(js).toContain("__fk1_a = a;");
    expect(js).toContain("__fk1_set_a = true;");
  });

  it("transpile：if 分叉两臂与早退提升臂使用同一包装骨架（逐字相同行）", () => {
    const ifSrc = `export function f() {
  let a = 0;
  let out = 0;
  if (a === 0) { out = 1; a = 1; } else { out = 2; a = 2; }
  return out;
}`;
    const earlySrc = `export function g(c) {
  let out = 0;
  if (c) return 1;
  out = 2;
  return out;
}`;
    const ifJs = transpileSource(ifSrc, { source: ifSrc });
    const earlyJs = transpileSource(earlySrc, { source: earlySrc });
    // if 分叉：快照恢复（两臂同）+ 槽位写回（cons 臂 / alt 臂各一份）
    expect(ifJs).toContain(`() => {\n      const __fkArmMemo = new WeakMap();\n      out = $copy(__fk0_out, __fkArmMemo);\n      a = $copy(__fk0_a, __fkArmMemo);\n      let __cont = true;`);
    expect(ifJs).toContain(`          __fk1_out = out;\n          __fk1_a = a;\n          __fk1_set_out = true;\n          __fk1_set_a = true;`);
    expect(ifJs).toContain(`          __fk2_out = out;\n          __fk2_a = a;\n          __fk2_set_out = true;\n          __fk2_set_a = true;`);
    // 早退提升：同一包装骨架（cons 臂只含 out）
    expect(earlyJs).toContain(`() => {\n      const __fkArmMemo = new WeakMap();\n      out = $copy(__fk0_out, __fkArmMemo);\n      let __cont = true;`);
    expect(earlyJs).toContain(`          __fk1_out = out;\n          __fk1_set_out = true;`);
    expect(earlyJs).toContain(`          __fk2_out = out;\n          __fk2_set_out = true;`);
  });
});
