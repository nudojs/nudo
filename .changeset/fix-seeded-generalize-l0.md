---
"@nudojs/core": patch
---

fix(core): `@nudo:assume` / `@nudo:invariant` 求值不再复用 generalize 的进程内缓存
（种子求值绕过 L0）

`generalize` 的 L0（进程内函数签名 memo）键只装**静态身份**（源码指纹 / 依赖 /
预算等），不含 `@nudo:assume` 引理与 `@nudo:invariant` 循环界这两份**动态种子**
⇒ 带种子的求值可能命中无种子缓存（或反之），造成两类用户可见错误：

- **审计面蒸发（误导性假绿）**：同一文件第二次 `nudo check`、只改了无关兄弟函数、
  或 IDE/LSP 先跑过一次无种子签名推导后，带引理的函数会命中缓存而跳过重新求值
  ⇒ 引理消费账本没被填 ⇒ `nudo:assume-relied` / `nudo:invariant-relied`
  不再上屏，用户以为引理没被用上（实际证明仍依赖它）。现在这些场景与冷跑一致：
  relied info 每次都在。
- **精度泄漏**：种子求值折出的界（如 `1 - d/max ≥ 0 ∧ ≤ 1`）会被写进 L0 ⇒
  之后的**无种子**签名推导（`nudo check` 签名面 / LSP hover）读到它，
  在没有公理的上下文里显示只有引理才能证出的类型。现在无种子推导与冷跑逐字一致。

修复方式：种子非平凡（引理前提非 `true` 或有循环界规格）时，目标函数入口的
generalize **既不读也不写** L0；其余路径的缓存行为不变（无 `@nudo:assume` /
`@nudo:invariant` 的项目零变化）。
