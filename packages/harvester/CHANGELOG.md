# @nudojs/harvester

## 0.4.5

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/env@0.5.5
  - @nudojs/parser@1.5.5

## 0.4.4

### Patch Changes

- Updated dependencies [f1d4958]
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/env@0.5.4
  - @nudojs/core@1.17.0
  - @nudojs/parser@1.5.4

## 0.4.3

### Patch Changes

- b4768ca: 族 27 修复 H1a：Bug 797 798 816 821 822 823 —— 条件类型的 `extends` 判定改成**三分支**（真 / 假 / 判不出）：字面量按值比（`number extends 1` 不再恒真）、brand 按结构比（同名之外不再确定判假）、`keyof` / `typeof` / 未解析类型判不出时**不取支**；`infer` 的括号穿透 + 绑定替换真支；条件元数据**按条目隔离**（不再从上下文级单槽泄漏进下一条签名 ⇒ 逐字相同的两条声明不再得到不同类型，冷 / 热缓存不再翻转结论）；真支是嵌套条件类型时**递归求值**（不再被 `infer` 变量顶替）。
- b4768ca: 族 27 修复 H1b：Bug 799 / 800 / 802 / 803 / 810 / 811 / 819 / 829 / 830 —— 泛型 / 交叉 / 元组 / 索引 / 类型字面量的收割面与 TypeScript 真实语义对齐：交叉类型合并两侧成员、泛型别名按类型实参实例化、元组逐槽映射、`Record` / 索引签名建成开放对象、方法类型形参按作用域遮蔽外层同名形参、内联类型字面量的访问器成员可读、构造签名带 `ctor` 面、调用签名投影成 fn、落盘产物保留泛型 α 的 var term。
- b4768ca: 族 27 修复 H2：Bug 791 · 805 · 806 · 812 · 813 —— 泛型实例化按**实参身份**分桶、
  接口成员**重载集全部保留**、递归类型别名改**按引用建模**（不再指数展开）、
  递归 interface 的自引用不再铸成**闭合空 brand**、类型形参**默认值生效**。
  
  **Bug 791** — 泛型实例化缓存键只编码**实参个数** ⇒ 同一接口的不同类型实参命中
  同一条缓存 ⇒ `Box<number>` 被折成 `Box<string>`（`Box<number>.value` 收割成
  `string`）。缓存键改成编码类型实参的**身份**（Abs 结构 + α term 身份）⇒ 不同
  实参 ⇒ 不同实例；同一实参 ⇒ 仍然命中缓存（同一个 Abs 实例对象）。
  
  **Bug 805** — 接口成员的**重载集只保留第一个 overload** ⇒ 其余 overload 的返回
  类型被**整体抹除**（`m(a: number): string; m(a: string): number` 收割成
  `(number) => string` ⇒ 假红 + 假绿，与 TS 完全倒置）。重载集现在**全部保留**：
  参数位逐位 union（复用顶层函数路径的 `mergeOverloadParams`，Bug 827 同族），
  返回位取 union（带 α 的返回优先）⇒ 与 materialize 的 fn 分支**同口径**，
  同一实体两条收割路径不再分叉。
  
  **Bug 806** — 递归**类型别名**按 depth 硬展开 ⇒ 展开 8 层且**指数级**（6 个
  自引用成员 ⇒ 54,083,943 字节的 env 模块）⇒ 末层折成 `unknown`。递归别名改成
  **惰性/引用式建模**：别名登记成合成 interface（成员面照搬类型字面量），自引用点
  经实例化路径落到「按名引用 + 形状待定」的 brand ⇒ 不再内联展开。同一夹具现在
  5,176 字节（≈ 10,000× 更小），且互引别名（`type A = { b: B }; type B = { a: A }`）
  同样被识别为递归。
  
  **Bug 812** — 递归 interface 的自引用被铸成**空 brand**（`absBrand(name, {})`）
  ⇒ 那是**闭合空对象** = 「该对象确定没有这个成员」⇒ 成员读走「槽位缺失 ⇒
  exact undefined」⇒ 合法代码被判「定抛 TypeError」（L2 门禁假红）。自引用改成
  「按名引用 + 形状待定」（`shape: unknown`）—— 与落盘面（`emitAbs` 早已如此）
  同口径 ⇒ **收割面 / 磁盘往返面 / 落盘发射面**给出同一个类型。
  
  **Bug 813** — 泛型**类型形参默认值**从不读取 ⇒ 无参引用（`Box` 对
  `interface Box<T extends string = string>`）留下**未绑定 α** ⇒ 引擎侧「未绑定
  α」= 无约束值 ⇒ 其上的方法调用被建模为定抛 TypeError（假红）。现在按 TS 语义取
  值：显式实参 > **默认值** > **约束** > 推断 `unknown`（不再留未绑定 α）。
  
  ⚠️ 已知残留（core 侧，本次不改）：Bug 805 的重载在**调用点**仍无法按实参类型选
  arm —— Abs 的 fn 形状没有 overload 集合的承载位，收割面只能给 union 返回 ⇒
  `union` 方法分派的保守性（string 分支也参与 `toFixed` 分派）仍会让
  `iov.m("hello").toFixed(0)` 报 may-throw（与顶层函数路径的 Bug 827 同款残留，
  core 冻结，本次不消）。
