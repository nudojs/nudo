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
import type { HarvestedEnv } from "@nudojs/harvester";

/** 签名投影节点（可 JSON 化；足够 mock Abs 的 shape 面） */
export type HarvestSig =
  | { k: "prim"; type: string }
  | { k: "unknown" }
  | { k: "any" }
  | { k: "never" }
  | { k: "lit"; value: number | string | boolean | null }
  | { k: "arr"; element: HarvestSig }
  | { k: "tuple"; elements: HarvestSig[] }
  | { k: "obj"; slots: Record<string, { v: HarvestSig; opt?: boolean }> }
  | { k: "fn"; params: string[]; paramTypes: HarvestSig[]; returns: HarvestSig }
  | { k: "sum"; members: HarvestSig[] }
  | { k: "promise"; value: HarvestSig }
  | { k: "generator"; value: HarvestSig }
  | { k: "brand"; name: string; shape: HarvestSig }
  /** 泛型形参（T）——α 替换用 */
  | { k: "tvar"; name: string };

/**
 * 磁盘 ABI / harvest 物化版本。**改动 Abs 投影或 interface 合并语义时必须 +1**，
 * 否则旧缓存会把提升前的空导出表当命中（lodash 场景）。
 */
export const HARVEST_DISK_ABI = "nudo-harvest-disk-v6";

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

/** Abs → 签名投影（丢 pred/conf；fn 只留参数名+类型面；保留泛型 α） */
export function absToHarvestSig(a: Abs): HarvestSig {
  if (a.term?.op === "var") {
    return { k: "tvar", name: a.term.id };
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
      return { k: "tuple", elements: s.elements.map(absToHarvestSig) };
    case "obj": {
      const slots: Record<string, { v: HarvestSig; opt?: boolean }> = {};
      for (const [key, slot] of Object.entries(s.slots)) {
        slots[key] = {
          v: absToHarvestSig(slot.value),
          ...(slot.optional ? { opt: true } : {}),
        };
      }
      return { k: "obj", slots };
    }
    case "fn": {
      // relation 槽是 α 替换真源（overload 合并可能只改 shape.returnType）
      const rel = getFnImpl(a)?.relation;
      const pts = rel?.paramTypes ?? s.paramTypes ?? s.params.map(() => ({ shape: { k: "unknown" }, conf: "mock" } as Abs));
      const paramTypes = pts.map(absToHarvestSig);
      const retSrc = rel?.returnType ?? s.returnType ?? ({ shape: { k: "unknown" }, conf: "mock" } as Abs);
      return {
        k: "fn",
        params: s.params,
        paramTypes,
        returns: absToHarvestSig(retSrc),
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
    case "prim":
      return mark(
        abs(
          { k: "prim", type: sig.type as "number" | "string" | "boolean" | "bigint" },
          undefined,
          undefined,
          "mock",
        ),
      );
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
          abs({ k: "unknown" }, { op: "lit", value: sig.value as never }, undefined, "mock"),
        );
      }
      return mark(
        abs(
          { k: "prim", type: t as "number" | "string" | "boolean" | "bigint" },
          { op: "lit", value: sig.value as never },
          undefined,
          "mock",
        ),
      );
    }
    case "arr":
      return mark(abs({ k: "arr", element: harvestSigToAbs(sig.element) }, undefined, undefined, "mock"));
    case "tuple":
      return mark(
        abs({ k: "tuple", elements: sig.elements.map(harvestSigToAbs) }, undefined, undefined, "mock"),
      );
    case "obj": {
      const slots: Record<string, { value: Abs; optional?: boolean }> = {};
      for (const [key, slot] of Object.entries(sig.slots)) {
        slots[key] = {
          value: harvestSigToAbs(slot.v),
          ...(slot.opt ? { optional: true } : {}),
        };
      }
      return mark(abs({ k: "obj", slots }, undefined, undefined, "mock"));
    }
    case "tvar":
      return mark(abs({ k: "any" }, { op: "var", id: sig.name }, undefined, "mock"));
    case "fn": {
      const paramTypes = sig.paramTypes.map(harvestSigToAbs);
      const returnType = harvestSigToAbs(sig.returns);
      // relationFn 双写 shape + impl.relation（磁盘回放后仍可 α 替换）
      return mark(
        relationFn(paramTypes, returnType, {
          params: sig.params,
          conf: "mock",
        }),
      );
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
  const modules: Record<string, Record<string, HarvestSig>> = {};
  for (const [mod, rec] of Object.entries(env.modules)) {
    const named: Record<string, HarvestSig> = {};
    for (const [k, v] of Object.entries(rec)) named[k] = absToHarvestSig(v);
    modules[mod] = named;
  }
  const globals: Record<string, HarvestSig> = {};
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
    const modules: Record<string, Record<string, Abs>> = {};
    for (const [mod, rec] of Object.entries(h.modules)) {
      const named: Record<string, Abs> = {};
      for (const [k, sig] of Object.entries(rec)) named[k] = harvestSigToAbs(sig);
      modules[mod] = named;
    }
    const globals: Record<string, Abs> = {};
    for (const [k, sig] of Object.entries(h.globals ?? {})) {
      globals[k] = harvestSigToAbs(sig);
    }
    return {
      globals,
      modules,
      stats: h.stats ?? { files: 0, symbols: 0, skipped: 0 },
    };
  } catch {
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
