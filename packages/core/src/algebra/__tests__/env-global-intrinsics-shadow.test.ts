/**
 * @nudo:env 全局注入不得遮蔽宿主内建标识符 undefined / NaN / Infinity。
 *
 * 回归背景：`runTranspiled` 把每个 env 全局转成模块级
 * `const <name> = __nudoEnv["<name>"]`，一旦 env 声明了 `undefined`
 * （`@nudojs/env/es` 恒声明 `undefined: undef()`，web/node 又隐含 es），产物里的
 * **裸 `undefined` 文本**（隐式返回、缺 else 臂）与 `$lit(undefined)` 都拿到 Abs
 * 对象 → 循环内提前 return 的分支 join 整条折 unknown；`NaN` 绑成 `prim.num()`
 * 时字面量比较 `0 === NaN` 从原生恒 false 退化成 boolean（精度退化 + 语义错误）。
 * 实测消费方（npm-safe，开 es/node/web env）由 39/39 断言通过退化为 23/10，其中
 * scanner 的 auditLevel（for-of + 提前 return）即此形。
 *
 * 修法是注入时跳过这三个名字（转译器已把它们硬编码为 `$lit(...)`，const 注入无
 * 收益，只遮蔽宿主）。本文件的核心断言是**差分**：同一份源码注入 env 内建前后
 * 签名必须逐字相同。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, formatAbs, undefAbs, abs as makeAbs, lit, type Abs } from "@nudojs/core";

/** es env 里 `NaN` / `Infinity` 的声明形态：抽象 number（非字面量） */
const numAbs: Abs = makeAbs({ k: "prim", type: "number" }, undefined, undefined, "path");
/** 与 @nudojs/env/es 的 `undefined: undef()` 同形 */
const envIntrinsics: Record<string, Abs> = {
  undefined: undefAbs(),
  NaN: numAbs,
  Infinity: numAbs,
};

function faces(source: string, envGlobals?: Record<string, Abs>) {
  const report = checkSource("/t/env-intrinsics.js", source, pTrue, {
    inject: envGlobals ? { envGlobals } : undefined,
  });
  return new Map(report.signatures.map((s) => [s.name, formatAbs(s.abs)]));
}

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
`;

describe("@nudo:env 全局注入不遮蔽宿主内建", () => {
  it("注入 undefined/NaN/Infinity 前后签名逐字相同", () => {
    const base = faces(SRC);
    const injected = faces(SRC, envIntrinsics);
    expect([...injected.entries()]).toEqual([...base.entries()]);
  });

  it("基线本身是精确的（守住被测形状确实在考精度）", () => {
    const base = faces(SRC);
    expect(base.get("loopEarlyReturn")).toContain('"l0"');
    expect(base.get("loopEarlyReturn")).toContain('"l1"');
    expect(base.get("loopEarlyReturn")).not.toContain("unknown");
    expect(base.get("implicitUndefined")).toContain("undefined");
    expect(base.get("nanCompare")).toContain("false");
  });

  it("跳过集合不过宽：普通 env 全局照常注入生效", () => {
    const sep: Abs = makeAbs({ k: "prim", type: "string" }, lit(":"), pTrue, "exact");
    const f = faces(`export function sep() { return SEP; }\n`, { SEP: sep });
    expect(f.get("sep")).toContain('":"');
  });
});