- b4768ca: 族 27 修复 H3：Bug 792 807 808 809 831 832 977 —— 收割面的**接口成员表**与 TypeScript 对齐：限定名类型引用不再并入其它命名空间的同名接口（792）、同一接口方法在 brand 面与模块级提升面是同一个类型（807）、提升时保留 `?` 可选标记（808）、`extends` 的继承成员并入实例模型（809）、接口成员提升不再抢真实导出的名字也不产生幽灵导出（831）、计算成员名 `[Symbol.iterator]` 保留（迭代协议不再整体丢失，832）、可选**方法**成员与可选属性同口径保留可省性（977）。
- b4768ca: 族 27 修复 H4：Bug 814 · 815 · 817 · 818 · 820 · 824 · 827 —— 收割面不再丢
  导出形式（`export default` / `export { X as Y }` / `export = X` / `export * from`），
  导出表不再随 `.d.ts` 遍历顺序变，重载集不再塌成「第一个 overload 的参数 + union 返回」。
  
  **Bug 814** — `export default` **不在模块导出表里** ⇒ 默认导入落 `unknown`（假警告）；
  默认导出的**局部名**被当成具名导出（假绿：TS 侧是 TS2614，引擎侧解析成功）。
  
  - `export default function foo()` / `export default class Foo {}` 的导出名改成
    `default`（局部名不再进导出表）；`export default <局部名>` 解析到该局部绑定的值。
  
  **Bug 815** — `export { X as Y }`（本地改名再导出）被**整条丢弃** ⇒ 改名后的导出
  根本不存在（假警告）。现在改名后的导出名进导出表，值取局部绑定。
  
  **Bug 817** — `export * from` 的别名应用是**整记录替换**（`!ctx.modules[alias]` 守卫）
  ⇒ **有自有声明的模块**把星号再导出的名字**整批丢掉**。别名改成与模块自有声明
  **合并**（自有优先），多目标（`export * from "a"; export * from "b";`）也合并；
  纯别名仍与目标共用同一条记录（落盘面继续去重）。
  
  **Bug 818** — `declare module "x" { export = <本地类/常量> }` ⇒ **整个模块记录不生成**
  （`ctx.skipped++` 静默丢弃）。现在模块记录生成、`default` = 被导出实体的值；
  解析不出来时计入 `skipped`（汇总行有信号）。按 TS 语义（`export =` 的类只能默认导入，
  具名导入是 TS2595）**不**生成具名导出。
  
  **Bug 820** — `export { X }` 的「是不是值」判定发生在 **Phase 1** ⇒ 模块导出表随
  **`.d.ts` 遍历顺序**变（同一份声明换个文件顺序就少一个导出）。判定挪到物化阶段
  （符号表完整时）⇒ 导出表逐项相同、与遍历顺序无关。类型位导出
  （`export type { X }` / `export { type X }`）不产生运行时值，计入 `skipped`。
  
  **Bug 824** — 模块级 `.d.ts` **顶层的 CJS `export = X`** 整个被丢弃 ⇒ 该包**没有
  `default` 导出** ⇒ ESM 默认导入（`import _ from "pkg"`）落 `unknown` + 假警告。
  现在顶层 `export = X` 进 `default` 导出（值 = X 的值），桥接层把它提升成包的
  `default` 导出。
  
  **Bug 827** — 顶层函数的**重载集塌成 union 返回**（参数只取第一个 overload）。
  参数位改成保留**每个** overload 的参数类型（逐位 union；参数个数不同或带泛型 α
  时保持原样），返回位仍是各 overload 返回类型的 union ⇒ 重载集不再在收割产物里
  被抹掉。
  
  ⚠️ 已知残留（core 侧，本次不改）：`convert(1).toFixed()` 的 **L5 假红**还需要
  core 侧「按实参形态选 overload arm」的 dispatch（Abs 的 fn 形状目前没有 overload
  集合的承载位）＋ union 方法分派只认 `string` 成员（Bug 771 / 263）—— 收割侧
  无法单独消掉该假红，详见交付报告的「越界发现」段。
- b4768ca: 族 27 修复 H5：Bug 793 · Bug 794 · Bug 796 · Bug 804 · Bug 826 —— 声明采集
  **丢实体 / 元数错位 / 可构造性未知**（收割面）。
  
  **Bug 793** — 顶层 `declare namespace` 的**运行时成员被摊平进 globals** ⇒
  harvester **凭空造出全局**（`declare namespace Foo { function bar() {} }` ⇒
  globals 里多出一个不存在的 `bar`）⇒ 并**抑制**了对应的 ReferenceError 诊断
  （裸 `bar()` 被当成有定义；`tsc --strict` 对同一份代码报 TS2304）。
  
  - `harvest-dts.ts` 的 `collectStatement`：`namespace` 分支改为把运行时成员收进
    **命名空间自有的记录**（`Scope.nsRec`），并挂一个命名空间对象 `Foo`（成员在
    `Foo.bar` 面）⇒ **不摊平**进 globals。
  - `recordFor` 命中 `scope.nsRec` ⇒ 命名空间成员落在自己的记录里；`scopeKey`
    把命名空间链计入作用域键 ⇒ 两个命名空间的同名成员不会被当成 overload 合并。
  - 只有类型（interface / type）的命名空间**不产生**运行时对象 ⇒
    `declare namespace _ { interface X {} }` 不会凭空多出一个全局 `_`。
  - 模块作用域（`declare module "x" { namespace Y { … } }`）保持既有口径
    （成员摊平进模块记录）：`export = ns` 的模块（@types/node 的 path / fs）
    正是这个形态。
  
  **Bug 794** — `this` 形参被当**普通形参**收割 ⇒ **元数错位**（arity +1，
  第一个真实实参被绑到 `this` 槽）+ 契约草稿凭空多一个必填参数。
  
  - `harvest-dts.ts` 的 `signatureToFnSig` 跳过 `this` 形参（TS 把它建模成
    名字为 `this` 的普通 ParameterDeclaration，不显式跳过就与真形参无法区分）。
  - `classValueAbs` 的构造器参数同口径（跳过 `this` 形参）。
  - 草稿面（`dts-contract-draft.ts`）不在本片区间：对应改法见交付报告。
  
  **Bug 796** — `declare class` 的**实例成员整体丢失**（`declare class` 的
  `instanceFor` 拿到空壳 ⇒ 展开成空 obj）+ `const p: Point` 这个**绑定从
  globals 彻底消失**。
  
  - `harvest-dts.ts` 的 `interfaceDeclsOf` 放宽为「interface **或** class」
    （成员收集器本来就写好了类支持，只是被一道 `isInterfaceDeclaration` 过滤
    挡在门外）；返回类型随之放宽为 `NamedTypeDecl[]`。
  - `registerTypeDecl` 对 class 也登记**限定名**（命名空间里的 class
    `NodeJS.Process` 的实例面可解析）。
  
  **Bug 804** — 映射类型 / 模板字面量类型 / 索引访问类型（以及 `keyof` /
  `typeof`）落 `unknown` 后，**`declare const` 整条绑定被丢弃** ⇒ 用户代码引用
  它时被判「**确定抛 ReferenceError**」（L2 假红；`tsc --strict` exit 0）。
  
  - `harvest-dts.ts` 的 `materialize` var 分支：类型判不出时**保留绑定**（值为
    `unknown`）——「类型未建模」是**降级**（值域未知），不是「符号不存在」⇒
    不再计入 `skipped`（丢了才计入）。
  
  **Bug 826** — 收割的 **`declare class` 类值没有 `ctor` facet** ⇒ `new X()`
  被判「**可能抛 TypeError**（可构造性未知）」⇒ L2 假红。
  
  - `harvest-dts.ts` 的 `classValueAbs`：类值走 `absCtorSig`（带 `ctor: true`
    facet）—— core 的 `new` 路径按 callee 的 `ctor` facet 判可构造性。
  - `harvest-to-abs.ts` 的 `harvestedValueToAbs`：mock 化时**透传** `ctor`
    facet（否则又变回「可构造性未知」）。
