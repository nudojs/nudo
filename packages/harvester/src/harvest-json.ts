/**
 * HarvestJson：L2 harvest 磁盘投影（design-persistent-cache）。
 * 纯 JSON 签名投影——不存 Abs 本体；读回 materialize 为 mock Abs 导出表。
 * fail-open：未知节点 / 损坏 JSON → undefined（miss，不 throw）。
 */

import { createHash } from "node:crypto";
import {
  type Abs,
  abs,
  confJoin,
  relationFn,
  getFnImpl,
} from "@nudojs/core";
import type { HarvestedEnv } from "./harvest-dts.ts";

/**
 * 无原型字典（own-property 纪律）。
 *
 * 普通 `{}` 的原型链上挂着 `toString` / `constructor` / `__proto__` 等成员：
 *   - 裸读 `rec[name]` 会命中原型成员 ⇒ 撞名的导出被当成「不存在」；
 *   - 裸写 `rec["__proto__"] = v` 走 `[[SetPrototypeOf]]` ⇒ 键被吞 /
 *     写穿到原型链（进程级原型污染）。
 * `Object.create(null)` ⇒ 只有自有键可见，`__proto__` 只是普通数据键。
 */
function nullDict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * 签名投影节点（可 JSON 化；足够 mock Abs 的 shape 面）。
 * lit.value 含 undefined：JSON 往返靠「键缺省」区分 null（显式存）与 undefined（键省略）。
 */
export type HarvestSig =
  | { k: "prim"; type: string }
  | { k: "unknown" }
  | { k: "any" }
  | { k: "never" }
  | { k: "lit"; value: number | string | boolean | null | undefined }
  | { k: "arr"; element: HarvestSig }
  | { k: "tuple"; elements: HarvestSig[]; rest?: HarvestSig }
  | {
      k: "obj";
      slots: Record<string, { v: HarvestSig; opt?: boolean }>;
      /** 族 27 Bug 803：索引签名（`Record<K,V>` / `obj[k]: V`）——不投影则
       *  缓存往返会把「开放对象 + 值域」抹成闭合空对象 ⇒ 成员读 undefined ⇒ 定抛。 */
      index?: { key: HarvestSig; value: HarvestSig };
      /** 开放对象（索引签名的承载标志） */
      open?: boolean;
    }
  | {
      k: "fn";
      params: string[];
      paramTypes: HarvestSig[];
      returns: HarvestSig;
      ctor?: boolean;
      slots?: Record<string, HarvestSig>;
      /** 族 27 Bug 821 残留：条件类型的 `infer` 绑定线索。不投影 ⇒ 磁盘缓存
       *  命中后条件元数据丢失 ⇒ 同一份 .d.ts 冷/热缓存给出**不同**类型。 */
      inferFrom?: { fromVar: string; via: "arr" | "promise"; inferVar: string };
      /** 条件类型判不出时的假支（`condFallback`） */
      condFallback?: HarvestSig;
    }
  | { k: "sum"; members: HarvestSig[] }
  | { k: "promise"; value: HarvestSig }
  | { k: "generator"; value: HarvestSig }
  | { k: "brand"; name: string; shape: HarvestSig }
  /** 泛型形参（T）——α 替换用 */
  | { k: "tvar"; name: string };

/**
 * 磁盘 ABI / harvest 物化版本。**改动 Abs 投影或 interface 合并语义时必须 +1**，
 * 否则旧缓存会把提升前的空导出表当命中（lodash 场景）。
 *
 * 族 27（Bug 791–836 等 56 条）改的正是「Abs 投影 + interface 合并 + 导出表物化」语义
 * ⇒ **v8 → v9**。否则用户本地 `~/.cache/nudo/deps/` 里的旧收割产物会继续命中
 * ⇒ CLI **看不到本轮修复**（实测：同一夹具，旧缓存 ⇒ `useDefault(xs: any) => unknown`；
 * `NUDO_DEPS_CACHE_DIR` 指向新目录 ⇒ `number[]`）。
 *
 * **v9 → v10**：族 27 收口时又改了三处投影/合并语义 ——
 * ① `this` 形参不再进收割签名（Bug 794 的收割面）；② `declare class` 进入
 * 接口成员表并带 `ctor` facet（Bug 796 / 826）；③ 顶层 `declare namespace`
 * 的运行时成员收进命名空间自有记录（Bug 793）。任一条都会让旧缓存的
 * 物化结果与新收割器**不一致** ⇒ 必须让旧缓存 miss。
 */
