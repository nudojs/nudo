/**
 * 公开产物面的**位置投影策略**单一入口。
 *
 * 背景（BUG-370）：同一个观测 Abs 在 dts 面被拓宽成 `number[]`，而 guard /
 * zod / standard 三面固化成 `[1, 2]` ⇒ 同一份产物自相矛盾。规则此前散落在
 * 每个 validator 面；现在所有 validator 的 `<fn>Output` 都经过本模块。
 *
 * 模式由**返回面来源**决定（`contract-face.ts` 的 `ReturnWidenMode`）：
 * - `observed`：call@ / entry@ 采样。字面量已由统一返回面递归拓宽；这里再
 *   做一次幂等拓宽并把握手元组折成数组（dts 同口径）。
 * - `scalar`：作者 `@nudo:case` 域 / 无 case 的观测。dts 只拓宽顶层标量
 *   字面量，保留对象槽与元组位置（`@nudo:case "x" ()` ⇒ `[1,2]` 仍是 tuple）。
 * - `none`：契约 / 声明字面量返回。声明即事实，不拓宽。
 *
 * 明确不在本模块：
 * - 形参位：`[number, number]` 是作者申报的定长契约，不得拓宽；
 * - 各渲染器的 dropped 台账：仍由 `absToSchemaNode` / guard 自己收集。
 */
import { absShapeKey, type Abs } from "@nudojs/core";
import { widenTopLevelAbs } from "./abs-widen.ts";
import { widenObservedLiterals } from "./schema-generator.ts";

/** validator 输出位的拓宽模式（与 `contract-face.ts` 的返回面来源同源）。 */
export type ReturnWidenMode = "observed" | "scalar" | "none";

/**
 * validator 输出面（`<fn>Output`）的投影。
 *
 * 默认 `observed`：没有来源元数据的手工 Abs（测试 / 直接 API）按观测处理，
 * 与 BUG-370 的既有行为兼容。
 */
export function projectValidatorOutput(a: Abs, widen: ReturnWidenMode = "observed"): Abs {
  if (widen === "none") return a;
  if (widen === "scalar") return widenTopLevelAbs(a);
  const widened = widenObservedLiterals(a);
  return collapseHomogeneousTuple(widened) ?? widened;
}

/**
 * 同构元组 → 数组。元素先经观测拓宽，再按**基类型键**比较；prim 只比类型，
 * 避免 `1` / `2` 的 term 差异阻止折叠（dts IR 同口径）。
 */
function collapseHomogeneousTuple(a: Abs): Abs | undefined {
  const s = a.shape;
  if (s.k !== "tuple" || (s.holes?.length ?? 0) > 0) return undefined;
  const els = s.elements;
  if (els.length === 0) return undefined;
  const first = els[0]!;
  const firstKey = elementKey(first);
  if (!els.every((e) => elementKey(e) === firstKey)) return undefined;
  if (s.rest !== undefined && elementKey(s.rest) !== firstKey) return undefined;
  return {
    ...a,
    shape: { k: "arr", element: first },
    term: undefined,
    pred: undefined,
    conf: "exact",
  };
}

function elementKey(a: Abs): string {
  const s = a.shape;
  return s.k === "prim" ? `prim:${s.type}` : absShapeKey(a);
}
