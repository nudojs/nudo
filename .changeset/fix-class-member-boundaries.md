---
"@nudojs/core": minor
"nudojs": minor
---

**BREAKING**: 类成员的调用点参数契约补齐**三条保守边界**（与普通函数 / 具名导入
同一口径）。

`nudo check` 此前对以下类成员调用点**零义务**（违约代码判绿）：

- **未导出的本地类**：`class L { @nudo:contract m }` 的 `const c = new L(); c.m(-1)` /
  `new L().m(-1)` / `L.s(-1)`。普通**未导出本地函数**本来就在调用点执法 ⇒ 类成员与
  本地函数规则不一致（同一义务两套口径）。
- **匿名 `export default class { m(a){} }`**：`import K from "./lib.js"` 后
  `new K().m(-1)` 解析不到类（具名 `export default class K` 已可用）。匿名类没有
  本地名 ⇒ 契约键用导出槽名（`default.m`，侧车键 `default_m`；`@nudo:contract` 的
  指令 scope 同口径）⇒ `nudo check` 现在报 `fn: default.m`。
- **命名空间导入**：`import * as ns from "./lib.js"` 的 `new ns.K().m(-1)` /
  `ns.K.s(-1)`（`const m = require(...)` 的 `m.K` 同路径）。类解析与具名导入共用
  同一套类 AST 事实（`classBindingOf`），不另写模块解析器。

修法：模块级本地类的 own 方法名并入**调用点扫描**的 knownFns（签名普查面 / L2 入口表
不动 ⇒ `nudo check` 的签名列表不因本地类扩面）；匿名默认类绑定名 = `default`；
命名空间模块按**词法作用域**解析（内层同名声明遮蔽 ⇒ 不解析）。

**谁不会坏（守卫，全部保持零新诊断）**：继承而来（非 own）的方法；构造器
`this.m = …` / 同名类字段覆盖；getter / setter / computed 成员名；静态 / 实例交叉
调用（`K.m` 调实例方法、`new K().s` 调静态方法）；接收者被形参 / 局部声明遮蔽；
重新赋值（失效范围从「当前作用域帧」改为**沿作用域链**——函数体内
`L = …` 之后不再套旧类契约）；未声明契约的类与方法（未导出本地类的侧车不绑，
与未导出本地函数同口径）。

**有意保持不执法（与普通函数 parity，不发明更宽义务）**：
`export { K as J } from "./lib.js"` 的别名再导出、`import { K } …; export { K }`、
以及命名空间经再导出 index（普通函数的 `ns.f` 同样不执法）。再导出环（a ↔ b）有
深度上限，终止且零诊断。