export const HARVEST_DISK_ABI = "nudo-harvest-disk-v10";

export type HarvestJson = {
  v: 1;
  pkg: string;
  pkgVersion?: string;
  /** harvest 旋钮（maxFiles 等）进键 */
  knobs: { maxFiles: number; abi: string };
  /** 全部 dts 内容 sha256（不只入口） */
  dtsHash: string;
  modules: Record<string, Record<string, HarvestSig>>;
  globals: Record<string, HarvestSig>;
  stats: { files: number; symbols: number; skipped: number };
};

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Abs → 签名投影（丢 pred/conf；fn 只留参数名+类型面；保留泛型 α 与 lit term） */
export function absToHarvestSig(a: Abs): HarvestSig {
  if (a.term?.op === "var") {
    return { k: "tvar", name: a.term.id };
  }
  // lit term 优先：保留字面量值（bigint 按 prim 降级，不进 JSON）
  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (v === null || v === undefined) return { k: "lit", value: v };
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      return { k: "lit", value: v };
    }
  }
  const s = a.shape;
  switch (s.k) {
    case "prim":
      return { k: "prim", type: s.type };
    case "unknown":
      return { k: "unknown" };
    case "any":
      return { k: "any" };
    case "never":
      return { k: "never" };
    case "arr":
      return { k: "arr", element: absToHarvestSig(s.element) };
    case "tuple":
      return {
        k: "tuple",
        elements: s.elements.map(absToHarvestSig),
        ...(s.rest ? { rest: absToHarvestSig(s.rest) } : {}),
      };
    case "obj": {
      const slots: Record<string, { v: HarvestSig; opt?: boolean }> = nullDict();
      for (const [key, slot] of Object.entries(s.slots)) {
        slots[key] = {
          v: absToHarvestSig(slot.value),
          ...(slot.optional ? { opt: true } : {}),
        };
      }
      return {
        k: "obj",
        slots,
        ...(s.index ? { index: { key: absToHarvestSig(s.index.key), value: absToHarvestSig(s.index.value) } } : {}),
        ...(s.open ? { open: true } : {}),
      };
    }
    case "fn": {
      // relation 槽是 α 替换真源（overload 合并可能只改 shape.returnType）
      const rel = getFnImpl(a)?.relation;
      const pts = rel?.paramTypes ?? s.paramTypes ?? s.params.map(() => ({ shape: { k: "unknown" }, conf: "mock" } as Abs));
      const paramTypes = pts.map(absToHarvestSig);
      const retSrc = rel?.returnType ?? s.returnType ?? ({ shape: { k: "unknown" }, conf: "mock" } as Abs);
      // 族 27 Bug 829 / 830：ctor facet 与静态槽不投影 ⇒ 缓存往返会把
      // 「构造器」抹成普通 fn（new 落「可构造性未知」⇒ 假红），
      // 把「类型字面量的调用签名带的具名成员」抹掉。
      const fnSlots: Record<string, HarvestSig> = nullDict();
      for (const [key, slot] of Object.entries(s.slots ?? {})) {
        fnSlots[key] = absToHarvestSig(slot.value);
      }
      return {
        k: "fn",
        params: s.params,
        paramTypes,
        returns: absToHarvestSig(retSrc),
        ...(s.ctor !== undefined ? { ctor: s.ctor } : {}),
        ...(Object.keys(fnSlots).length > 0 ? { slots: fnSlots } : {}),
        ...(rel?.inferFrom ? { inferFrom: rel.inferFrom } : {}),
        ...(rel?.condFallback ? { condFallback: absToHarvestSig(rel.condFallback) } : {}),
      };
    }
    case "sum":
      return { k: "sum", members: s.members.map(absToHarvestSig) };
    case "eff":
      return {
        k: s.eff === "generator" ? "generator" : "promise",
        value: absToHarvestSig(s.inner),
      };
    case "brand":
      return { k: "brand", name: s.name, shape: absToHarvestSig(s.shape) };
    default:
      // 未建模 shape：诚实 unknown，不猜
      return { k: "unknown" };
  }
}

