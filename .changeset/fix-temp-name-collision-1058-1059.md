---
"@nudojs/core": patch
---

族 45 修复 S11：Bug 1058 / Bug 1059 —— 引擎**内部临时名**与用户标识符**避让**。

同根因（Bug 181 的修复只装在了解构临时名族 `_d{n}` / `_n{n}` 上 ⇒ 这里只装了一半）：
引擎为转译生成的内部绑定一律用**固定名**发射（`arguments` 槽 `__nudoArgs` /
try 标记 `__nudoTm_{n}` / catch 载体 `__nudoE_{n}` / try 内 return 载体
`__nudoRet` / 写回载体 `__mutRet` / 函数体 catch 载体 `__nudoFnRet` /
宿主 rest 形参 `__margs` / `__allArgs` / 匿名默认导出合成名 `__nudoDefaultFn`
`__nudoDefaultClass`）⇒ 用户源码里写了同名标识符时两种失效形态都成立：

- **同作用域重复词法声明**（Bug 1058）⇒ 转译产物**不是合法 JS** ⇒ `new
  Function` 编译期 `SyntaxError` ⇒ 求值器 fail-closed ⇒ **整模块**导出退化为
  `unknown` + **假** `nudo:opaque-result`（「path not covered, or native」——
  误导诊断）⇒ 门禁 exit 0 **假绿**；连**无关**的导出也一并失去签名。
- **内层遮蔽**用户同名外层绑定（Bug 1059）⇒ 引擎的 `const __nudoRet = <用户
  表达式>` 在**自己的初始化器**里读 `__nudoRet` ⇒ TDZ `ReferenceError` ⇒ 被
  用户自己的 `catch` 吞掉 ⇒ 原生 `15` 被算成 `0`（wrong-exact）⇒ 签名面写成
  `=> 0` ⇒ 门禁假绿。

修法（`transpile/helpers.ts` 新增 `internalTmpName`）：生成内部名时用
`userIdentInfo(source).names`（源文本里出现过的**全部标识符词形**，保守超集）
做避让——撞名则加 `_k` 后缀并跳过已占用名。避让在**整个转译单元**生效（不做
作用域分析：用户在内层作用域声明的名字同样会遮蔽外层生成的临时名）⇒ 生成名与
用户标识符词形永不相撞；**无碰撞时原名返回** ⇒ 产物逐字不变；同一源文本 ⇒ 同一
名 ⇒ 产物**确定性**（缓存键 / 差分语料依赖它）。生成与使用**成对改名**
（声明 / 引用 / 词法槽绑定三处一致）。

回归钉：`packages/core/src/algebra/__tests__/eval-bug-1058-1059-temp-name-collision.test.ts`
（1059 结果 `15` 而非 `0`、签名面写 `15`；1058 三族不退化 `unknown`、无假
`nudo:opaque-result`、无关导出仍拿到签名；负控：内部名逐字不变；确定性：两次
转译逐字相同）。
