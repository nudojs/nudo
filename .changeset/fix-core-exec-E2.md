---
"@nudojs/core": patch
---

fix(core): 族 03 exec/class 分片 E2——244 / 258 / 263 / 264 / 1035 / 1041

- **244** 原型 / 实例上的方法**写**（`A.prototype.m = fn` / `a.m = fn` /
  `this.m = fn`）此前在**派发面**被完全忽略 ⇒ monkey-patch 静默失效（跑的还是
  注册表里的旧方法体；写成非函数也不抛）。派发面改为按原生查找序
  own → prototype 查「实例自有槽 / 原型链数据槽」，命中即按用户写的值调用，
  非函数则定抛 TypeError。
- **258** `Function.prototype.apply` 的 **array-like** 实参此前只折 1 个未知
  实参 ⇒ 实参面塌陷（`f.apply(null,{length:2,0:1,1:2})` 原生传 2 个）。改为按
  `length`（字面量）逐下标取实参，缺席下标折 undefined；length 抽象仍保守
  折 unknown。
- **263** union 方法分派的成员判据此前**只认 `string`**（`method` 形参根本没被
  使用）⇒ number / boolean / bigint / symbol 成员上的方法（toFixed /
  toPrecision / toExponential …）在 union 上一律被判「missing」⇒ 成员被提前
  排除、值域塌成 unknown + 诊断点名错成员；反过来 string 成员被无条件放行 ⇒
  string 上不存在的方法也被判「有」。判据改为按各 prim 类型的**真实原型方法
  表**判定，被判「确定没有」的成员按原生记 TypeError may-throw（该分支定抛）
  并跳过该成员。
- **264** 内建命名空间对象上调用**不存在**的静态方法（`Math.clamp` /
  `JSON.foo` / `Object.foo` …）此前回落 unknown 且**不记 throws** ⇒ L2 门禁
  假绿（引擎声称不可能抛，原生恒抛 TypeError）。改为定抛 TypeError；成员
  存在但不是函数（`Math.PI()`）同抛；成员存在且引擎未建模仍保守折 unknown。
- **1035** 类值接收者（`A.m()`）的派发此前**先查实例方法表** ⇒ 同名 static +
  实例方法并存时跑错方法体、抛错方向双向反转。改为类值接收者先查静态面
  （静态方法表 → 类值自有槽 → 内建父构造器 → 静态访问器），静态面确无该
  成员时定抛 TypeError（原生 `A.m is not a function`）。
- **1041** 摘下的一等方法值（`const f = A.m`）在同名 static + 实例方法并存时
  **定抛 TypeError**（原生正常返回）⇒ L2 门禁假红。方法值的**来源侧**
  （static / inst）随值传到派发面（`protoMethodDispatch` 的 origin 参数），
  摘下调用按来源侧定方法体，不再「不可判」。
