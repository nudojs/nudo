import { describe, expect, it } from "vitest";

import { NAMESPACE_GLOBALS, namespaceNameOf } from "../runtime/containers.ts";
import {
  ENV_SHADOW_SKIP_GLOBALS,
  HOST_INTRINSIC_NAMES,
  HOST_INTRINSIC_SET,
} from "../transpile/intrinsics.ts";

/**
 * 两份手工同步名单的 parity 钉子（纯结构断言，不跑引擎）：
 *
 * - ENV_SHADOW_SKIP_GLOBALS（run.ts 的 env 注入遮蔽跳过名单）
 * - NAMESPACE_GLOBALS（namespaceNameOf 的宿主对象身份路由表）
 *
 * skip 名单 = HOST_INTRINSIC_NAMES（转译已折叠，跳过无副作用）∪ 路由表名字。
 * 任一方向单边加名字都是静默漂移：路由名不 skip → env 注入遮蔽身份路由
 * （issue #87）；skip 名无路由 → 用户 env 注入被丢弃、代码退化 unknown。
 */

const nsNames = NAMESPACE_GLOBALS.map(([name]) => name);
const skipNonIntrinsic = [...ENV_SHADOW_SKIP_GLOBALS].filter(
  (n) => !HOST_INTRINSIC_SET.has(n),
);

describe("env-shadow ↔ namespaceNameOf 名单 parity", () => {
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
    const missing = nsNames.filter((n) => !ENV_SHADOW_SKIP_GLOBALS.has(n));
    expect(
      missing,
      `namespaceNameOf 路由但 ENV_SHADOW_SKIP_GLOBALS 未跳过: ${missing.join(", ")} —— env 注入 const ${missing[0] ?? "<name>"} = … 会把接收者从宿主对象替换成 Abs，路由失效`,
    ).toEqual([]);
  });

  it("env-skip 的非内建名都有路由收益（防 skip 无路由致用户代码退化）", () => {
    const extra = skipNonIntrinsic.filter((n) => !nsNames.includes(n));
    expect(
      extra,
      `ENV_SHADOW_SKIP_GLOBALS 跳过但 namespaceNameOf 未路由: ${extra.join(", ")} —— 跳过的用户 env 注入无收益，需进 NAMESPACE_GLOBALS 或移出 skip 名单`,
    ).toEqual([]);
  });

  it("skip 名单 = HOST_INTRINSIC_NAMES ∪ 路由表名字（整体不漂移）", () => {
    const expected = [...new Set([...HOST_INTRINSIC_NAMES, ...nsNames])].sort();
    expect(
      [...ENV_SHADOW_SKIP_GLOBALS].sort(),
      `skip 名单整体漂移：期望 [${expected.join(", ")}]，实际 [${[...ENV_SHADOW_SKIP_GLOBALS].sort().join(", ")}]`,
    ).toEqual(expected);
  });

  it("namespaceNameOf 按表逐条命中（名字↔宿主对象配对无误）", () => {
    for (const [name, host] of NAMESPACE_GLOBALS) {
      expect(
        namespaceNameOf(host),
        `NAMESPACE_GLOBALS 配对错误：宿主对象 ${String(name)} 路由到了别的名字`,
      ).toBe(name);
    }
    // 非表内宿主对象（刻意未路由，见 intrinsics.ts 注释）不误命中
    //（RegExp 自 Bug 56、ArrayBuffer 自 Bug 40 起入路由表——负控制换 Atomics）
    expect(namespaceNameOf(Atomics)).toBeUndefined();
    expect(namespaceNameOf(console)).toBeUndefined();
    expect(namespaceNameOf({})).toBeUndefined();
    expect(namespaceNameOf(42)).toBeUndefined();
  });
});