/** 签名投影 → mock Abs（conf 合 mock） */
export function harvestSigToAbs(sig: HarvestSig): Abs {
  const mark = (a: Abs): Abs => {
    a.conf = confJoin(a.conf, "mock");
    return a;
  };
  switch (sig.k) {
    case "prim": {
      // 原语类型白名单：bigint / symbol 与内存收割面同口径（Bug 795）。
      // 旧实现用 `as "number" | "string" | "boolean" | "bigint"` 硬转 —— 运行时
      // 侥幸透传 "symbol"，但类型上撒谎，且未知 prim 会被静默当成合法 prim。
      const t = sig.type;
      if (
        t !== "number" && t !== "string" && t !== "boolean" &&
        t !== "bigint" && t !== "symbol"
      ) {
        return mark(abs({ k: "unknown" }, undefined, undefined, "mock"));
      }
      return mark(abs({ k: "prim", type: t }, undefined, undefined, "mock"));
    }
    case "unknown":
      return mark(abs({ k: "unknown" }, undefined, undefined, "mock"));
    case "any":
      return mark(abs({ k: "any" }, undefined, undefined, "mock"));
    case "never":
      return mark(abs({ k: "never" }, undefined, undefined, "mock"));
    case "lit": {
      const t =
        typeof sig.value === "number"
          ? "number"
          : typeof sig.value === "string"
            ? "string"
            : typeof sig.value === "boolean"
              ? "boolean"
              : typeof sig.value === "bigint"
                ? "bigint"
                : null;
      if (sig.value === null || t === null) {
        return mark(
          abs({ k: "unknown" }, { op: "lit", value: sig.value }, undefined, "mock"),
        );
      }
      return mark(
        abs(
          { k: "prim", type: t as "number" | "string" | "boolean" | "bigint" },
          { op: "lit", value: sig.value },
          undefined,
          "mock",
        ),
      );
    }
    case "arr":
      return mark(abs({ k: "arr", element: harvestSigToAbs(sig.element) }, undefined, undefined, "mock"));
    case "tuple":
      return mark(
        abs(
          {
            k: "tuple",
            elements: sig.elements.map(harvestSigToAbs),
            ...(sig.rest ? { rest: harvestSigToAbs(sig.rest) } : {}),
          },
          undefined,
          undefined,
          "mock",
        ),
      );
    case "obj": {
      const slots: Record<string, { value: Abs; optional?: boolean }> = nullDict();
      for (const [key, slot] of Object.entries(sig.slots)) {
        slots[key] = {
          value: harvestSigToAbs(slot.v),
          ...(slot.opt ? { optional: true } : {}),
        };
      }
      // 族 27 Bug 803：索引签名 + 开放对象标志必须还原 ⇒ 否则缓存往返把
      // 「开放对象 + 值域」抹成闭合空对象 ⇒ 成员读 undefined ⇒ 定抛 TypeError。
      return mark(
        abs(
          {
            k: "obj",
            slots,
            ...(sig.index
              ? { index: { key: harvestSigToAbs(sig.index.key), value: harvestSigToAbs(sig.index.value) } }
              : {}),
            ...(sig.open ? { open: true } : {}),
          },
          undefined,
          undefined,
          "mock",
        ),
      );
    }
    case "tvar":
      return mark(abs({ k: "any" }, { op: "var", id: sig.name }, undefined, "mock"));
    case "fn": {
      const paramTypes = sig.paramTypes.map(harvestSigToAbs);
      const returnType = harvestSigToAbs(sig.returns);
      // relationFn 双写 shape + impl.relation（磁盘回放后仍可 α 替换）
      const fn = relationFn(paramTypes, returnType, {
        params: sig.params,
        conf: "mock",
        // 族 27 Bug 821 残留：条件元数据必须一起往返，否则缓存命中后
        // `infer` 绑定与假支丢失 ⇒ 冷/热缓存结论不一致。
        ...(sig.inferFrom ? { inferFrom: sig.inferFrom } : {}),
        ...(sig.condFallback ? { condFallback: harvestSigToAbs(sig.condFallback) } : {}),
      });
      // 族 27 Bug 829 / 830：ctor facet 与静态槽必须还原 ⇒ 否则缓存往返把
      // 「构造器」抹成普通 fn（`new` 落「可构造性未知」⇒ 假红），
      // 把「类型字面量的调用签名带的具名成员」抹掉。
      const fnShape = fn.shape;
      if (fnShape.k === "fn") {
        const fnSlots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = nullDict();
        for (const [key, v] of Object.entries(sig.slots ?? {})) {
          fnSlots[key] = { value: harvestSigToAbs(v) };
        }
        fn.shape = {
          ...fnShape,
          ...(sig.ctor !== undefined ? { ctor: sig.ctor } : {}),
          ...(Object.keys(fnSlots).length > 0 ? { slots: fnSlots } : {}),
        };
      }
      return mark(fn);
    }
    case "sum":
      return mark(
        abs({ k: "sum", members: sig.members.map(harvestSigToAbs) }, undefined, undefined, "mock"),
      );
    case "promise":
    case "generator":
      return mark(
        abs(
          {
            k: "eff",
            eff: sig.k === "generator" ? "generator" : "promise",
            inner: harvestSigToAbs(sig.value),
          },
          undefined,
          undefined,
          "mock",
        ),
      );
    case "brand":
      return mark(
        abs(
          { k: "brand", name: sig.name, shape: harvestSigToAbs(sig.shape) },
          undefined,
          undefined,
          "mock",
        ),
      );
    default:
      return mark(abs({ k: "unknown" }, undefined, undefined, "mock"));
  }
}

