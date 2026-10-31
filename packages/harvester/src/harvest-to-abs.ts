/**
 * Harvest Abs 导出 → AbsModuleExports（供 Abs 模块图注入）。
 * harvest 产物已是 Abs；fn 槽 apply 直接返回声明返回类型（conf=mock）。
 */

import {
  type Abs,
  confJoin,
  absFunction,
  getFnImpl,
  instantiateReturn,
} from "@nudojs/core";
import type { AbsModuleExports } from "@nudojs/core";
import { dirname } from "node:path";
import { harvestDts, promotedNamesOf } from "./harvest-dts.ts";
import {
  dtsFileScan,
  packageAmbientNames,
  packagePrivateNames,
  packageExportSurface,
  resolveSubpathEntry,
  type PackageHarvest,
} from "./harvest-package.ts";
import { harvestPackageCached } from "./harvest-auto.ts";
import { BoundedLruMap } from "@nudojs/core/internal";

function markMockConf(a: Abs): Abs {
  a.conf = confJoin(a.conf, "mock");
  return a;
}

/** 单个 Abs 导出 → 可调用 mock（fn 槽按 relation α 替换，或返回声明返回类型） */
export function harvestedValueToAbs(a: Abs): Abs {
  if (a.shape.k === "fn") {
    const ret = a.shape.returnType ?? ({ shape: { k: "unknown" }, conf: "mock" } as Abs);
    const relation = getFnImpl(a)?.relation;
    const params =
      a.shape.params.length > 0
        ? a.shape.params
        : (a.shape.paramTypes?.map((_, i) => `_arg${i}`) ?? ["...args"]);
    const dummyBody = {
      type: "BlockStatement",
      body: [],
      directives: [],
    } as never;
    // Bug 826：可构造性 facet 必须**透传** —— 收割出的 `declare class` 类值带
    // `ctor: true`（core 的 `new` 路径据此认它是构造函数）。mock 化时丢掉它
    // ⇒ `new X()` 落「可构造性未知」⇒ 记 may TypeError（L2 假红）。
    const ctor = (a.shape as { ctor?: boolean }).ctor;
    return markMockConf(
      absFunction(
        params,
        {
          body: dummyBody,
          apply: (args) => {
            // 泛型：uniq(number[]) → number[]；无 relation 时退回声明返回
            if (relation) {
              return markMockConf(instantiateReturn(a, args));
            }
            return markMockConf({ ...ret });
          },
          ...(relation ? { relation } : {}),
        },
        ctor !== undefined ? { ctor } : undefined,
      ),
    );
  }
  return markMockConf({ ...a });
}

/**
 * 把 harvest 的 modules/globals 合成 AbsModuleExports。
 *
 * 键的归属（Bug 835 / 1014）：
 * - `declare module "x" { … }` 记录 → 只登记到**它自己的**键（`x` / 去 `@types/` 前缀 /
 *   basename）；**不占包名键** —— 否则 `import { x } from "pkg"` 会拿到另一个模块的同名导出。
 * - **包名键** → 该包**自己**的顶层导出（入口 `.d.ts` 的导出面）。
 *   `declare global { … }` 与 script 模式 `.d.ts` 的顶层声明是 **ambient**，
 *   TypeScript 侧不可 import（TS2305 / TS2306）⇒ **不得**进包名键。
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
    rec: Record<string, Abs>,
    /** 不算导出的名字（提升出来的接口成员：不是模块导出，Bug 123） */
    skip?: ReadonlySet<string>,
  ): Record<string, Abs> => {
    const named: Record<string, Abs> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (skip?.has(k)) continue;
      named[k] = harvestedValueToAbs(v);
    }
    return named;
  };

  const register = (key: string, exports: AbsModuleExports) => {
    // 自有属性判定：裸读会踩 Object.prototype 的同名键（toString/constructor …）
    if (!Object.hasOwn(out, key)) out[key] = exports;
  };

  // ① 模块记录（`declare module "x" { … }`）：只登记到**它自己的**键
  for (const [mod, rec] of Object.entries(h.env.modules)) {
    // `declare module "x" { … }` 块里的**接口成员**（提升出来的）不是模块导出
    // （TS：接口成员只在类型内部可见 ⇒ `import { x }` 是 TS2305）⇒ 不登记（Bug 123）
    const named = convertRecord(rec, promotedNamesOf(rec));
    const exports: AbsModuleExports = { named };
    const def = rec["default"];
    if (def) exports.default = harvestedValueToAbs(def);
    register(mod, exports);
    // 去掉 @types/ 前缀 / basename（path / @types/path）
    const stripped = mod.replace(/^@types\//, "").replace(/\\/g, "/");
    if (stripped && stripped !== pkg) register(stripped, exports);
    const base = stripped.split("/").filter(Boolean).pop();
    if (base && base !== pkg) register(base, exports);
  }

  // ② 包名键 = 该包自己的顶层导出（ambient 不进来）
  out[pkg] = packageRootExports(pkg, h);

  return out;
}