- b4768ca: 族 27 修复 H6：Bug 795 · Bug 828 · Bug 836 —— 落盘面保留 `bigint` / `symbol`
  原语（不再降级 `unknown`）+ 导出表 / 模块记录表改用**无原型字典**（撞
  `Object.prototype` 成员的导出不再整条丢失、`declare module "__proto__"` 不再
  污染 `Object.prototype`）。
  
  **Bug 795** — `emitEnvModule` 只认 `number` / `string` / `boolean` 三个原语，
  `bigint` / `symbol` **一律降级成 `unknown`** ⇒ **同一份 `.d.ts`，内存收割与
  落盘产物给出不同答案**（内存面是 `(bigint) => bigint`，落盘面是
  `(unknown) => unknown`）。
  
  - `harvest-dts.ts` 的 `emitAbs`（落盘渲染）补 `bigint` / `symbol` 分支 ⇒ 与
    内存面（`mapType` → `absPrim`）同口径；磁盘投影（`harvest-json.ts`）本来就
    带这两个原语 ⇒ 这次补的是**发射器**与**磁盘格式**之间的能力缺口。
  - `harvest-json.ts` 的 `harvestSigToAbs` 去掉骗人的
    `sig.type as "number" | "string" | "boolean" | "bigint"` 硬转：改成白名单
    校验（`bigint` / `symbol` 都保留，未知原语标签诚实降级成 `unknown`）。
  
  **Bug 828** — 导出表 / 成员表用**普通对象 + 原型链裸读裸写** ⇒ 名字撞
  `Object.prototype` 成员的导出（`toString` / `valueOf` / `hasOwnProperty` /
  `constructor` / `__proto__`）**整条静默丢失**，而 `stats.skipped` 仍是 0 ⇒
  端到端 L2 假红（`tsc --strict` exit 0 的代码报 may-throw + unknown-inference）。
  
  - `harvest-dts.ts` 的 `recordFor`：`globals` / 模块记录表改用
    `Object.create(null)`（**无原型** ⇒ 只有自有键可见，`__proto__` 只是普通
    数据键），并用 `Object.hasOwn` 判定「已有记录」⇒ 去重裸读不再命中原型成员。
  - `harvest-json.ts` 的序列化 / 回放路径同样改用无原型表（模块名 / 导出名 /
    对象槽名撞原型成员时不再被吞）。
  
  **Bug 836** — `declare module "__proto__"` 让收割器把导出**直接写到
  `Object.prototype`** 上 ⇒ **进程级原型污染**（分析进程里每个普通对象都多出
  该成员）+ 该模块记录从表里**消失**。
  
  - `harvest-dts.ts` 的 `recordFor`：模块记录表无原型 + own-property 判定 ⇒
    模块名 `__proto__` / `constructor` 读到的是**自己的记录**而不是
    `Object.prototype` / `Object` ⇒ 不再写穿原型链，模块记录也不再消失。
  - `harvest-dts.ts` 的 `emitKey`：`__proto__` 改用**计算属性名**
    （`["__proto__"]`）——对象字面量里的 `__proto__: v`（即便带引号）也会触发
    `[[SetPrototypeOf]]` ⇒ 成员丢失 + 字面量原型被改写。
- b4768ca: 族 27 修复 H7：Bug 833 835 1014 —— 包根解析改为「包自带 types 优先、`@types` 最后回落」；包名键只由该包自己的顶层导出占（模块记录不再占包名键），子路径说明符不再回落到包名键；ambient 声明（`declare global` / script 模式 `.d.ts`）不再被提升成包名键的具名导出。
- b4768ca: 族 27 修复 H8a：Bug 801 / 916 / 945 / 1011 / 1012 / 1013 —— `contract --from-dts` 的**草稿面**类型语义与 TypeScript 对齐：
  
  - **801**：TS 的 `null` 不再映射成 `any()`（契约是空的 ⇒ 假绿）⇒ 映射成**真 null 面**（`union(…, null)`）；`undefined` 同理；约束位（导出顶层 / fn 返回位）上的裸字面量包一层 `union(…)` ⇒ 草稿抄进侧车后仍是**真约束**。
  - **916**：`Promise<T>` **不再剥掉** Promise 外壳（剥掉 ⇒ 契约先天不可满足 ⇒ 假红，且与收割面相反）⇒ 该位无约束 + 如实标注丢失（与收割面保留 `eff/promise` 同口径）。
  - **945**：类型字面量里的**方法签名**成员不再被丢（丢了 ⇒ 契约被悄悄放宽 ⇒ 假绿 TS2345）⇒ 进契约为 `fn(…)`；数字键成员同样保留。
  - **1011**：同文件的 `type` 别名**被解析**（不解析 ⇒ `string` 降成 `any()` ⇒ 零义务假绿）⇒ `type Id = string` ⇒ `string()`；`interface` 同样展开成 shape。
  - **1012**：`Partial<T>` 的字段**变可选**（原样透传 ⇒ 比 TS 更严 ⇒ 假红）⇒ `partial(shape({…}))`。
  - **1013**：`Record<K,V>` 的值域**落到实现**（键为字面量集合时 ⇒ `shape({ a: number() })`）；键非字面量时契约 DSL 无索引签名 ⇒ **如实降级**（不再写「注释宣称有值域」的假声明）＋ 标注「值域未建模」＋ 计入 `skipped`。
