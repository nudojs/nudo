/**
 * 数组 rest / spread 拼接：$arrRest / $concat。
 *
 * 从 iterate.ts 抽出；元素展开与长度可知性仍由 iterate 的能力函数提供。
 */
import type { Abs } from "../../../abs.ts";
import { abs, anyAbs, confJoin, litValue, unknown } from "../../../abs.ts";
import { $lit, asAbsVal } from "../state.ts";
import { $arr, tupleOrWiden, drainTupleOrWiden } from "./arr-make.ts";
import { joinAbs } from "../../../objects.ts";
import {
  shouldWidenArrayLiteral,
  widenedArrayConf,
  TUPLE_MATERIALIZE_CAP,
} from "../../../containers.ts";
import {
  isMapAbs,
  isSetAbs,
  mapEntriesAbs,
  setElementsAbs,
} from "../../../collections.ts";
import {
  drainGenElements,
  genDrainViewOf,
  matchIterElements,
  replayGenDeferred,
} from "../../match-iter.ts";
import {
  anyMemberResult,
} from "../../member-diag.ts";
import {
  builtinExactIterableElems,
  guardIterable,
  iterableElementDomain,
  iterableExpandElements,
  iterableExactElements,
} from "./iterate.ts";

export function $arrRest(a: Abs, start: number): Abs {
  // Bug 22：侧表迭代物（生成器对象）rest 解构按元素切片（原 tuple 路径）
  // Bug 54：解构是消费——从生成器当前位取剩余再切（此后生成器耗尽）
  // Bug 198（S20）：**live 集合 / 数组迭代器不登记静态元素侧表**（S17 根治点
  // ——静态表是创建期拷贝，会把长度探针与元素面冻结在创建时刻）⇒ 只查
  // matchIterElements 会漏判这类迭代物 ⇒ 门改为「静态侧表 **或** 消费视图」
  // （消费视图 = registerGenDrain 的 live 视图，元素面与长度都取当前剩余）。
  const gv = genDrainViewOf(a);
  const mi = matchIterElements(a);
  if (mi || gv) {
    // R1b：exact 生成器视图（线性收集序列）→ 切片越过 cap 出 exact 元组
    const exact = gv?.exact === true;
    const sliced = (drainGenElements(a) ?? mi ?? gv!.peekAll()).slice(start);
    if (sliced.length === 0) return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
    if ((!exact || sliced.length > TUPLE_MATERIALIZE_CAP) && shouldWidenArrayLiteral(sliced.length)) {
      const element = sliced.reduce((x, y) => joinAbs(x, y));
      return abs({ k: "arr", element }, undefined, undefined, widenedArrayConf());
    }
    return abs({ k: "tuple", elements: sliced }, undefined, undefined, a.conf);
  }
  a = asAbsVal(a);
  // BUG-125：URLSearchParams 的 rest 解构按条目表切片（@@iterator === entries）。
  {
    const urlSpEls = builtinExactIterableElems(a);
    if (urlSpEls) return tupleOrWiden(urlSpEls.slice(start), a.conf);
  }
  // Bug 56/N3：Arguments brand → 委托 tuple 内层——方法形参 rest 绑定
  //（emitParamBindingFromArgs 的 $arrRest 读 $arguments 槽）此前落尾
  // unknown（rest 形参在「读 arguments 的方法」里同样丢精度）
  if (a.shape.k === "brand" && a.shape.name === "Arguments") {
    return $arrRest(a.shape.shape, start);
  }
  // Bug 82：Set/Map rest 解构——同源侧表切片（`const [...all] = new Set(…)`
  // 此前落尾 unknown，all.length 假不可判；Map 条目是 [k, v] 元组）
  if (isSetAbs(a)) return tupleOrWiden(setElementsAbs(a).slice(start), a.conf);
  if (isMapAbs(a)) return tupleOrWiden(mapEntriesAbs(a).slice(start), a.conf);
  if (a.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const parts = a.shape.members.map((m) => $arrRest(m, start));
    return parts.length ? parts.reduce((x, y) => joinAbs(x, y)) : unknown;
  }
  if (a.shape.k === "tuple") {
    // 源带 rest 槽：尾段含 rest 的未知长度元素，不得只切固定位前缀
    if (a.shape.rest) {
      const sliced = a.shape.elements.slice(start);
      if (start < a.shape.elements.length && !shouldWidenArrayLiteral(sliced.length + 1)) {
        return abs(
          { k: "tuple", elements: sliced, rest: a.shape.rest },
          undefined,
          undefined,
          a.conf,
        );
      }
      // 起点落在 rest 段 / 切片超 cap：尾段退化为 rest 元素数组（join 固定前缀）
      const restEl = a.shape.rest.shape.k === "arr" ? a.shape.rest.shape.element : a.shape.rest;
      const el = sliced.reduce((x, y) => joinAbs(x, y), restEl);
      return abs({ k: "arr", element: el }, undefined, undefined, a.conf);
    }
    return tupleOrWiden(a.shape.elements.slice(start), a.conf);
  }
  // 其余迭代物（boxed String / 用户 iterable / TypedArray / 内层 tuple brand）
  // ——能力函数给出精确序列时按 rest 切片；长度不可判（null）仍落 unknown。
  // 这是 P4 的首个复用点：$arrRest 不再维护第二份「哪些内建可迭代」表。
  const exact = iterableExactElements(a);
  if (exact) return tupleOrWiden(exact.slice(start), a.conf);
  if (a.shape.k === "arr") return a;
  if (a.shape.k === "any") return abs({ k: "arr", element: anyMemberResult() }, undefined, undefined, "path");
  return unknown;
}

