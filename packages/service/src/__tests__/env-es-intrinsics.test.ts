/**
 * 真实 `@nudojs/env/es` 全局表注入不得遮蔽宿主内建，也不得拖垮不碰 env API 的函数。
 *
 * 回归背景：es env 恒声明 `undefined: undef()` / `NaN: prim.num()` /
 * `Infinity: prim.num()`（web/node 隐含 es）。注入成模块级 const 后，转译产物
 * 的 `$fork(test, cons, undefined)` 省略哨兵变成 Abs，循环内提前 return 折
 * unknown；`0 === NaN` 退化成 boolean。
 *
 * 本文件走 collectEnvGlobals → checkSource inject 整条链（不是手工 Abs 表）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { checkSource, pTrue, formatAbs, resetGeneralizeMemo } from "@nudojs/core";
import { collectEnvGlobals } from "../eval-run.ts";

const SRC = `export function loopEarlyReturn(list) {
  for (const s of list) {
    if (s === "high") return "l1";
  }
  return "l0";
}
export function implicitUndefined(n) {
  if (n > 1) return "a";
}
export function nanCompare() {
  return 0 === NaN;
}
export function usesMath(x) {
  return Math.abs(x);
}
`;

function faces(envNames: string[]) {
  const envGlobals = collectEnvGlobals(envNames);
  const report = checkSource("/t/env-es-intrinsics.js", SRC, pTrue, {
    inject: Object.keys(envGlobals).length ? { envGlobals } : undefined,
  });
  return new Map(report.signatures.map((s) => [s.name, formatAbs(s.abs)]));
}

beforeAll(() => {
  resetGeneralizeMemo();
});

describe("real es env globals must not degrade host intrinsics", () => {
  it("es env inject: loop early-return / implicit undef / NaN compare stay precise", () => {
    expect(Object.keys(collectEnvGlobals(["es"])).length).toBeGreaterThan(0);
    const withEs = faces(["es"]);
    expect(withEs.get("loopEarlyReturn")).toContain('"l0"');
    expect(withEs.get("loopEarlyReturn")).toContain('"l1"');
    expect(withEs.get("loopEarlyReturn")).not.toContain("unknown");
    expect(withEs.get("implicitUndefined")).toContain("undefined");
    expect(withEs.get("implicitUndefined")).not.toContain("unknown");
    expect(withEs.get("nanCompare")).toContain("false");
    // 正对照：普通 env 全局仍然生效（Math.abs(x) 不因 skip 而失效）
    expect(withEs.get("usesMath")).not.toContain("unknown");
  });

  it("es env inject matches the no-env baseline for non-env shapes", () => {
    const base = faces([]);
    const withEs = faces(["es"]);
    for (const name of ["loopEarlyReturn", "implicitUndefined", "nanCompare"]) {
      expect(withEs.get(name), name).toEqual(base.get(name));
    }
  });
});