- b4768ca: 族 27 修复 H8b：Bug 825 · 834 · 960 · 1003 · 1015 —— 草稿面（`nudo contract
  --from-dts`）不再静默丢导出 / 说谎的汇总行 / 产出语法非法的草稿。
  
  **Bug 825** — **重载集静默塌成第一个 overload** ⇒ 草稿少声明签名，且被丢掉的
  overload **不计入 `skipped`** ⇒ 汇总行看不出任何丢失。现在重载**全部保留**
  （返回位取全部 overload 的 union，与收割面同口径），每条 overload 的**签名写进
  note**（审阅者看得见「这里本来有 N 条」），被合并掉的 overload **逐条计入
  `stats.skipped`**。
  
  **Bug 834** — 带引号 / 连字符的属性键产出**语法非法**的草稿 ⇒ 抄进 `*.nudo.js`
  后 sidecar **加载失败** ⇒ `nudo check` 门禁由绿转红（exit 1）。属性键现在走
  **合法转义**（JS 标识符 / 字符串字面量两种合法形态）；`__proto__` 走**计算属性名**
  （对象字面量里的 `__proto__: v` 即便带引号也会触发 `[[SetPrototypeOf]]` ⇒ 成员从
  字面量里消失）。
  
  **Bug 960** — 5 类**运行时导出**（`export {x} from` / `export * from` / `enum` /
  `namespace` / 匿名 `export default function`）整条丢弃，且汇总行报「0 skipped」⇒
  丢失零信号；而同一 harvester 的**收割面看得见 `Color`（enum）** ⇒ 两个产物面自相
  矛盾。现在 5 类导出全部进草稿（`enum` / `namespace` 投影成运行时 shape；再导出
  逐个 push + note）；**投影不了的也要 `push({name, note, kind})`** ⇒ 进
  `stats.skipped` ⇒ 汇总行说真话。
  
  **Bug 1003** — **具名 default 导出**被写成本地名键 ⇒ 草稿键 `helper` ≠ 模块导出名
  `default` ⇒ 照抄进侧车后该导出**永远零义务**（假绿），而汇总行报「0 skipped」。
  现在 default 导出的草稿键**恒为 `default`** ⇒ 抄进侧车后绑定的是模块的 `default`
  导出（实测 `impl(x: number) => string`；改前是 `impl(x: any) => string` +
  `nudo:interface-entry-only`）。
  
  **Bug 1015** — 目录模式**静默只投影前 16 个 `.d.ts`** ⇒ 第 17+ 个文件的导出整条
  不存在，而汇总行报「16 d.ts · 0 skipped」。现在目录模式**投影全部** `.d.ts`；
  遍历不到的地方（读失败 / 深度上限）**如实计数** ⇒ 汇总行说真话。
- 1b08a18: 族 27 修复 S4：Bug 1054 —— TS **类型谓词**的返回类型不再被收割成 `unknown`。
  
  `mapType` 的类型节点分派表**没有 `TypePredicate` 分支** ⇒ `x is T` / `asserts x is T`
  落进兜底分支（`default: return absUnknown()`）⇒ 被谓词的签名返回面变成 `unknown`：
  
  - 调用方的签名面随之变成 `unknown` ⇒ 触发 `nudo:unknown-inference` **误导诊断**
    （把「谓词返回 boolean」说成「推断失败」，并把用户引向 `@nudo:case` / env mock /
    refine —— 而真正要修的是收割器）；
  - dts 产物写 `unknown` ⇒ 消费方 tsc **TS2322 假红**（`const b: boolean = f(x)`）。
  
  修法（**同一张分派表**上补分支，不另起一套）：按 TS 运行时语义映射返回面 ——
  `x is T` ⇒ **`boolean`**（`T` 是**收窄信息**，是调用点的副作用，**不是**返回面）；
  `asserts x is T` / `asserts x` ⇒ **`void`**（断言函数运行时返回 `undefined`，
  与 `: void` 返回同口径）。覆盖顶层函数、接口方法签名、函数类型（type literal）三条路径。
- b4768ca: 族 27 收口接线：让**三个产物面**（内存收割面 / 磁盘缓存面 / 落盘源码面）与
  **两个产物面**（收割面 / 草稿面）在同一份 `.d.ts` 上给出**同一个类型**。
  
  **磁盘 ABI v8 → v9 → v10** —— `HARVEST_DISK_ABI` 随收割语义抬版本。不抬则
  用户本地 `~/.cache/nudo/deps/` 里的旧收割产物会继续命中 ⇒ CLI **看不到本轮
  修复**（实测：同一夹具，旧缓存 ⇒ `useDefault(xs: any) => unknown`）。
  v10 覆盖收口时又改的三处语义：`this` 形参不再进收割签名（Bug 794）、
  `declare class` 进入接口成员表并带 `ctor` facet（Bug 796 / 826）、顶层
  `declare namespace` 的运行时成员收进命名空间自有记录（Bug 793）。
  
  **磁盘投影补 facet** —— `HarvestSig` 此前只投影 `params` / `returns`，把
  `obj` 的索引签名与开放标志、`tuple` 的 rest、`fn` 的 `ctor` 与静态槽**全部
  丢掉** ⇒ 缓存往返把「开放对象 + 值域」抹成闭合空对象（成员读 undefined ⇒
  定抛）、把「构造器」抹成普通 fn（`new` 落「可构造性未知」⇒ 假红）、把类型
  字面量的具名成员抹掉。`absToHarvestSig` 投影 + `harvestSigToAbs` 还原两侧
  同时补齐。
  
  **磁盘投影补条件元数据** —— `fn` 形态加 `inferFrom` / `condFallback`：条件
  类型判不出时的绑定线索与假支此前不投影 ⇒ 缓存命中后条件元数据丢失 ⇒
  **同一份 `.d.ts`，冷缓存与热缓存给出不同类型**（实测：改前冷 ⇒ `callCond()`
  返回 `0`，热 ⇒ `any`；改后冷 / 热完全一致）。
  
  **落盘源码面补 `ctor` / 静态槽** —— `emitAbs` 的 `fn` 分支此前只发
  `relationFn([...], ret, { conf: "exact" })`，把 facet 全丢 ⇒ 走落盘 env 模块
  时 `new X()` 判「可构造性未知」。用 IIFE 在 `relationFn` 之后补 facet（**不改
  core 冻结面**）⇒ 三路径同型。
  
  **草稿面 `this` 形参跳过** —— `dts-contract-draft.ts` 的参数收集此前把
  `this` 写成必填实参位 ⇒ 草稿元数 +1（第一个真实实参被绑到 `this` 槽）。
  判据同收割面。
  
  **草稿面接口 heritage 展开** —— `extends` 基接口的成员进草稿（带环保护）。
  
  **CLI 汇总行接 `droppedDirs`** —— `nudo contract --from-dts <目录>` 的目录
  模式只取 `dtsPathToContractDraft` 的 `files`、**丢掉它的 stats** ⇒
  「遍历不到的目录」不出现在汇总行 ⇒ 汇总行报「0 skipped」而实际丢了东西。
  现在并进 `skipped`。