/** 数组连接 [...a, ...b] / [...a, x]；结果超 cap 时与字面量同策略降 arr */
export function $concat(a: Abs, b: Abs): Abs {
  a = asAbsVal(a);
  b = asAbsVal(b);
  // 字符串 spread：按 code points 拆（surrogate pair 合并；原生迭代语义）
  const avR = litValue(a);
  const av = avR.ok ? avR.value : undefined;
  if (typeof av === "string") {
    return $concat($arr([...av].map((c) => $lit(c))), b);
  }
  const bvR = litValue(b);
  const bv = bvR.ok ? bvR.value : undefined;
  if (typeof bv === "string") {
    return $concat(a, $arr([...bv].map((c) => $lit(c))));
  }
  const as = a.shape;
  const bs = b.shape;
  if (as.k === "tuple" && bs.k === "tuple") {
    return tupleOrWiden([...as.elements, ...bs.elements], confJoin(a.conf, b.conf));
  }
  // 剩余：至少一侧非 tuple/arr/string 字面量。
  // 迭代性守卫对齐共享分类器（iterabilityKind/guardIterable，与 $elems /
  // $iterCheck 同口径）：非字符串 prim（字面量或抽象 prim 面）与闭 obj
  // （无 @@iterator 槽）→ definite TypeError；any/unknown/open obj/brand/
  // fn → may TypeError。此前 throwIfNonIterable 只查 lit term——`[...x]`
  // （x:any）静默不记，而 `Math.max(...x)` 经 $elems 记 may，同面不同判
  // （wave 2 残留）。字符串/元组/Set/Map 等可迭代面与字面量行为不变。
  guardIterable(a, "spread element");
  guardIterable(b, "spread element");
  // Bug 34：数组字面量 spread 经 $concat（不走 $elems）——生成器对象的
  // 体内延迟异常在此重放（definite 抛 / soft may-throw 重记）
  replayGenDeferred(a);
  replayGenDeferred(b);
  // 迭代投影：模块级能力函数（见文件下方的 iterable* 实现）。
  const expand = iterableExpandElements;
  const sideEl = iterableElementDomain;
  const exactEls = iterableExactElements;
  // 一侧是抽象数组（arr）：spread 语义按元素并入（元素 join），
  // 不得整体嵌为单元素——字面量链超 cap 降级为 arr 后继续吸收后续元素也走此分支。
  // 非 arr/tuple 侧也按**元素域**取（`[...m, ...xs]` 的 m 是 iterable）——
  // 直接拿接收者本身会把整个对象当元素（[...m] 折 arr<Map>）。
  if (as.k === "arr" || bs.k === "arr") {
    const ea: Abs = as.k === "arr" || as.k === "tuple" ? sideEl(a, null) : sideEl(a, exactEls(a));
    const eb: Abs = bs.k === "arr" || bs.k === "tuple" ? sideEl(b, null) : sideEl(b, exactEls(b));
    return abs({ k: "arr", element: joinAbs(ea, eb) }, undefined, undefined, "path");
  }
  if (as.k === "tuple") {
    const be = exactEls(b);
    if (be) {
      // R1b：exact 生成器视图（线性收集序列）→ 重组越过 cap 出 exact 元组
      return drainTupleOrWiden(
        [...as.elements, ...be],
        confJoin(a.conf, b.conf),
        genDrainViewOf(b)?.exact === true,
      );
    }
    // b 可能可迭代：spread 并入的是 b 的元素而非 b 本身。
    // any 的元素域是 any（无约束），不是 unknown（引擎债）。
    const bEl = sideEl(b, be);
    return abs(
      { k: "arr", element: [...as.elements, bEl].reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "path",
    );
  }
  const ae = exactEls(a);
  if (ae && bs.k === "tuple") {
    // R1b：同上——[...g()] 的元素域来自 drain 的权威序列，不受形状面 cap
    return drainTupleOrWiden(
      [...ae, ...bs.elements],
      confJoin(a.conf, b.conf),
      genDrainViewOf(a)?.exact === true,
    );
  }
  // 双侧皆非精确容器：元素 join（any → any；空 tuple 不贡献元素）
  return abs(
    { k: "arr", element: joinAbs(sideEl(a, ae), sideEl(b, expand(b))) },
    undefined,
    undefined,
    "path",
  );
}