/**
 * 包名键的导出表 = 该包**自己**的顶层导出（入口 `.d.ts` 的导出面）。
 *
 * - 公开面可知 ⇒ 只取入口 `.d.ts`（含 `export * from "./x"` 目标）导出的名字；
 * - 公开面不可知（`export * from "<外部包>"`）⇒ 退回 globals 袋，但**扣掉 ambient**
 *   （`declare global { … }` / script 模式 `.d.ts` 的顶层声明）。
 */
function packageRootExports(pkg: string, h: PackageHarvest): AbsModuleExports {
  const globals = h.env.globals;
  const surface = packageExportSurface(h);
  const named: Record<string, Abs> = {};
  if (surface.unresolved) {
    // 公开面不可知（`export * from "<外部包>"`）⇒ 退回 globals 袋，但**扣掉**
    //   - ambient（`declare global { … }` / script 模式顶层声明）
    //   - 模块私有顶层声明（module 模式里从未 `export` ⇒ TS2459，Bug 265）
    //   - 提升出来的接口成员（不是导出，Bug 123）
    const ambient = packageAmbientNames(h);
    const priv = packagePrivateNames(h);
    const promoted = promotedNamesOf(globals);
    for (const [k, v] of Object.entries(globals)) {
      if (ambient.has(k)) continue;
      // 「模块私有」只对**未导出**的名字成立：`declare function f(); export { f };`
      // 的 f 既在 private 袋里也在导出面里 ⇒ 以导出面为准。
      if (priv.has(k) && !surface.names.has(k)) continue;
      if (promoted.has(k)) continue;
      named[k] = harvestedValueToAbs(v);
    }
  } else {
    for (const n of surface.names) {
      if (!Object.hasOwn(globals, n)) continue;
      named[n] = harvestedValueToAbs(globals[n]);
    }
  }
  const exports: AbsModuleExports = { named };
  // default 槽：只有公开面里确实有 default 才提升（globals 袋里的 "default" 可能来自别的文件）
  if (surface.unresolved || surface.names.has("default")) {
    const def = Object.hasOwn(globals, "default") ? globals["default"] : undefined;
    if (def) exports.default = harvestedValueToAbs(def);
  }
  // 模块增强：本包自己的 `.d.ts` 里的 `declare module "<pkg>" { … }`
  const aug = Object.hasOwn(h.env.modules, pkg) ? h.env.modules[pkg] : undefined;
  if (aug) {
    const promoted = promotedNamesOf(aug);
    for (const [k, v] of Object.entries(aug)) {
      if (promoted.has(k)) continue;
      if (Object.hasOwn(named, k)) continue;
      named[k] = harvestedValueToAbs(v);
    }
  }
  return exports;
}

/** 子路径导出表缓存（按入口 `.d.ts` 路径） */
const subpathCache = new BoundedLruMap<AbsModuleExports>(32);

/**
 * 子路径说明符（"pkg/sub"）→ 该子路径入口 `.d.ts` **自己**的导出表。
 *
 * 单文件收割：子路径的导出只来自它自己的入口文件
 * （根包的 globals 袋是**扁平**的，同名声明归“先到先得”，不能拿来当子路径的导出）。
 */
function subpathExports(
  pkg: string,
  spec: string,
  h: PackageHarvest,
): AbsModuleExports | undefined {
  const sub = spec.slice(pkg.length + 1);
  const file = resolveSubpathEntry(h.root, sub);
  if (!file) return undefined;
  const hit = subpathCache.get(file);
  if (hit) return hit;
  const env = harvestDts([file]);
  const scan = dtsFileScan(file);
  const named: Record<string, Abs> = {};
  for (const n of scan.exported) {
    if (!Object.hasOwn(env.globals, n)) continue;
    named[n] = harvestedValueToAbs(env.globals[n]);
  }
  const exports: AbsModuleExports = { named };
  const def = Object.hasOwn(env.globals, "default") ? env.globals["default"] : undefined;
  if (def) exports.default = harvestedValueToAbs(def);
  subpathCache.set(file, exports);
  return exports;
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
  const h = harvestPackageCached(pkg, dirname(fromFile));
  if (!h) return undefined;
  const table = packageHarvestToAbsModules(pkg, h);
  if (spec === pkg) return table[pkg];
  // 子路径说明符：**不得**回落到包名键（否则拿到根包的导出 ⇒ 另一个 API 的签名）
  if (Object.hasOwn(table, spec)) return table[spec];
  return subpathExports(pkg, spec, h);
}
