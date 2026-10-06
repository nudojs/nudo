---
"@nudojs/core": patch
"@nudojs/env": patch
---

fix(core,env): L2 entry-may-throw 假阳性两处（issue #105 / #106）——1.3.5 的 builtin throws 语义对齐（2e5aeb35）引入的回归面：

- **#105 typeof 守卫后的 any 不再记假 may-throw**：`$narrowTypeOf` 此前只剪 sum 成员，裸 `any`（无约束入口参数）在守卫事实臂原样保留 → `RegExp.exec/test(v)` 的 subject ToString 档位按 any 记 may-throw。修复：事实臂（keep=true）any 健全窄化为对应 prim（string/number/boolean/bigint/symbol，term/pred/conf 保留；补集臂与 object/function/undefined 不可表示、unknown fail-closed 令牌均保守保留）。npm-safe `parseVersion`（`typeof v !== 'string'` + `if (!m) return null` 双守卫 + 捕获组读）恢复干净。无守卫的 `exec(any)` 仍如实报（原生 `exec(Symbol())` 抛 TypeError，与 check-gold 的 scale(x) 口径一致）。
- **#106 env 声明构造器不再报 constructibility 假抛**：env 的 Error 族声明为无名 envFn——`$new` 的按名派发（evalBuiltinNew → errorBrandAbs）拿不到名字，落到通用 fn 分支的 unknown-constructibility 门；`$class` 的 extends 门同样只见 ctor:undefined，`class ApiError extends Error` 定义期误报。修复：`envFn` 支持 `ctor` facet 并给 relationFn 路径补 `name` 盖章；Error 族 / Date / Promise / URL / AbortController / EventEmitter / stream 族声明 ctor:true（Symbol 声明 ctor:false——原生非构造器，`new Symbol()` / `extends Symbol` 仍定抛）；`$new` 的 ctor:true-无-impl 路径回落声明 returnType（保实例面精度，AbortController/EventEmitter 不丢方法槽）。`new Error('lit')` / `new TypeError('lit')` / `new ApiError(...)` / `class extends Error` 在 env 下恢复干净；`new Error(anyMsg)` 仍如实报 message ToString may-throw（node 实测 `new Error(Symbol())` 抛 TypeError，与无 env 宿主路径同口径）。
