import { describe, expect, it } from "vitest";

import { NAMESPACE_GLOBALS, namespaceNameOf } from "../runtime/containers.ts";
import { getEnvShadowSkipGlobals } from "../run.ts";
import { HOST_INTRINSIC_NAMES } from "../transpile/intrinsics.ts";

/**
 * env-skip 派生关系的结构钉子（纯结构断言，不跑引擎）：
 *
 * run.ts 的 env-skip 名单（getEnvShadowSkipGlobals）**派生**自
 * HOST_INTRINSIC_NAMES（转译已折叠，跳过无副作用）∪ NAMESPACE_GLOBALS 名字
 * （namespaceNameOf 的宿主对象身份路由表）——不再有第三份手写名单。
 *
 * 断言两端而不是重抄派生表达式：skip 集合必须包含每个路由名（防有人把派生
 * 改成手写子集 ⇒ 路由被 env 遮蔽，issue #87），且不得含路由表/内建名之外的
 * 名字（防手写的额外 skip 丢弃用户 env 声明 ⇒ 代码退化 unknown）。同时钉住
 * 路由表自身的完整性（名字/宿主对象无重复、namespaceNameOf 配对无误）。
 */

const nsNames = NAMESPACE_GLOBALS.map(([name]) => name);
const envShadowSkipGlobals = getEnvShadowSkipGlobals();

describe("env-skip 派生自 HOST_INTRINSIC_NAMES ∪ NAMESPACE_GLOBALS", () => {
  it("路由表自身无重复名字/重复宿主对象", () => {
    expect(
      nsNames.filter((n, i) => nsNames.indexOf(n) !== i),
      `NAMESPACE_GLOBALS 名字重复: ${nsNames.filter((n, i) => nsNames.indexOf(n) !== i)}`,
    ).toEqual([]);
    const hosts = NAMESPACE_GLOBALS.map(([, host]) => host);
    expect(
      hosts.filter((h, i) => hosts.indexOf(h) !== i),
      "NAMESPACE_GLOBALS 宿主对象重复（后条永不命中）",
    ).toEqual([]);
  });

  it("每个路由名都被 env-skip（防注入遮蔽身份路由，issue #87）", () => {
    const missing = nsNames.filter((n) => !envShadowSkipGlobals.has(n));
    expect(
      missing,
      `namespaceNameOf 路由但 envShadowSkipGlobals 未跳过: ${missing.join(", ")} —— env 注入 const ${missing[0] ?? "<name>"} = … 会把接收者从宿主对象替换成 Abs，路由失效`,
    ).toEqual([]);
  });

  it("每个宿主内建名都被 env-skip（转译折叠语义不注入）", () => {
    const missing = HOST_INTRINSIC_NAMES.filter(
      (n) => !envShadowSkipGlobals.has(n),
    );
    expect(missing, `envShadowSkipGlobals 缺内建名: ${missing.join(", ")}`).toEqual([]);
  });

  it("没有路由表/内建名之外的额外 skip（防用户 env 声明被丢弃）", () => {
    const extra = [...envShadowSkipGlobals].filter(
      (n) =>
        !nsNames.includes(n) &&
        !(HOST_INTRINSIC_NAMES as readonly string[]).includes(n),
    );
    expect(
      extra,
      `envShadowSkipGlobals 含无路由收益的名字: ${extra.join(", ")} —— 该名字的 env 注入被丢弃，代码退化 unknown；需进 NAMESPACE_GLOBALS 或移出 skip`,
    ).toEqual([]);
  });

  it("skip 集合 = HOST_INTRINSIC_NAMES ∪ 路由表名字（派生整体一致）", () => {
    const expected = [...new Set([...HOST_INTRINSIC_NAMES, ...nsNames])].sort();
    expect(
      [...envShadowSkipGlobals].sort(),
      `skip 名单漂移：期望 [${expected.join(", ")}]，实际 [${[...envShadowSkipGlobals].sort().join(", ")}]`,
    ).toEqual(expected);
  });

  it("namespaceNameOf 按表逐条命中（名字↔宿主对象配对无误）", () => {
    for (const [name, host] of NAMESPACE_GLOBALS) {
      expect(
        namespaceNameOf(host),
        `NAMESPACE_GLOBALS 配对错误：宿主对象 ${String(name)} 路由到了别的名字`,
      ).toBe(name);
    }
    // 非表内宿主对象（刻意未路由，见 member.ts 注释）不误命中
    //（RegExp 自 Bug 56、ArrayBuffer 自 Bug 40 起入路由表——负控制换 Atomics）
    expect(namespaceNameOf(Atomics)).toBeUndefined();
    expect(namespaceNameOf(console)).toBeUndefined();
    expect(namespaceNameOf({})).toBeUndefined();
    expect(namespaceNameOf(42)).toBeUndefined();
  });
});