- 5fd3cbb: fix(harvester): 草稿面（`nudo contract --from-dts`）8 条与收割面**同源**（族 51）
  
  harvester 有两面：**收割面**（`harvest-dts.ts` → Abs）与**草稿面**
  （`dts-contract-draft.ts` → `*.nudo.js` 草稿）。台账族 27 记了 8 条**草稿面**的
  纯缺口（收割面已修、草稿面没跟上）⇒ 同一份 `.d.ts`，收割面说得准、草稿面说不了
  （草稿比 TS **松**，**不是假红**，但用户拿到的是残缺草稿）；共同症状是
  **静默降级**成 `any()` / 丢成员，而**汇总行不说谎** ⇒ 用户看不出草稿缺了什么。
  
  本次只改草稿面（`packages/harvester/src/dts-contract-draft.ts`），逐条照搬收割面
  （`harvest-dts.ts`）的既有正确处理：
  
  1. **条件类型**：新增 `ConditionalTypeNode` 分支 ⇒ 判不出时取**两支并集**
     （收割面 `mapConditionalType` 同口径），`extends unknown` 的恒真形态只取真支；
     不再整条降级 `any()`，且降级**明确可见**（note ⇒ 计入 `skipped`）。
  2. **计算成员名**：`memberKey` 按收割面 `computedMemberName` 同口径认
     `Symbol.iterator` → `@@iterator` / `Symbol.asyncIterator` → `@@asyncIterator` /
     计算键的字符串字面量 ⇒ **不再整条丢弃**；不可静态判定者留 note
     ⇒ **部分**丢失时汇总行也看得见（此前只在「全部成员被丢」时才发 note）。
  3. **`extends` 基接口成员**：`collectSymbols` 按**限定名**登记（命名空间内的
     interface 登记为 `A.Opts`），`interfaceMembers` 按限定名解析基类
     ⇒ 基接口成员**进草稿**，且 `A.Base` 与 `B.Base` 不互相并入。
  4. **命名空间限定名**：`A.Opts` 能解析（此前只有短名桶 ⇒ 降级 `any()`）。
  5. **class 构造器签名**：投影为类值的构造器 fn（收割面同款：类值 = 构造器）
     ⇒ `new Thing(…)` 不再零义务；该条**计入 `skipped`**（契约 DSL 无 `new` 语义 ⇒
     需人工审阅），汇总行不再说谎。
  6. **ambient module 体**：`declare module "x" { … }` / `declare global { … }`
     的**体**被遍历 ⇒ 内部导出**进草稿**且**计数**（此前整块不可见也不计数）。
  7. **重载 arity**：元数**相同** ⇒ 形参**按位合并**（并集，不比 TS 更严，
     收割面 Bug 827 同口径）；元数**不同** ⇒ 仍取首个 overload（改成最宽会让
     `f("a")` 变成「参数不够」⇒ 假红）但**明确标注窄口径**（note 写明 arity 与
     「多参调用不在覆盖内」）。
  8. **跨文件再导出 / 跨文件导入的类型**：名字**可见**、降级**可见**且**计入
     `skipped`**（类型需模块解析器 ⇒ 本片无法闭合，已如实标注为剩余缺口）。
  
  草稿面**不比 TS 更严**（新投影只会更宽：并集 / 可见降级），负控形态（与族 51 无关的
  声明）的草稿输出**逐字不变**；既有金标全绿（`packages/harvester` 72 个测试文件
  / 344 例）。
- 5fb8a51: 族 52 修复（片 W2）：harvester **收割面**的 7 条残留 —— ①**非限定**类型引用按「引用点所在命名空间」解析（`A.Opts` 与 `B.Opts` 不再互相并入；792 残留）；②`extends` 的**基接口**按基声明分别代入类型实参（`interface D extends Base<number>` ⇒ 基成员 `v` 是 `number`，不再是 α）；③条件类型按**绑定实参**求值真支（嵌套条件类型给出精确的 `"s"` / `"n"` / `"x"`，不再给并集）；④泛型实例化顺序反转（成员在**类型实参**的作用域里映射 ⇒ `Box<Promise<string>>` 的 `payload` 是 `string`，不再是 α）；⑤**模块作用域**的命名空间不再摊平进模块记录（`declare module "x" { namespace Y { … } }` ⇒ `import { bar } from "x"` 不再错误解析成功，与 TS 的 TS2305 同口径；`export = ns` 的模块导出面仍摊平 ⇒ @types/node 的 `node:path` 等真实包零回归）；⑥「类型未建模」进 `stats.degraded`（**可选**字段，降级 ≠ 丢了；没有降级时 `stats` 形状逐字不变）；⑦**匿名**默认导出（`export default function (): void;` / `export default class { … }`）不再被丢掉 ⇒ 模块的 `default` 导出在，不再计入 `skipped`。
  
  **磁盘 ABI v10 → v11** —— `HARVEST_DISK_ABI` 随收割语义抬版本（①②③④⑦ 任一条都会让
  旧缓存的物化结果与新收割器不一致 ⇒ 旧缓存必须 miss，否则用户本地
  `~/.cache/nudo/deps/` 里的旧收割产物会继续命中 ⇒ CLI 看不到本轮修复）。
