---
"@nudojs/core": patch
---

fix(core): 族 03 接线 —— mutator 在端到端路径上就地改接收者（Bug 254）

`Array.prototype.push.call({ length: 0 }, 5)` 原生会就地写接收者
（`o.length` 变 1、`o[0]` 变 5），但引擎此前把数组样接收者**物化成副本**再派发
mutator ⇒ 写入落在副本上（返回值对、写面丢）。

修法：mutator 家族在闭对象数组样接收者上改走**原接收者**
（`invokeArrMethod` 的泛型接收者臂 → `$arrMutContainer` → `mutateArrayLike` 就地写），
其余读方法保持物化通道。

同批把 `shift` 臂的空元组分支对齐 `pop` 臂（0-tuple 移出 `undefined`，
此前落到泛型接收者臂折 `unknown`）。

新回归钉 `core-bug-254-mutator-arraylike-wiring.test.ts`（端到端 6 例）。