export function serializeHarvestJson(
  pkg: string,
  env: HarvestedEnv,
  meta: { dtsHash: string; maxFiles: number; pkgVersion?: string },
): HarvestJson {
  // 无原型表：模块名 / 导出名撞 Object.prototype 成员（`__proto__` /
  // `constructor` / `toString` …）时既不会被吞，也不会写穿原型链
  // （Bug 828 / Bug 836）。
  const modules: Record<string, Record<string, HarvestSig>> = nullDict();
  for (const [mod, rec] of Object.entries(env.modules)) {
    const named: Record<string, HarvestSig> = nullDict();
    for (const [k, v] of Object.entries(rec)) named[k] = absToHarvestSig(v);
    modules[mod] = named;
  }
  const globals: Record<string, HarvestSig> = nullDict();
  for (const [k, v] of Object.entries(env.globals)) globals[k] = absToHarvestSig(v);
  return {
    v: 1,
    pkg,
    ...(meta.pkgVersion ? { pkgVersion: meta.pkgVersion } : {}),
    knobs: { maxFiles: meta.maxFiles, abi: HARVEST_DISK_ABI },
    dtsHash: meta.dtsHash,
    modules,
    globals,
    stats: env.stats,
  };
}

/** HarvestJson → mock Abs 导出表（materialize）；损坏/版本不符 → null */
export function materializeHarvestJson(j: unknown): HarvestedEnv | null {
  if (!j || typeof j !== "object") return null;
  const h = j as HarvestJson;
  if (h.v !== 1) return null;
  // 旧 ABI（无 abi 字段或版本不符）→ 当 miss，避免空导出表命中
  if (h.knobs?.abi !== HARVEST_DISK_ABI) return null;
  if (!h.modules || typeof h.modules !== "object") return null;
  try {
    const modules: Record<string, Record<string, Abs>> = nullDict();
    for (const [mod, rec] of Object.entries(h.modules)) {
      const named: Record<string, Abs> = nullDict();
      for (const [k, sig] of Object.entries(rec)) named[k] = harvestSigToAbs(sig);
      modules[mod] = named;
    }
    const globals: Record<string, Abs> = nullDict();
    for (const [k, sig] of Object.entries(h.globals ?? {})) {
      globals[k] = harvestSigToAbs(sig);
    }
    return {
      globals,
      modules,
      stats: h.stats ?? { files: 0, symbols: 0, skipped: 0 },
    };
  } catch {
    /* optional: malformed harvest JSON — treat as missing */
    return null;
  }
}

/** L2 键：pkg + version + knobs + dtsClosureHash（相对化；content-addressable） */
export function harvestCacheKey(
  pkg: string,
  meta: { dtsHash: string; maxFiles: number; pkgVersion?: string },
): string {
  const raw = [
    HARVEST_DISK_ABI,
    pkg,
    meta.pkgVersion ?? "-",
    String(meta.maxFiles),
    meta.dtsHash,
  ].join("\0");
  return sha256Hex(raw);
}