- dde4b03: `nudo contract --draft` now writes a draft that can be copied into a sidecar
  as-is: the sidecar key is the module's **export identity**, the file is
  always valid JavaScript, the return obligation never contradicts the
  function's own inferred return domain, and a draft the user has edited is
  never silently overwritten.
  
  - The draft's sidecar key came from the *analysis name*, sanitized into a
    legal identifier. An anonymous `export default` therefore got the
    synthesized key `_default`, while the key that actually binds is
    `default` — copying the draft into `*.nudo.js` left the contract in
    place but **inert**, and `nudo check` stayed green on a call that
    violated it. The key is now the export identity (the same source as
    `nudo contract --emit`), and an unsafe binding name is emitted in the
    alias form `const _nudo_N = …; export { _nudo_N as <identity> };`.
  - The builder `import` and the generated `export const <name>` shared one
    module scope, so a function whose name is a builder name (`number`,
    `lit`, `union`, …) produced `import { number } from "@nudojs/core"` next
    to `export const number = …` — a parse-time `SyntaxError: Identifier
    'number' has already been declared`. The generated file was not valid
    JavaScript, so the "copy the accepted exports into the sidecar" step
    could only produce a broken sidecar. The same collision is fixed in the
    `--from-dts` draft.
  - A rest parameter (`...rest`) was rendered into the constraint DSL
    verbatim (`{ first: number(), ...rest: number() }`), which is neither a
    legal object literal nor legal DSL: copying the draft broke the whole
    sidecar (`nudo:interface-load`), losing every contract in the file.
    Rest-parameter functions are now reported as `not-projectable` and
    skipped, and every draft is assembled once (`execNudoModule`) before it
    is written — a draft that does not load is never handed to the user.
  - The return obligation was derived only from the *observed* call sites,
    which are a subset of the function's real return domain: `opt(flag)`
    returning `1 | null` was drafted as `fn({ flag: boolean() }, number())`,
    so accepting the draft made the function violate its own draft. The
    obligation is now checked against the inferred return domain (the same
    source as the `nudo check` signature) and is not written when it does
    not cover it.
  - `--draft --write` overwrote a hand-edited `*.nudo.draft.js` without a
    word, while the file's own header claims "Handwritten contracts are
    never overwritten". Drafts now carry a content fingerprint; a draft
    whose content no longer matches its fingerprint is kept as-is and the
    command reports that it was not overwritten.
- Updated dependencies [02aa122]
- Updated dependencies [6ec8afc]
- Updated dependencies [7fea13a]
- Updated dependencies [bb8e201]
- Updated dependencies [5c750f2]
- Updated dependencies [e3b8791]
- Updated dependencies [8a5bf7e]
- Updated dependencies [8542f44]
- Updated dependencies [f11510a]
- Updated dependencies [5c750f2]
- Updated dependencies [29d766d]
- Updated dependencies [e3b8791]
- Updated dependencies [e3b8791]
- Updated dependencies [6e5344a]
- Updated dependencies [f896290]
- Updated dependencies [a069994]
- Updated dependencies [7fea13a]
- Updated dependencies [8bf3fd0]
- Updated dependencies [5749924]
- Updated dependencies [0f67015]
- Updated dependencies [2d96c29]
- Updated dependencies [e3b8791]
- Updated dependencies [f6538a2]
- Updated dependencies [e3b8791]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [ec0a9e4]
- Updated dependencies [c325a10]
- Updated dependencies [c325a10]
- Updated dependencies [b37321b]
- Updated dependencies [e2880fd]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [3d79864]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [5dd89ca]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [e2880fd]
- Updated dependencies [5c750f2]
- Updated dependencies [4d1a249]
- Updated dependencies [af09752]
- Updated dependencies [fcaa9e9]
- Updated dependencies [7fea13a]
- Updated dependencies [9ccffb3]
- Updated dependencies [e9fdaa7]
- Updated dependencies [7fea13a]
- Updated dependencies [a1c093f]
- Updated dependencies [9f26414]
- Updated dependencies [67abd92]
- Updated dependencies [3d66f5a]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [b0878e3]
- Updated dependencies [a069994]
- Updated dependencies [493b8c2]
- Updated dependencies [d7ae28a]
- Updated dependencies [edc7590]
- Updated dependencies [5c750f2]
- Updated dependencies [ed4d259]
- Updated dependencies [e20c128]
- Updated dependencies [abff33b]
- Updated dependencies [e3b8791]
- Updated dependencies [5c750f2]
- Updated dependencies [c80456a]
- Updated dependencies [e6c4586]
- Updated dependencies [f87c9f9]
- Updated dependencies [5c750f2]
- Updated dependencies [a3c95a4]
- Updated dependencies [e3b8791]
- Updated dependencies [7fea13a]
- Updated dependencies [d56cbd7]
- Updated dependencies [e5b3f38]
- Updated dependencies [089d4ec]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [02aa122]
- Updated dependencies [f47fd50]
- Updated dependencies [5c750f2]
- Updated dependencies [d2cf3cf]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [fbca6fb]
- Updated dependencies [535adcd]
- Updated dependencies [5c750f2]
- Updated dependencies [535adcd]
- Updated dependencies [e3b8791]
- Updated dependencies [b6abab4]
- Updated dependencies [356172a]
- Updated dependencies [ebe909e]
- Updated dependencies [e3b8791]
- Updated dependencies [a069994]
- Updated dependencies [369a42d]
- Updated dependencies [29d766d]
- Updated dependencies [7fea13a]
- Updated dependencies [56f308e]
- Updated dependencies [5c750f2]
- Updated dependencies [7fd7468]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [ae69b28]
- Updated dependencies [5c750f2]
  - @nudojs/core@1.16.0
  - @nudojs/env@0.5.3
  - @nudojs/parser@1.5.3

## 0.4.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/env@0.5.2
  - @nudojs/parser@1.5.2

## 0.4.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/env@0.5.1
  - @nudojs/parser@1.5.1

