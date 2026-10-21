---
"@nudojs/core": patch
"@nudojs/env": patch
---

族 29 修复 S6：Bug 882 · Bug 890 —— node:util 品牌形参函数的普通调用面 L2
假红 + env promise 缺 rejected 通道（catch 臂被当成死代码）。

**Bug 882（core 侧根因）** — `promisify` / `callbackify` / `inherits` /
`isDeepStrictEqual` 这类**品牌形参**函数在**具名导入**调用面
（`import { promisify } from "node:util"` ⇒ `promisify(readFile)`）报
`nudo:entry-may-throw`，而**成员调用**面（`util.promisify(readFile)`）正常
⇒ 同一函数两种口径。根因：普通调用面把**裸宿主值**（宿主函数 / 宿主构造器
/ 函数声明绑定）原样灌进 `bindTypeVars`，`arg.shape` 解引用 `undefined` ⇒
TypeError 冒泡 ⇒ 上层记 may TypeError ⇒ L2 假红（原生必不抛）。

- `packages/core/src/algebra/hof.ts` 的 `bindTypeVars`：**无形状的实参不参与
  类型变量绑定**（此前直接解引用 `arg.shape` 崩）。
- **普通调用面也做实参归一化**（与成员调用面同款）：`hof.ts` 新增
  `setRawArgNormalizer` 注册钩子，`packages/core/src/algebra/exec/class/invoke.ts`
  在加载期注册 `asAbsVal` 门面 ⇒ 两个调用面共用同一归一化 ⇒ 同一宿主函数恒
  同一 Abs 身份 ⇒ **两种口径一致**。

**Bug 890** — env 造的 promise **没有 rejected 通道** ⇒ core 读成「**确定
fulfilled**」⇒ `catch` 臂被当成**死代码** ⇒ 引擎给出**确定的错值**（原生
`fs/promises.readFile` / `fetch` / `crypto.subtle.digest` 都可能拒绝）。

- **core 侧零改动**：`settledFulfilledOf` / `then` / `catch` / `$await` 对
  **带 `rejected` 通道**的 promise 处理已经正确（`rejected !== undefined` ⇒
  不判「确定 fulfilled」；`catch` 走「两臂 join」分支；`$await` 把拒绝臂送进
  throw 通道 ⇒ `try/catch` 可吸收 ⇒ catch 臂可达）。本分片只补回归钉。
- **env 侧改法（`packages/env/src/abs-helpers.ts` 的 `promiseOf()`）**：给
  promise 形状补上 `rejected` 通道 ⇒ 两臂均可能 ⇒ catch 臂保持活：

  ```ts
  export function promiseOf(inner: Abs): Abs {
    return makeAbs(
      { k: "eff", eff: "promise", inner, rejected: unknown },
      undefined,
      undefined,
      "exact",
    );
  }
  ```

  （`unknown` = env 侧已有的 unknown Abs——拒绝 reason 不可知 ⇒ 两臂均可能；
  `rejected` 是**态信息**，不进 leq / 指纹 / check 等价。）
