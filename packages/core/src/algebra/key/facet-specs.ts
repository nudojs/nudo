/**
 * ABS-15：`AbsFacets` 槽位的**单一登记表**（键编码 + 等价副本搬运策略）。
 *
 * 为什么：facets 槽位是 `Abs` 的可观察面（非空容器进 `absKey` / 指纹）。
 * 漏登记 = 不同值共享 memo（陈旧命中），或在重建点静默丢槽（A7 事故形态）。
 * 手写逐槽 `if` 的年代全靠人记，新增槽位没有任何编译期约束。
 *
 * 纪律：
 * - `FACET_SPECS` 用 `satisfies Record<keyof AbsFacets, FacetSpec>` ⇒
 *   **新增槽位不登记就编译红**；多登记一个 `AbsFacets` 没有的键同样红
 *   （对象字面量的多余属性检查）。
 * - `kind` 同时决定两件事，两个消费端各有 `never` 兜底（新增 kind
 *   会同时打红，强制两端一起实现）：
 *   - `facetKey` 的键片段编码（`key/abs-key.ts`）；
 *   - 等价副本的搬运策略（`abs.ts::cloneAbsFacets` → 本文件 `cloneFacets`）。
 * - **声明序 = `facetKey` 片段顺序**（`Object.keys` 序稳定）；键必须逐字节
 *   保持旧输出，调整顺序 = 缓存键漂移。
 * - 本模块必须是叶子：只 `import type` `AbsFacets`（运行时零依赖），
 *   `abs.ts` / `key/abs-key.ts` 都值导入它，不能反向成环。
 */
import type { Abs, AbsFacets } from "../abs.ts";

/**
 * 一个槽位的键/拷贝形态。新增 kind 必须同时改
 * `key/abs-key.ts::facetKey` 与 `cloneFacets` 的 `never` 兜底。
 */
export type FacetSpec =
  /** boolean：键 `prefix:1|0`；副本按值（标量，浅拷贝已保留）。 */
  | { kind: "flag"; prefix: string }
  /** string：键 `prefix:<JSON 引号串>`（闭合引号自定界）；副本按值。 */
  | { kind: "string"; prefix: string }
  /**
   * `{ strings: string[]; symbols?: string[] }`：键
   * `prefix:<JSON strings>:<JSON symbols ?? []>`；副本**深拷贝**两个数组，
   * `symbols` 缺省保持缺省。
   */
  | { kind: "string-array-record"; prefix: string }
  /** 只读投影面 `Abs`：键 `prefix:<absKey>`；副本**按引用共享**。 */
  | { kind: "abs-ref"; prefix: string }
  /**
   * 只读投影面 `Abs[]`：键 `prefix:<absKey|absKey|…>`；副本**浅拷贝数组**、
   * 元素按引用共享。
   */
  | { kind: "abs-list"; prefix: string };

export const FACET_SPECS = {
  callable: { kind: "flag", prefix: "c" },
  protoOwnKeys: { kind: "string-array-record", prefix: "k" },
  brand: { kind: "string", prefix: "b" },
  genReturn: { kind: "abs-ref", prefix: "gr" },
  genNext: { kind: "abs-ref", prefix: "gn" },
  genElements: { kind: "abs-list", prefix: "ge" },
} satisfies Record<keyof AbsFacets, FacetSpec>;

/**
 * 槽位键的**声明序**（= `facetKey` 片段序）。运行时取自 `FACET_SPECS`
 * 的对象键序（规范保证字符串键按插入序），不依赖调用方对象的属性顺序。
 */
export function facetKeys(): readonly (keyof AbsFacets)[] {
  return Object.keys(FACET_SPECS) as (keyof AbsFacets)[];
}

/**
 * `AbsFacets` 的等价副本：标量与只读投影面随浅拷贝携带/共享，容器按
 * kind 深/浅拷贝。`cloneAbsFacets`（`abs.ts`）的唯一实现，语义与旧手写版
 * 逐字节一致（属性顺序 = 源对象插入序）。
 */
export function cloneFacets(f: AbsFacets): AbsFacets {
  const out: AbsFacets = { ...f };
  for (const key of facetKeys()) {
    const spec = FACET_SPECS[key];
    const value = f[key];
    if (value === undefined) continue;
    switch (spec.kind) {
      case "flag":
      case "string":
      case "abs-ref":
        // 标量按值、只读投影面按引用 —— 浅拷贝已保留，无需覆写。
        break;
      case "string-array-record": {
        const rec = value as NonNullable<AbsFacets["protoOwnKeys"]>;
        Object.assign(out, {
          [key]: {
            strings: [...rec.strings],
            ...(rec.symbols ? { symbols: [...rec.symbols] } : {}),
          },
        });
        break;
      }
      case "abs-list":
        Object.assign(out, { [key]: [...(value as readonly Abs[])] });
        break;
      default: {
        // 新增 FacetSpec kind 未实现 ⇒ 编译期红（不得静默跳过搬运）。
        const unhandled: never = spec;
        throw new Error(`unregistered facet kind: ${String(unhandled)}`);
      }
    }
  }
  return out;
}