## 0.4.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- aae0f96: Fix stale-cache windows in cache keys and session eviction. `nodeHarvestCacheKey`
  floored `mtimeMs` to whole seconds (same-second, same-size rewrites of
  `@types/node` reused a stale harvest — now uses the raw float mtime, matching
  the repo-wide `mtimeMs+size` strict-equality contract). The path-env cache
  key/validation only compared `mtimeMs` (coarse-mtime filesystems could keep
  serving a stale `defineEnv` factory and re-register it, self-perpetuating — now
  `mtimeMs+size`, and the direct-import URL query carries `size` so the ESM
  module cache can't replay old content). The path-env fallback copy filename
  hashed only `path:mtime` — rewritten content now hashes into the filename so a
  changed file gets a new URL and the ESM cache invalidates naturally. Harvest
  caches (`harvestCache`, node not-found cache) had no production eviction —
  `clearAnalysisSessionCaches()` now clears both, so `pnpm install` / watcher
  rounds see upgraded or newly installed `@types` without a process restart.
  `checkMemoKey` now normalizes `filePath` via `stablePathKey` (same file no
  longer occupies two entries under different path shapes).
- 52de5ca: Classify fs "miss" vs "read failure" everywhere. Replaced every
  `existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
  with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
  load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
  site's error channel (top-level catch, `reports.push({error})`, exit-1
  message, or a logged warning) instead of masquerading as "file absent".
  Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
  reasons other than ENOENT print a `warning: cannot read sidecar contract …`
  in `check`/`check --fix` (no more silent contract-blind green runs);
  `@nudo:mock` seed evaluation failures warn in `export` before degrading;
  `pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
  snapshot/read failure no longer disguises the file as "other" and skips
  rollback); mock files that exist but can't be read report `read-failed` with
  the errno instead of the misleading "Mock file not found"; npm entry
  probes and LSP module-candidate stats log persistent failures instead of
  degrading a package's export face to unknown or silently breaking
  go-to-definition; `contract --from-dts` path-like arguments that don't exist
  now error as `path not found` instead of being treated as npm package names
  ending in a misleading `no .d.ts files found`.
- Updated dependencies [aae0f96]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/parser@1.5.0
  - @nudojs/env@0.5.0

## 0.3.28

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/env@0.4.42

## 0.3.27

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/env@0.4.41
  - @nudojs/parser@1.4.23

## 0.3.26

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/env@0.4.40
  - @nudojs/parser@1.4.22

## 0.3.25

### Patch Changes

- Updated dependencies [e4e491f]
- Updated dependencies [1881f97]
- Updated dependencies [1881f97]
- Updated dependencies [8466793]
  - @nudojs/core@1.12.0
  - @nudojs/env@0.4.39
  - @nudojs/parser@1.4.21

## 0.3.24

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/env@0.4.38
  - @nudojs/parser@1.4.20

## 0.3.23

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/env@0.4.37
  - @nudojs/parser@1.4.19

## 0.3.22

### Patch Changes

- Updated dependencies [612d64f]
  - @nudojs/core@1.11.1
  - @nudojs/env@0.4.36
  - @nudojs/parser@1.4.18

## 0.3.21

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/env@0.4.35
  - @nudojs/parser@1.4.17

## 0.3.20

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/env@0.4.34
  - @nudojs/parser@1.4.16

## 0.3.19

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/env@0.4.33
  - @nudojs/parser@1.4.15

## 0.3.18

### Patch Changes

- Updated dependencies [334b914]
- Updated dependencies [94197eb]
- Updated dependencies [b8db17b]
- Updated dependencies [5e275df]
  - @nudojs/core@1.10.0
  - @nudojs/env@0.4.32
  - @nudojs/parser@1.4.14

## 0.3.17

### Patch Changes

- Updated dependencies [2af4016]
- Updated dependencies [2af4016]
  - @nudojs/core@1.9.4
  - @nudojs/env@0.4.31
  - @nudojs/parser@1.4.13

## 0.3.16

### Patch Changes

- Updated dependencies [b6495c6]
- Updated dependencies [04a6d1d]
  - @nudojs/core@1.9.3
  - @nudojs/env@0.4.30
  - @nudojs/parser@1.4.12

## 0.3.15

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/env@0.4.29
  - @nudojs/parser@1.4.11

## 0.3.14

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/env@0.4.28
  - @nudojs/parser@1.4.10

## 0.3.13

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/env@0.4.27
  - @nudojs/parser@1.4.9

## 0.3.12

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0
  - @nudojs/env@0.4.26
  - @nudojs/parser@1.4.8

## 0.3.11

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10
  - @nudojs/env@0.4.25
  - @nudojs/parser@1.4.7

## 0.3.10

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9
  - @nudojs/env@0.4.24
  - @nudojs/parser@1.4.6

## 0.3.9

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/env@0.4.23
  - @nudojs/parser@1.4.5

## 0.3.8

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/env@0.4.22
  - @nudojs/parser@1.4.4

## 0.3.7

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/env@0.4.21
  - @nudojs/parser@1.4.3

## 0.3.6

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/env@0.4.20
  - @nudojs/parser@1.4.2

## 0.3.5

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/env@0.4.19
  - @nudojs/parser@1.4.1

## 0.3.4

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/parser@1.4.0
  - @nudojs/env@0.4.18

## 0.3.3

### Patch Changes

- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2
  - @nudojs/parser@2.0.0
  - @nudojs/env@0.4.17

## 0.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/env@0.4.16
  - @nudojs/parser@1.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/env@0.4.15
  - @nudojs/parser@1.3.1

## 0.3.0

### Minor Changes

