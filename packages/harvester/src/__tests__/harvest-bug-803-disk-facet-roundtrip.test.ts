import { describe, it, expect } from "vitest";
import { abs, formatShape } from "@nudojs/core";
import {
  absToHarvestSig,
  harvestSigToAbs,
  materializeHarvestJson,
  serializeHarvestJson,
  HARVEST_DISK_ABI,
} from "../harvest-json.ts";
import type { Abs } from "@nudojs/core";

/**
 * 族 27 · Bug 803（主 agent 接线）—— **磁盘投影的 facet 往返**。
 *
 * 收割面（内存 Abs）在本族新增了几个 facet：
 * - obj：`index`（索引签名 / `Record<K,V>` 的值域）+ `open`（开放对象标志）
 * - tuple：`rest`（变长尾槽）
 * - fn：`ctor`（可构造性）+ `slots`（dual-facet 静态成员）
 *
 * 磁盘投影 `HarvestSig` 原本**不带**这些 facet ⇒ L2 磁盘缓存命中时服务的是
 * **有损 env** ⇒ 803（`Record` 变闭合空对象 ⇒ 成员读 undefined ⇒ 定抛）、
 * 802（元组丢 rest）、829（构造器被抹成普通 fn ⇒ `new` 落「可构造性未知」⇒ 假红）
 * 的修复在缓存往返后**被抹掉**。
 *
 * 判据：**序列化 → 反序列化**后，facet 必须**逐项相同**（不是「形状像」）。
 */

function roundTrip(a: Abs): Abs {
  const env = { globals: { x: a }, modules: {}, stats: { files: 1, symbols: 1, skipped: 0 } };
  const json = serializeHarvestJson("pkg", env, { dtsHash: "h", maxFiles: 12 });
  const back = materializeHarvestJson(json);
  expect(back, "materialize must not miss").toBeTruthy();
  return back!.globals["x"]!;
}

describe("族 27 · 磁盘投影 facet 往返（Bug 803 接线）", () => {
  it("obj：索引签名 + 开放对象标志往返后仍在", () => {
    const indexed = abs(
      {
        k: "obj",
        slots: {},
        index: {
          key: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
          value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact"),
        },
        open: true,
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(indexed);
    expect(back.shape.k).toBe("obj");
    const sh = back.shape as Extract<Abs["shape"], { k: "obj" }>;
    expect(sh.open, "open flag must survive the disk round-trip").toBe(true);
    expect(sh.index, "index signature must survive the disk round-trip").toBeTruthy();
    expect(sh.index!.value.shape).toEqual({ k: "prim", type: "number" });
  });

  it("obj：闭合对象**不**被投影成开放对象（不得过度放宽）", () => {
    const closed = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    const back = roundTrip(closed);
    const sh = back.shape as Extract<Abs["shape"], { k: "obj" }>;
    expect(sh.open).toBeUndefined();
    expect(sh.index).toBeUndefined();
  });

  it("tuple：rest 槽往返后仍在", () => {
    const tup = abs(
      {
        k: "tuple",
        elements: [abs({ k: "prim", type: "number" }, undefined, undefined, "exact")],
        rest: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(tup);
    const sh = back.shape as Extract<Abs["shape"], { k: "tuple" }>;
    expect(sh.rest, "tuple rest must survive the disk round-trip").toBeTruthy();
    expect(sh.rest!.shape).toEqual({ k: "prim", type: "string" });
  });

  it("fn：ctor facet 往返后仍在（否则 new 落「可构造性未知」⇒ 假红）", () => {
    const ctor = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [abs({ k: "prim", type: "number" }, undefined, undefined, "exact")],
        returnType: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
        ctor: true,
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(ctor);
    const sh = back.shape as Extract<Abs["shape"], { k: "fn" }>;
    expect(sh.ctor, "ctor facet must survive the disk round-trip").toBe(true);
  });

  it("fn：dual-facet 静态槽往返后仍在", () => {
    const withStatic = abs(
      {
        k: "fn",
        params: [],
        paramTypes: [],
        returnType: abs({ k: "prim", type: "number" }, undefined, undefined, "exact"),
        slots: { of: { value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") } },
      },
      undefined,
      undefined,
      "exact",
    );
    const back = roundTrip(withStatic);
    const sh = back.shape as Extract<Abs["shape"], { k: "fn" }>;
    expect(sh.slots?.["of"], "fn static slot must survive the disk round-trip").toBeTruthy();
    expect(sh.slots!["of"]!.value.shape).toEqual({ k: "prim", type: "number" });
  });

  it("ABI 已抬到 v13（收割语义变了 ⇒ 旧磁盘缓存必须 miss）", () => {
    expect(HARVEST_DISK_ABI).toBe("nudo-harvest-disk-v13");
    // 旧 ABI 的载荷必须被判 miss（否则用户本地 ~/.cache/nudo/deps/ 里的
    // 旧收割产物会继续命中 ⇒ CLI 看不到本轮修复）
    const stale = {
      v: 1,
      pkg: "pkg",
      knobs: { maxFiles: 12, abi: "nudo-harvest-disk-v10" },
      dtsHash: "h",
      modules: {},
      globals: {},
      stats: { files: 0, symbols: 0, skipped: 0 },
    };
    expect(materializeHarvestJson(stale)).toBeNull();
  });

  it("反向闸：投影里带 facet 的 HarvestSig 能还原出同样的显示面", () => {
    const indexed = abs(
      {
        k: "obj",
        slots: {},
        index: {
          key: abs({ k: "prim", type: "string" }, undefined, undefined, "exact"),
          value: abs({ k: "prim", type: "number" }, undefined, undefined, "exact"),
        },
        open: true,
      },
      undefined,
      undefined,
      "exact",
    );
    const sig = absToHarvestSig(indexed);
    expect(sig.k).toBe("obj");
    if (sig.k !== "obj") throw new Error("unreachable");
    expect(sig.open).toBe(true);
    expect(sig.index).toBeTruthy();
    const restored = harvestSigToAbs(sig);
    expect(formatShape(restored)).toBe(formatShape(indexed));
  });
});
