---
"@nudojs/core": patch
---

fix(core): rest 形参实参聚合、未契约兄弟绑定补 unknown、env 门禁不再吞推断失败警告、`--assume` 的界不再被写死成 `x > 0`

- Bug 400：`locateContractParam` 算出的 `rest: true` 此前在
  `scan-literal-calls.ts` 的 `entries.push` 里被**丢掉** ⇒ 执法侧的实参映射
  （恒等 `(i) => i`）把**首个实参**当成 rest 形参的值 ⇒ `sum(...nums)` +
  契约 `array(number().gt(0))` 时，合法调用 `sum(1, 2)` 被判「实参 `1` ⊭ array
  约束」（假红），报出的实参值也是错的（`1` 而不是 `[1, 2]`）。现在 rest 标志
  **透传**到执法侧，该位之后的**全部实参聚成一个精确元组 Abs** 再与契约比
  ⇒ `sum(1, 2)` 通过；`sum(1, -2)` 报违例且 `actual` 是整个聚合值 `[1, -2]`。
- Bug 401：解构形参的合成形状只含**契约命中的字段** ⇒ 未契约的兄弟绑定
  从头到尾不进袋子 ⇒ 形参形状是**闭对象** ⇒ 读兄弟绑定得 **exact
  `undefined`**（自信的错值，native 是实值）。现在合成前把该 pattern 的
  **全部顶层绑定**都放进袋子（未契约的用 `unknown`）⇒ 形参类型写成
  `{ a: number, b: unknown }`，读 `b` 折 `unknown`。
- Bug 389：**没生效**的 `@nudo:env` 指令此前让函数体 fail-closed ⇒ 符号面
  `conf = opaque` ⇒ `check.ts` 的 `budgetExplained` 把它当「已解释」⇒ 唯一能
  提示「推断失败」的 `nudo:unknown-inference` **警告被吞**，取而代之的是一条
  把它引向 `@nudo:case` 的 `nudo:opaque-result` 信息（指错方向）。现在 env 门禁
  的事实（`PolyFn.envGated`）对诊断层可见 ⇒ 该场景发 `nudo:unknown-inference`
  警告，不再发指错方向的信息。
- Bug 976（core 半）：`buildArgsFromAssume` 把被假设形参的**前提写死**成
  `x > 0` ⇒ `--assume 'x>-5'` / `'x>-100'` 的负界被静默顶成 `x>0` ⇒ 引擎过度
  收窄、合法分支被剪掉（`"neg"` 分支不可达 ⇒ 错值 / 假绿）。现在 core 接收
  **形参 → 界**的映射，把用户声明的界直接落进形参的 `pred`（`>` 严格、`>=`
  非严格）；**没有声明界时不写界**（不替用户发明更强的默认界）⇒ Φ 只承担
  跨变量 / 额外前提。
