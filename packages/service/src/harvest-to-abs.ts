/**
 * Harvest TypeValue 导出 → AbsModuleExports（供 Abs 模块图注入）。
 * fnSig → absFunction + apply 直接返回声明返回类型（conf=mock）。
 */

import type { TypeValue } from "@nudojs/core";
import {
  T,
  type Abs,
  typeValueToAbs,
  confJoin,
  getFnSig,
  absFunction,
} from "@nudojs/core";
import type { AbsModuleExports } from "@nudojs/core";
import { dirname } from "node:path";
import type { PackageHarvest } from "./harvest-package.ts";
import { harvestPackageCached } from "./harvest-auto.ts";

function markMockConf(a: Abs): Abs {
  a.conf = confJoin(a.conf, "mock");
  return a;
}

/** 单个 TypeValue 导出 → Abs（可调用） */
export function harvestedValueToAbs(tv: TypeValue): Abs {
  if (!tv) return markMockConf(typeValueToAbs(T.unknown));
  const sig = getFnSig(tv);
  if (sig) {
    const ret = markMockConf(typeValueToAbs(sig.returnType));
    const params =
      tv.kind === "function" && tv.params?.length
        ? tv.params
        : sig.paramTypes.map((_, i) => `_arg${i}`);
    const dummyBody = {
      type: "BlockStatement",
      body: [],
      directives: [],
    } as never;
    return markMockConf(
      absFunction(params, {
        body: dummyBody,
        apply: () => ret,
      }),
    );
  }
  return markMockConf(typeValueToAbs(tv));
}

/**
 * 把 harvest 的 modules/globals 合成 AbsModuleExports。
 * 键同时登记：原始模块路径、包名、basename（path / @types/path）。
 */
export function harvestToAbsModules(
  pkg: string,
  fromDir: string,
): Record<string, AbsModuleExports> {
  const h = harvestPackageCached(pkg, fromDir);
  if (!h) return {};
  return packageHarvestToAbsModules(pkg, h);
}

export function packageHarvestToAbsModules(
  pkg: string,
  h: PackageHarvest,
): Record<string, AbsModuleExports> {
  const out: Record<string, AbsModuleExports> = {};

  const convertRecord = (
    rec: Record<string, TypeValue>,
  ): Record<string, Abs> => {
    const named: Record<string, Abs> = {};
    for (const [k, v] of Object.entries(rec)) {
      named[k] = harvestedValueToAbs(v);
    }
    return named;
  };

  const register = (key: string, exports: AbsModuleExports) => {
    if (!out[key]) out[key] = exports;
  };

  for (const [mod, rec] of Object.entries(h.env.modules)) {
    const named = convertRecord(rec);
    const exports: AbsModuleExports = { named };
    const def = rec["default"];
    if (def) exports.default = harvestedValueToAbs(def);
    register(mod, exports);
    // 包名 / 去掉 @types/ 前缀 / basename
    register(pkg, exports);
    const stripped = mod.replace(/^@types\//, "").replace(/\\/g, "/");
    if (stripped) register(stripped, exports);
    const base = stripped.split("/").filter(Boolean).pop();
    if (base && base !== pkg) register(base, exports);
  }

  // globals 也挂到包名（default / namespace 消费）
  const globalNamed = convertRecord(h.env.globals);
  if (Object.keys(globalNamed).length > 0) {
    const existing = out[pkg];
    if (existing) {
      out[pkg] = { named: { ...globalNamed, ...existing.named }, default: existing.default };
    } else {
      out[pkg] = { named: globalNamed };
    }
  }

  return out;
}

/** 裸说明符 → Abs 导出表（走 harvest 缓存） */
export function bareSpecToAbsModules(
  spec: string,
  fromFile: string,
): AbsModuleExports | undefined {
  // node: 内建交给 env，不 harvest
  if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) {
    return undefined;
  }
  const parts = spec.split("/");
  const pkg = spec.startsWith("@")
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0];
  if (!pkg) return undefined;
  const table = harvestToAbsModules(pkg, dirname(fromFile));
  return table[spec] ?? table[pkg];
}