- 2f9717b: repo-wide correctness batch (fix-10: 19 fixes + 3 design-defect fixes)

  Security & correctness:
  - type-expression AST whitelist blocks @nudo:case/@nudo:as RCE (P0)
  - unified export/binding-name sanitization (reserved words / collisions)
  - slot & export tables read via own-property, blocking Object.prototype members

  Type system:
  - tuple rest slot effective across leq / widen / runtime / schema / dts
  - x++/x-- propagate term/pred/Φ constraints from the same source as +=/-=
  - key-channel literals distinguish -0/0 (litKeyString)
  - projection/format exits unified under ProjectionBudget: cycle & depth truncation observable

  CLI gates & contracts:
  - health --from path errors fold into pathErrors; ok↔exit single source
  - migrate verify/health pass skips, judged same as nudo check
  - malformed JSDoc directives no longer silently dropped / line-swallowed / host-throwing
  - case-arg recursion depth cap 32 (DoS protection)

  Service layer:
  - cache-limit precedence explicit > env > project; env params take effect per call
  - session LRUs aligned with BoundedLruMap (overwrite refreshes position; max=0 read miss)
  - module-cache entries carry subtree content fingerprints; transitive invalidation cohesive (DESIGN-002)
  - sidecar contract identity = export name, binding name aliasable; reserved-word / string exports emitted safely (DESIGN-003)
  - @nudo:import alias lookup uses the original export name; miss reports a diagnostic

  Parsing & diagnostics:
  - eval diagnostics cover rest / default-value / named-expression declarations and computed-key references
  - ambient sidecar lookup includes .nudo.mjs; suffix set single source of truth

  S2/S5/S6 tracking batch (BUG-017–028):
  - type inference: collectPredVars collects assumeFinite constraints; eqLit channel tagged (eq(x, lit(undefined)) projectable); non-finite bounds (NaN/±Infinity) not projected; fn rest non-array types promoted to (T)[]; optional param names keep `?`
  - gates & CLI: check --fix preserves gate semantics (residual errors exit 1; flag combos are usage errors); variadic flags swallowing positional args → targeted usage error + `--` terminator; export on the PathError face (nudo:path-* + nudo:path-io); findProjectConfig parse-failure diagnostic + stop
  - eval engine: injection-table collection exceptions fail-closed (never a half table); same-name class collision epoch detection + fallback observation; EvalCallRecord.threw required + bridge fail-closed (omitted threw → throwsAbs unknown); tryEvalCall explicit isAbsVal guard
  - LSP / error face: validateText document version gate (stale analysis never published); diagnostic / agent error message absolute-path redaction (home→~, root→.); injection setup failure surfaces and blocks exit
  - observation face: standard-schema missing-key vs explicit-undefined distinction; dts projection optional param names, fn rest TS validity

  PR #80 review batches (merge 7e6051ae):
  - own-property reads across sidecar import/export tables and the modules table; emit-identity dedup; quote-aware sidecar binding scan; check injection-failure gate (no fake-green --json exit, no degraded cache write); class-collision epoch scoped to the entry-call phase; LSP error redaction with real workspace roots; health --from requires explicit paths

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/parser@1.3.0
  - @nudojs/env@0.4.14

## 0.2.19

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0
  - @nudojs/env@0.4.13
  - @nudojs/parser@1.2.1

## 0.2.18

### Patch Changes

- f10066d: fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening
  
  Correctness (core algebra / check):
  - `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
  - bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
  - `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
  - empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
  - projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring
  
  Design refactors (additive public API):
  - `LitValueResult` + bigint in `LiteralValue`
  - `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
  - `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
  - `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity
  
  Product / CLI / migrate:
  - `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
  - migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
  - malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types
  
  Service / cache:
  - disk-cache atomic write + portable path keys (incl. maxForks in cache key)
  - pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing
  
  IDE / extension:
  - LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
  - VS Code client catches start/sendRequest; selectCase rollback
  
  Release / CI supply chain:
  - `gen-llms` confines slug writes under build root (path-escape fix)
  - gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
  - release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions
- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0
  - @nudojs/parser@1.2.0
  - @nudojs/env@0.4.12

## 0.2.17

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/env@0.4.11
  - @nudojs/parser@1.1.9

## 0.2.16

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/env@0.4.10
  - @nudojs/parser@1.1.8

## 0.2.15

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/env@0.4.9
  - @nudojs/parser@1.1.7

## 0.2.14

### Patch Changes

- Updated dependencies [5494f67]
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/env@0.4.8
  - @nudojs/core@1.2.1
  - @nudojs/parser@1.1.6

## 0.2.13

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/env@0.4.7
  - @nudojs/parser@1.1.5

## 0.2.12

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/env@0.4.6
  - @nudojs/parser@1.1.4

## 0.2.11

### Patch Changes

- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/env@0.4.5

## 0.2.10

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2
  - @nudojs/env@0.4.4
  - @nudojs/parser@1.1.2

## 0.2.9

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1
  - @nudojs/env@0.4.3
  - @nudojs/parser@1.1.1

## 1.0.0-beta.1

### Major Changes

- 4305674: Split the `@nudojs/service` god package: harvest → `@nudojs/harvester`, IDE surface → `@nudojs/lsp`, emit products consolidated under `@nudojs/service/emit`.
  
  **BREAKING** for `@nudojs/service` subpath consumers:
  
  | Removed subpath | Migrate to |
  |---|---|
  | `@nudojs/service/interface` | `@nudojs/service/emit` |
  | `@nudojs/service/dts` | `@nudojs/service/emit` |
  | `@nudojs/service/case` | `@nudojs/service/emit` |
  | `@nudojs/service/lsp` | `@nudojs/lsp` (library entry — no server side effects) |
  | `@nudojs/service/harvest` | `@nudojs/harvester` |
  
  `@nudojs/service` keeps `.`, `./analysis`, `./evaluator`, `./emit`. The language server moves to `@nudojs/lsp/server` (bin `nudo-lsp` unchanged); `@nudojs/lsp` is now a side-effect-free library entry re-exporting the IDE surface.
  
  No dependency cycles: `lsp → service`, `harvester` stays independent of `service`. Emit is a service subpath (same package). Public function signatures and diagnostic codes are unchanged.

## 0.2.8-beta.0

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0

## 0.2.7

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/core@2.1.0

## 0.2.6

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1

## 0.2.5

### Patch Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0

## 0.2.4

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1

## 0.2.3

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.2.2

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.2.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.2.0

### Minor Changes

- 5786fa5: Auto-inject `@types` during analysis-path harvest and guard oversized dts work.

  - Analysis can resolve package roots upward and feed harvested Abs into the B module graph.
  - `harvestDts` accepts optional `maxFileBytes` / `maxMs` and skips unreadable or oversized files instead of failing the run.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
