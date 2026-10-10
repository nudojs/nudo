/**
 * 宿主内建面覆盖地板：枚举运行时宿主面 vs 两级台账（builtin-coverage-registry.ts），
 * 未登记名字即失败——防「未建模面静默漏网」。
 *
 * - 正向：globalThis 自有名 + 策展 brand 的 prototype/静态自有名，每个必须
 *   ∈ MODELED ∪ ALLOWED_IMPRECISE；
 * - 反向：台账条目在运行时已不存在 → 失败（防僵尸条目；Node 版本/上下文
 *   漂移条目经 VERSION_SKEW 豁免）；
 * - 自检：两级台账互斥、VERSION_SKEW 不含未登记键。
 *
 * 新名字分诊指引：给引擎补分发/校验 case 后登记 MODELED（理由 cites 派发点）；
 * 有意接受 unknown 则登记 ALLOWED_IMPRECISE 并写明原因。
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMPRECISE,
  CURATED_BRANDS,
  INTL_SUB_CTORS,
  MODELED,
  VERSION_SKEW,
} from "./builtin-coverage-registry.ts";

/** 静态面跳过的函数元属性（所有构造器均匀自有；统一不追踪，见台账头注） */
const FN_META = new Set(["length", "name", "arguments", "caller"]);
/** 原型面跳过的元属性（所有 prototype 均匀自有 constructor） */
const PROTO_META = new Set(["constructor"]);

function ownNames(v: object): string[] {
  return Object.getOwnPropertyNames(v);
}

/** 运行时宿主面全量键（键形见台账头注） */
function enumerateSurface(): Set<string> {
  const keys = new Set<string>();
  const add = (k: string): void => {
    keys.add(k);
  };

  for (const g of ownNames(globalThis)) add(`global:${g}`);

  for (const { name, kind } of CURATED_BRANDS) {
    const v = (globalThis as unknown as Record<string, unknown>)[name];
    expect(v, `策展 brand 在运行时缺失: ${name}`).toBeDefined();

    if (name === "Intl") {
      // Intl 特判：自有名记 ns.*；子构造器面分别枚举
      for (const p of ownNames(v as object)) add(`Intl.ns.${p}`);
      for (const sub of INTL_SUB_CTORS) {
        const sv = (Intl as unknown as Record<string, unknown>)[sub];
        expect(sv, `Intl 子构造器在运行时缺失: ${sub}`).toBeDefined();
        for (const p of ownNames(sv as object)) {
          if (FN_META.has(p)) continue;
          add(`Intl.${sub}.static.${p}`);
        }
        const proto = (sv as { prototype?: object }).prototype;
        if (proto) {
          for (const p of ownNames(proto)) {
            if (PROTO_META.has(p)) continue;
            add(`Intl.${sub}.proto.${p}`);
          }
        }
      }
      continue;
    }

    for (const p of ownNames(v as object)) {
      if (FN_META.has(p)) continue;
      add(`${name}.static.${p}`);
    }
    if (kind !== "ctor") continue;
    const proto = (v as { prototype?: object }).prototype;
    if (!proto) continue; // Proxy：无 prototype
    for (const p of ownNames(proto)) {
      if (PROTO_META.has(p)) continue;
      add(`${name}.proto.${p}`);
    }
  }
  return keys;
}

function registeredKeys(): Set<string> {
  return new Set([...Object.keys(MODELED), ...Object.keys(ALLOWED_IMPRECISE)]);
}

describe("builtin coverage floor（宿主面 vs 两级台账）", () => {
  it("运行时宿主面全部登记（未登记名字 → 建模或登记 ALLOWED 并写理由）", () => {
    const surface = enumerateSurface();
    const registered = registeredKeys();
    const missing = [...surface].filter((k) => !registered.has(k)).sort();
    expect(
      missing,
      `未登记的宿主面（分诊：补引擎 case 后入 MODELED；有意接受 unknown 则入 ` +
        `ALLOWED_IMPRECISE 并写理由。缺失名单：\n${missing.join("\n")}\n`,
    ).toEqual([]);
  });

  it("台账无僵尸条目（已登记但运行时不存在 → 删除条目或挪 VERSION_SKEW）", () => {
    const surface = enumerateSurface();
    const zombies = [...registeredKeys()]
      .filter((k) => !surface.has(k) && !VERSION_SKEW.has(k))
      .sort();
    expect(
      zombies,
      `僵尸台账条目（运行时已无此面；若系 Node 版本/上下文漂移，登记进 ` +
        `VERSION_SKEW 并注明）：\n${zombies.join("\n")}\n`,
    ).toEqual([]);
  });

  it("两级台账互斥且 VERSION_SKEW 只含已登记键", () => {
    const modeled = new Set(Object.keys(MODELED));
    const dup = Object.keys(ALLOWED_IMPRECISE).filter((k) => modeled.has(k)).sort();
    expect(dup, `同时登记在 MODELED 与 ALLOWED_IMPRECISE 的键：\n${dup.join("\n")}`).toEqual([]);
    const orphan = [...VERSION_SKEW].filter((k) => !registeredKeys().has(k)).sort();
    expect(orphan, `VERSION_SKEW 中未登记的键：\n${orphan.join("\n")}`).toEqual([]);
  });
});
