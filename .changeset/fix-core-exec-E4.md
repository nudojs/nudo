---
"@nudojs/core": patch
---

fix(core): 数组方法族六处原生语义偏差（Bug 248 / 254 / 255 / 270 / 1040 / 1051）

- Bug 248：HOF 回调族（forEach/map/filter/reduce/reduceRight/some/every/
  find/findIndex/findLast/findLastIndex/flatMap）逐位读**当前容器**（原生
  `Get(O,k)` / `HasProperty(O,k)` 逐步现读），不再用进体前快照的元素表；
  `for..of` 走数组迭代器的 **live 视图**（`next()` 每步重读长度）⇒ 体内变异
  对后续迭代可见。
- Bug 254：mutator 家族（push/pop/shift/unshift/splice）的**泛型接收者**
  （数组样对象 `{length, 0: …}`）写面按 spec 落地（`Set(O,"length",n)` /
  `CreateDataPropertyOrThrow` / `DeletePropertyOrThrow`），不再静默丢弃写入；
  不可判定形态（open obj / 抽象 length / 访问器侧表）记 may-throw 后不写。
- Bug 255：`Array.prototype.fill()` **零实参**不再整条跳过（原生把整条数组
  填成 undefined、length 不变）；缺省 value 取「确定 undefined」。
- Bug 270：`toSpliced` / `splice` 的删除窗口走同一实现（spliceWindow）——
  `toSpliced()` 零实参 ⇒ start 缺省 ⇒ 不删；`toSpliced(0, undefined)` ⇒
  skipCount 在场（undefined ⇒ 0）⇒ 不删（此前把整条数组删空）。
- Bug 1040：`includes(searchElement, fromIndex)` 补 fromIndex 校验（bigint /
  symbol 确定 TypeError）⇒ L2 `nudo:entry-may-throw` 门禁不再假绿。
- Bug 1051：`lastIndexOf(x, undefined)` 的起始下标按原生取 0（fromIndex
  缺省 ⇒ len-1；显式 undefined ⇒ 0）——fromIndex 引入「缺省 / 显式
  undefined / 数值」第三态（`toIOIArg`）。
