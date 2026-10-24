---
"@nudojs/core": patch
---

fix(core): 形参表面模型记录解构模式种类、跳过 TS `this` 接收者标注、标注默认形参可选

- Bug 388：`FormalParam` 的 pattern 变体新增 `patternKind`（`"object"` / `"array"`）——
  数组解构形参在签名面渲染为 `[ x, y ]`（此前对象/数组解构一律渲染 `{ … }`）。
- Bug 392 / 393（模型层）：数组解构新增 `boundIndex`（绑定名 → 元素下标），
  `locateContractParam` 对数组解构按下标返回 `fieldIndex`（对象解构的属性键口径不变）。
- Bug 397：TS 的 `this: T` 是接收者标注而非运行时形参 ⇒ 不进形参表、不占实参位
  （形参表位置随之前移）。
- Bug 399（模型层）：形参表新增 `optional` 标记（默认形参 / rest / 带默认值的解构
  形参恒为 true）——消费侧算必选元数不再靠名字后缀猜。
