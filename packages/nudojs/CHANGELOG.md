# nudojs

## 1.7.0

### Minor Changes

- f896290: **BREAKING**: 类成员的调用点参数契约补齐**三条保守边界**（与普通函数 / 具名导入
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
- a069994: fix(core,cli): 类成员的参数契约在**导入类实例** / **内联 `new`** / **静态调用**形态下
  不执法（假绿）
  
  `nudo check` 此前只对「本地类实例 + 同类文件里的 `const c = new C(); c.m(…)`」做
  调用点契约执法。以下形态解析不出被调方 ⇒ 整条调用被跳过 ⇒ 违约代码判绿：
  
  - 导入类：`const c = new K(); c.m(-1)`（`import { K } from "./lib.js"`）
  - 内联构造：`new K().m(-1)`（导入 / 本地都）
  - 静态方法：`K.s(-1)`（导入 / 本地都）
  
  修法：类成员的调用点解析改由**类声明 AST 的 own 成员事实**驱动 —— 实例 / 静态分开
  判定，`K.static.s` 沿用静态 / 实例同名时的既有 scope 名（`@nudo:contract` 侧）。
  本地类仍以 `nudo check` 的签名普查面为闸门（未导出的类保持零诊断、不扩面）；导入类
  按定义模块 + 定义文件侧车绑定契约（`K_m` / `K.s` 等同既有侧车键）。
  
  **BREAKING**: `nudo check` 现在会对上述形态**新报** `nudo:constraint-violated`
  （及调用点前置条件违例）⇒ 此前依赖这些调用点静默的 CI 流水线会开始**非零退出**。
  这些调用点本来就是 L1 义务的覆盖空洞：同一份契约在 `c.m(…)` 上执法、在
  `new K().m(…)` 上放行，属于同一义务的两套口径。
  
  **谁不会坏（守卫，全部保持零新诊断）**：继承而来（非 own）的方法；构造器
  `this.m = …` 或同名类字段覆盖的方法；getter / setter / computed 成员名；
  静态 / 实例交叉调用（`K.m` 调实例方法、`new K().s` 调静态方法）；接收者被形参 /
  局部声明遮蔽或被重新赋值；未声明契约的方法。
- 97f28ed: **BREAKING**: 产物面（dts / zod / standard / case）的**形参位形状**变了 ——
  数组解构形参现在按**元素下标**聚合成**元组**，TS 的 `this: T` 接收者标注不再
  被当成形参。
  
  谁会坏：消费方 `import` 生成产物并按**旧形状**调用的代码 ——
  
  - 数组解构形参（`fn({ a: number() })` 对 `[a, b]`）：dts 面此前给
    `{ a: number }`、zod 面给 `z.object({ a: … })`（与真实形参形态**颠倒**），
    现在给**元组**（`[ a, b ]` / `z.tuple([…])`）⇒ 旧形状的调用点类型不兼容；
  - `this: T` 接收者标注：dts 多一个形参（消费方吃 `TS2554` 假红）、zod 多一个
    字面量槽 `"this"`、standard 多一个幽灵导出 `<fn>_this` ⇒ 这些**幽灵位**现在
    全部消失。
  
  怎么迁移：重新生成产物；数组解构形参按**数组**传参；消费方若引用过
  `<fn>_this` 之类幽灵导出，直接删掉（它们本就不存在）。
  
  fix(service, nudojs): 期望判定严格化、数组解构的产物面按元素下标寻址、`--assume` 的界落到形参前提、`this` 接收者标注不进形参表
  
  - Bug 396（`@nudo:case` 期望判定）：`leqAbs` 的「同 prim 字面量视为可赋」捷径在
    **对象槽**位上连字面量相等性都不比 ⇒ `shape({ a: lit(2) })` 这类期望**永不被
    执法**（case 期望恒 `[ok]`、`nudo:case-expected` 零诊断 ⇒ 假绿），而同一份
    契约在手写侧车面走逐字段约束树能抓到 ⇒ 两面自相矛盾。`caseExpectedSatisfied`
    补一道「期望槽里的字面量按值比较」（含嵌套对象槽），**只**作用于期望判定，
    `leqAbs` 的既有语义一字不动（core 侧那一行不改 —— gold 的 `assign-compatible` /
    `wider` 依赖该口径）。
  - Bug 394（产物面）：**数组解构**形参的字段级侧车契约（`fn({ a: number() })` 对
    `[a, b]` 来说 `a` 是**下标 0 的元素**，不是属性键）此前被摊成**对象槽** ⇒
    dts 给 `{ a: number }`、zod 给 `z.object({ a: … })` ⇒ 产物输入面与真实形参形态
    **完全颠倒**（合法数组调用被判红、非法对象调用被放行）。现在 dts / zod /
    standard 三面都按**元素下标**聚合成**元组**（未契约的元素位留 `any`——无约束，
    不是 unknown），dts 的声明名渲染成数组形态 `[ a, b ]`。
  - Bug 397（产物半）：TS 的 `this: T` 是**接收者标注**、不是运行时形参 ——
    service 侧形参表入口 `extractFormals` 现在**兜底**过滤它并**重排 index**
    （index 是形参表内的位置 ⇒ 实参位靠它对齐）⇒ dts / zod / standard / case
    四个产物面不再多出一槽（dts 多一个形参 ⇒ 消费方吃 TS2554 假红；zod 多一个字面量
    槽 `"this"` ⇒ 对每一个真实调用值报假红；standard 多一个幽灵导出 `<fn>_this`）。
  - Bug 976（CLI 半）：`--assume` 声明的**界**此前被顶成写死的 `x>0` ⇒ 用户写
    `--assume 'x>-5'` 时观察面只给 `"pos"`（`x=-1` 的分支被当成不可达 ⇒ 说谎）。
    现在把**用户声明的界**（按形参名归并、同一形参多条取合取）落进形参自己的前提
    （**替换**写死的默认，不是与它合取），并与 core 半
    （`buildArgsFromAssume` 的 `bounds` 形参）同批接线；契约的义务与用户的界并存
    （契约 pred ∧ 用户界）⇒ 契约不被削弱、用户的界也不被顶掉。
- b0878e3: **BREAKING**: `nudo export` 的产物面（zod / standard / dts / guard）**参数位与返回位
  的形状变了** —— 槽位表改以**声明形参表**为骨架，与 `nudo check` 的签名面合流。
  
  谁会坏：直接 `import { <fn>Input } from "*.nudo.zod"`（或 guard / standard 产物）
  并按**旧形状**调用的消费方 —— 生成的 `.d.ts` 与 zod / standard 输入对象现在按
  **真实调用形态**渲染（剩余参数 `...rest` 是一个**数组**槽、点路径契约键展开成
  **嵌套形状**、声明级默认值让槽位**可选**），旧形状与新形状不兼容 ⇒ 消费方的
  `tsc --noEmit` 会红。
  
  怎么迁移：重新生成产物（`nudo export --format all --out …`）并按新形状改消费方
  调用点 —— 剩余参数按**数组**传、点路径契约按**嵌套对象**传、有默认值的形参现在
  是**可选**位。
  
  `nudo export` 的参数面与返回面改按**声明形参表**合流：契约面与观测面不再二选一，
  剩余参数 / 默认形参 / 点路径契约 / async 返回 / 违约返回都按真实调用形态投影。
  
  - **剩余参数**（`...rest`）此前被拆成「`...rest` 一个槽 + 凭空造出来的 `argN`
    槽」，槽值是单个实参（Bug 604）。现在槽位表以声明形参表为骨架：槽名取裸名
    （`rest`）、槽值是**数组**、槽数取声明形参个数。
  - **部分契约**（契约只覆盖部分形参）时，未被覆盖的形参位此前被**静默丢掉**
    （Bug 605）——契约面与观测面二选一。现在两者按形参合流：契约覆盖的位取契约
    Abs，未覆盖的位取声明形参表 + 观测证据（不丢位），与 dts 面同口径。
  - **声明级默认值**此前不参与槽位可选性，带默认值的形参被渲染成必填槽
    （Bug 611）——dts 面是 `b?: number`、zod 面是必填，两个产物面自相矛盾。现在
    可选性按三来源口径（契约级 → 声明级默认值 → 观测级最短元数）产出，与 dts 面
    逐位同。
  - **有参数契约、无返回契约**时，返回面此前回退到**无约束**的入口观测（缺种子
    重算），与 dts / check 面矛盾（Bug 612）。现在先用契约参数作种子重算一次
    返回位（与 dts / check 面同一条路径），重算失败才回落观测面。
  - **async 函数的返回约束**此前被当成整个返回类型，`Promise<…>` 包装丢失
    （Bug 618）。现在契约返回描述的是 await 后的值，返回面保留 promise 包装。
  - **`@nudo:skip` + 多条 case 见证**时 Output 面此前不产出（兜底只取第 0 条断言
    见证，而无断言的 case 是见证不是断言），参数面却 join 了全部见证——同一函数
    两套口径（Bug 619）。现在返回面兜底 join 全部域证据见证。
  - **点路径契约键**（`"card.grade"`）此前被当成字面量顶层属性名，约束也被当成
    整个形参的约束（Bug 620）。现在契约参数按声明形参表定位，点路径展开成嵌套
    形状（`{ card: { grade: … } }`），与 dts 面的嵌套形状一致。
  - **返回契约**此前当「已证成的事实」直接投影，产物可能声明一个实现可被证否的
    返回类型（Bug 626）。现在投影前复核实现：违约时不投影契约，回落实现实际的
    返回形态。
  
  产物面（zod / standard / dts / guard）因此与 `nudo check` 的签名面口径一致：
  同一份源码在两面给出的参数位与返回位不再互相矛盾。
- b0878e3: **BREAKING**: `nudo export` 的四个产物面现在共用**同一条导出面规则** ——
  未导出的内部实现**不再**发布运行时守卫（guard 面），zod / standard / dts 三面
  此前投影**每一个**函数（含内部实现），现在只投影**模块的公开导出面**。
  
  谁会坏：直接 `import { is<fn>Output } from "*.nudo.guard"` 的消费方 —— 未导出
  （内部实现）的函数此前**有**守卫导出，现在**没有**了 ⇒ 消费方的
  `tsc --noEmit` 会红；guard 的**返回域**也改成与 zod / standard / dts 同一条
  （此前 guard 用单次调用的**观测**返回，与契约域矛盾）。
  
  怎么迁移：重新生成产物；只对**公开导出**的函数使用 guard 导出（内部实现不再有
  守卫 —— 这是「一个导出一个出口域」的统一口径）。
  
  `nudo export` now publishes one exit domain across its product faces, and a
  parameter named `__proto__` no longer disappears from the zod artifact.
  
  - The guard face (`--format guard`) took the **observed** return value of a
    single call site, so a function with a declared return contract published a
    guard that rejected every value the contract allows (`return data === 0.5;`
    for a contract of "number between 0 and 1"), while the zod face of the very
    same run published the contract domain. The guard now consumes the same
    unified return face as the zod / Standard Schema / dts faces, so one export
    gives one exit domain. A contract the implementation violates is still
    projected as the implementation actually behaves — in every face.
  - The zod input object was assembled into an ordinary object, so a parameter
    named `__proto__` was swallowed by the inherited prototype setter and never
    became an own key: the artifact published `<fn>Input` without that
    parameter, while the `.d.ts` of the same run kept it. The slot table is now
    assembled without a prototype, so the parameter is no longer lost while the
    artifact is assembled (the other inherited key names are kept as well).
  - The guard face now inherits the shared export-surface rule: a function that
    is not exported no longer publishes a runtime guard.
- b0878e3: **BREAKING**: `nudo export` 的四个产物面现在共用**同一条导出面规则**，且**硬失败**
  不再静默发布产物。
  
  - 四个产物面只投影**模块的公开导出面**（此前 zod / standard / guard 投影**每一个**
    函数，含内部实现）⇒ 未导出的内部实现**不再**有 `<fn>Input` / `is<fn>Output`
    之类的导出 ⇒ 直接 import 这些导出的消费方 `tsc --noEmit` 会红。
  - `@nudo:skip` 的函数此前被导出面过滤器**排除**（它按设计没有 case 见证）⇒ 从不
    出现在任何产物面；现在它**照常投影** ⇒ 产物多出此前没有的导出。
  
  谁会坏：按「产物里有某个函数」做**存在性**判断的消费方（内部实现不再有守卫 /
  zod 校验器）；以及期待 `@nudo:skip` 的函数**不出现**在产物里的脚本。
  
  怎么迁移：重新生成产物并只依赖**公开导出面**上的导出；`@nudo:skip` 现在会出现在
  产物里（它只跳过 case 见证，不跳过投影）。
  
  `nudo export` now refuses to publish a projection that contradicts the
  contract, keeps the four product faces on one public-surface rule, and stops
  dropping `@nudo:skip` functions.
  
  - A sidecar (`*.nudo.js`) that failed to load was silently ignored: the
    contract was lost, and the artifacts published the "not declared" case as
    "no constraint" (zod `z.unknown()`) — no message on stderr, exit 0.
    `nudo export` now reports the real `nudo:interface-load` diagnostic and
    exits 1 without publishing anything.
  - A contract parameter name that is not in the declared parameter list was
    projected as-is, so the zod face published an `<fn>Input` whose key the
    function signature does not have. `nudo export` now reports
    `nudo:interface-param-mismatch` and exits 1 without publishing anything.
  - A contract whose conjunction is unsatisfiable (the source
    `@nudo:contract` contradicts the same-name sidecar) was projected with only
    half of the contract, producing a validator that can never pass.
    `nudo export` now reports `nudo:interface-conflict` and exits 1 without
    publishing anything.
  - The dts face projected the module's **public surface** (export / export
    default / CJS exports), while the zod / Standard Schema / guard faces
    projected **every** function — internal implementations included. A module
    with no exports at all still produced three runtime validators while its
    `.d.ts` was silently missing. All four faces now share one export-surface
    rule, and a module with no public surface says so instead of producing
    nothing without a word.
  - `@nudo:skip` functions were excluded from the export entry filter (they
    have no case witness by design), so they never reached any product face.
    They are now projected like any other exported function.
- b0878e3: **BREAKING**: `nudo export --out` 的**产物文件名**变了，且**不再覆盖**不是自己
  生成的产物。
  
  - 产物名冲突时现在带**模块键后缀**（`lib.323a7411.d.ts` / `C.m.nudo.standard.ts` /
    `C.m.2.nudo.standard.ts`）⇒ 此前 `a/lib.js` 与 `b/lib.js` 会**互相覆盖**
    （后者静默盖掉前者）⇒ 消费方按**固定文件名**取产物的流水线现在会找不到文件。
  - `--out` 现在**拒绝覆盖**它没生成过的文件（exit 1 + `nudo:path-io`）⇒ 此前
    手写的 `.d.ts` 会被**静默替换**成 `unknown`；现在构建会以非零码退出。
  
  谁会坏：按**固定文件名**消费 `nudo export --out` 产物的脚本（文件名现在带模块键
  后缀 / 方法名）；以及依赖「`--out` 会覆盖输出目录里的同名文件」的流水线（现在
  拒绝并 exit 1）。
  
  怎么迁移：改用产物里的 `// nudo-export-module:` marker 行定位产物（它记录产物
  属于哪个模块），而不是硬编码文件名；确保输出目录里没有会被覆盖的同名文件
  （或先清空输出目录）。产物内的 `// nudo-export-module:` marker 用于区分
  「同模块更新」与「另一个模块的同名产物」。
  
  `nudo export --out` no longer loses artifacts silently: product names are
  unique per module, hand-written files are never overwritten, and a failed
  write reports what actually landed.
  
  - Two modules could map to the same artifact path. The Standard Schema face
    names its file after the **function** (so two modules exporting a function
    of the same name collided), while the dts / zod / guard faces name theirs
    after the source file **stem** (so `a/lib.js` and `b/lib.js` collided). The
    second export silently overwrote the first one, and the consumer ended up
    with another module's declarations. A product name that is already taken
    by a different module now gets a module-key suffix
    (`lib.323a7411.d.ts`), so both modules keep their artifact.
  - Two functions with the same name in one module (two `m` methods of a class)
    were written to the same Standard Schema file — the second write overwrote
    the first. Each function now gets its own file
    (`C.m.nudo.standard.ts`, `C.m.2.nudo.standard.ts`).
  - A hand-written `.d.ts` in the output directory was overwritten without a
    word, replacing precise types with `unknown`. `nudo export` now refuses to
    overwrite a file it did not generate (exit 1, `nudo:path-io` diagnostic) and
    leaves the file untouched.
  - When a write failed, the artifacts that had already been written were
    dropped from the output: stdout showed no `wrote` line at all while the
    files were on disk. The written list is now replayed, and the error names
    the file that failed instead of only the directory.
  - The `fix:` hint for a failed `--out` pointed at `nudo check --out`, an
    option that does not exist (`error: unknown option '--out'`). It now points
    at `nudo export --out` and says what to do.
  
  Artifacts written with `--out` carry a `// nudo-export-module:` marker line
  that records which module they belong to; it is used to tell "same module,
  updated" from "another module with the same name".
- b0878e3: **BREAKING**: `nudo export --format all`（stdout）的**导出名**变了 —— 同一模块
  作用域内同名导出现在被**改名**而不是撞名报错。
  
  - zod 面与 standard 面都叫 `<fn>Input` / `<fn>Output` ⇒ `--format all` 的 stdout
    此前撞名（`TS2451`）；现在**后一个**面改名（`<fn>OutputStandard`）⇒ 消费方
    `import { <fn>Output } from "…"` 现在拿到的是 **zod 面**的那个名字，standard 面
    的同名导出**改名** ⇒ 直接按旧名 import 的消费方 `tsc --noEmit` 会红。
  
  谁会坏：`nudo export --format all > out.ts` 后按名 import `<fn>Output` / `<fn>Input`
  的消费方（standard 面的同名导出现在带 `Standard` 后缀）；以及期待 `--format all`
  stdout **撞名报错**的脚本（现在能出文件了）。
  
  怎么迁移：重新生成产物并按新名 import（zod 面保持 `<fn>Output` / `<fn>Input`，
  standard 面在 `--format all` 合并流里是 `<fn>OutputStandard`）；或分开导出
  （`--format zod` 与 `--format standard` 各自成文件 ⇒ 名字不冲突）。
  
  `nudo export` to stdout now produces one usable module: the Standard Schema
  helper is declared once, the four dialects no longer collide on export names,
  and the dropped-preds ledger names the face it came from.
  
  - `--format standard` to stdout repeated the whole `__nudoCheck` helper for
    every exported function, because each per-function module carries its own
    copy and the chunks were concatenated as they were. The shared prelude
    (banner + helper) is now emitted once, so the artifact no longer fails to
    compile with `TS2393` / `TS2300`.
  - `--format all` to stdout put the zod and the Standard Schema face into the
    same module scope. Both name the same validator `<fn>Input` / `<fn>Output`,
    so the artifact failed with `TS2451`. A top-level name may now be declared
    only once per stream: the first face keeps the product name and a later
    face that would repeat it is renamed (`<fn>OutputStandard`).
  - The `dropped preds` ledger was always titled "not projected into zod" even
    when the run produced no zod artifact at all (`--format standard`) and its
    entries come from the Standard Schema face. The title now names the face
    the entries come from, and `--format all` shows one zod ledger and one
    Standard Schema ledger instead of the same title twice.
  
  Artifacts written with `--out` are unchanged: each dialect keeps its own file
  and its own product names.
- b0878e3: **BREAKING**: standard 面的返回面导出名**恒为** `<fn>Output`（此前「有返回契约时」
  叫 `<fn>Return`）—— 这条改名随 CLI 到达消费方。
  
  谁会坏：`nudo export --format standard` 之后 `import { <fn>Return } from
  "*.nudo.standard"` 的消费方 ⇒ 旧名 import 断（消费方 `tsc --noEmit` 会红）。
  
  怎么迁移：改 import 名为 `<fn>Output` 并重新生成产物；文档与
  `scripts/verify-doc-examples.sh` 的 pin 已同步。
  
  `nudo export` 的六片并发修复收口：主 agent 接线把「命名规则分叉」「同名条目折叠」
  「契约可选性丢失」「模块身份靠猜」四处跨片缺口补上。
  
  - **命名规则的唯一产地**（Bug 602 / 603 / 609 / 622）：`export/stdout.ts` 原先
    自带一份 `DIALECT_SUFFIX` + `uniqueSegmentName`，`export/io.ts` 又造了一份 ⇒
    「stdout 改名规则」与「落盘改名规则」可能分叉。删掉 stdout 侧的本地副本，
    改为 import `io.ts` 的实现（同一 `ArtifactDialect` 口径）。
  - **同名条目不再折叠**（Bug 623）：zod 导出表原是**普通对象** ⇒ 同一个类里两个
    同名方法（`C.m` 出现两次）时后者覆盖前者 ⇒ zod 产物只剩 1 个 `C_mInput`，
    另一个方法的证据凭空消失。导出表改无原型对象 + **键侧去重**
    （`C_mInput` / `C_mInput_2`）⇒ 两份都在；guard 面同步接上
    `generateGuardFunctionFromAbs` 的**去重集合** ⇒ 同一份产物里不再出现两个
    同名 `export function`（此前是 TS2393 重复声明）。
  - **standard 面的可选性透传**（Bug 627）：参数面的 `optional` 没传给 service ⇒
    契约允许 `undefined` 的形参在 standard 面被当必填 ⇒ 消费方判非法。
  - **模块身份不再靠猜**（Bug 609 / 622）：`--out` 写盘时把**源文件路径**作为
    `moduleKey` 传给写盘层 ⇒ 模块身份从「stem + 导出签名」升级为路径 ⇒ 同 stem
    **且**导出名集合也相同的两个模块不再被判成同一模块（后者覆盖前者），且
    改名后重导不会换唯一名、留下陈旧副本。
  - **614 的破坏性重命名连带面同步**：standard 面返回面导出名**恒为 `<fn>Output`**
    ⇒ `scripts/verify-doc-examples.sh` 的 pin 与中英文档
    `guides/export-ecosystem.md` 同步（否则 `verify:docs` 红）。
- e5b3f38: `nudo migrate status --json` 的机器面新增了**可选字段** `packageJsonError`
  （畸形 `package.json` 的解析失败原因）⇒ 新增可选字段属**增量**变更（additive）
  ⇒ minor。
  
  `nudo migrate status` now reports the truth about a package: the nudo gate
  is detected from the **command text**, the dependency scope covers
  `peerDependencies`, `.ts` counts stop at workspace package boundaries, a
  `tsc` script blocks even when no `.ts` file is left, a broken
  `package.json` is reported instead of being read as "empty", and the
  `blockers` list no longer carries the `—` placeholder (the JSON face
  reports `[]`).
  
  - The "no nudo check/test script yet" blocker matched the **script name**
    (`/check|test/`) while the scripts it looked at were collected by
    **command text**. A package already running `nudo check .` under a name
    like `lint` or `typecheck2` was reported as having no gate — and the
    blocker never went away after `migrate retire`, which rewrites the script
    to `npx nudojs check .` (a form the old `/\bnudo\b/` pattern did not even
    match). The gate is now detected from the command text
    (`nudo check` / `nudo test` / `npx nudojs check`).
  - The dependency scope merged only `dependencies` and `devDependencies`,
    so a package carrying `typescript` in `peerDependencies` was reported as
    `typescript dep: no` with no "typescript still in dependencies" blocker,
    while `migrate retire` on that same package did remove the dependency.
    All four dependency fields are now merged by one shared helper.
  - `tsFiles` / `tsxFiles` were counted by a plain directory walk, so the
    root row of a workspace repeated every nested package's sources. Each
    row now counts only the files of its own package.
  - The "tsc still in scripts" blocker was gated on `tsFiles > 0`, so a
    package with a `tsc` script and no TypeScript source left — exactly the
    case worth retiring — reported no blocker at all.
  - A `package.json` with a JSON syntax error was silently read as "no
    dependencies, no scripts", which `nudo check` contradicts. `migrate
    status` now reports the parse failure (in `blockers` and in the new
    `packageJsonError` field of the JSON face).
  - The `—` placeholder for "no blocker" leaked into the `blockers` string
    (`1 tsc line(s) in .github/workflows; —`) and into the JSON `blockers`
    array, where a machine consumer counted it as one more blocker. The
    placeholder is gone: no blockers means no entry, and the JSON face
    reports `[]`.
  - A `scripts` entry whose value is `null` is valid JSON (npm reads it as
    "no command") but crashed `migrate status` with a bare
    `Cannot read properties of null (reading 'split')`. Non-string script
    values are now treated as "no command".
- 697c5e1: **BREAKING**: `nudo check` 的**同 stem 选源规则**变了 —— 同名 `.js` 产物现在
  **胜出**于同名 `.ts` 源 ⇒ 源不再被门禁覆盖（此前门禁查的是源）。
  
  谁会坏：仓库里**同时**提交了 `foo.ts` 与编译产物 `foo.js`（且该 `.js` **不是**
  `nudo migrate strip` 产物）的工程 —— 门禁现在分析 `foo.js`，`foo.ts` **不再**被
  分析 ⇒ 只写在 `.ts` 里的契约 / 指令**不再**被门禁看到（覆盖静默丢失）；分析对象
  也换了 ⇒ 诊断集合可能变化。
  
  怎么迁移：让 `foo.js` 与 `foo.ts` **同源**（用 `nudo migrate strip` 的产物，或
  删掉其中一个）；本版本**尚未**落产物清单（marker）来区分「strip 产物」与「同名
  的另一个模块」，因此同名 `.ts` / `.js` 并存的工程需要自己消歧。
  
  fix(nudojs): `migrate strip --write` 的产物 `.js` 不再被 `nudo check` 跳过（发布物零覆盖 ⇒ 假绿）
  
  **现象**：`nudo migrate strip --write` **默认保留源 `.ts`** ⇒ 迁移过渡期
  （strip → retire 之间）目录里 `.ts` 与 `.js` **并存**是常态 ⇒ `nudo check`
  （= `migrate retire` 装到 CI 上的门禁）**跳过同 stem 的产物 `.js`** ⇒
  **真正发布出去的产物零覆盖**（假绿）；且与 `migrate verify` 对同一包给出
  **相反结论**（verify 红 / check 绿）。
  
  **根因**：目录扫描的「同 stem 只分析一份」规则把「取哪一份」**硬编码成
  `.ts`**（迁移**前**的事实源：带类型标注 ⇒ 推断更准）⇒ 迁移过渡期恰好取
  **错**的那一份。
  
  **修法**（`packages/nudojs/src/commands/shared.ts` · `collectNudoFiles`）：
  同 stem 冲突时**产物（发布物）胜出** —— 同目录存在同名产物 ⇒ 源被产物取代 ⇒
  门禁查**要发布的东西**；源单独存在时照旧分析源。
  
  - **不变式保持**：一个模块 ⇒ **一次**分析（源被压掉，不是两份都分析）⇒
    `summary.errors` / `functions` / `files` 不翻倍。
  - **契约不丢**：strip 保留注释 ⇒ `@nudo:contract` / `/// @nudo:import` 在产物里
    仍然生效 ⇒ 产物侧的契约面与源侧同强度。
  
  **行为变更（请注意）**：
  
  1. 同 stem 的 `.js` 若**不是** strip 产物（例如手写的旧模块、或被提交进仓库的
     编译输出），现在被分析的是 `.js` 而不是 `.ts` ⇒ 源不再被门禁覆盖。要区分
     「产物」与「同名的另一个模块」需要 strip 落一份产物清单（marker），本次未做。
  2. `.mts` / `.cts` 源（它们**本身不是**分析目标）的产物 `.mjs` / `.js` 现在
     **会被分析**；改前这类产物被「同名源存在 ⇒ 跳过」规则连坐 ⇒ 该模块被分析
     **0 次**（零覆盖）⇒ 现在补上。
- e5b3f38: **BREAKING**: `nudo migrate retire --all --json` 的**顶层 JSON 形状**现在**恒为
  数组**（此前随结果条数变化：1 个包 = 对象，≥2 个包 = 数组）。
  
  谁会坏：解析 `nudo migrate retire --all --json` stdout 的机器消费方 ——
  单包时顶层从 `{ … }` 变成 `[ { … } ]` ⇒ `payload.removedDeps` 之类变成
  `undefined`。
  
  怎么迁移：消费方改按数组遍历（`const rows = Array.isArray(p) ? p : [p]` 之类的
  兼容读法，或直接改读数组）。
  
  族 16 收口接线：把各分片「越界发现」里明确交给**命令层**
  （`packages/nudojs/src/commands/migrate.ts`）的接线项补齐 —— migrate 的
  四个子命令此前在命令层与库面**口径分裂**。
  
  **Bug 668** — `migrate status` 只把 `targets[0]` 交给 `migrateStatus` ⇒
  `nudo migrate status pkg-a pkg-b` 只报 pkg-a、无警告、exit 0（迁移审计场景下
  这是危险的静默截断）。改为**全量审计**（按包根去重）。
  
  **Bug 595** — `migrate retire <a> <b>` 只退役 `a`，`b` 静默跳过。改用库面的
  多目标入口 `migrateRetireMany`（**全退役或全报错**，任一失败 ⇒ 整批零写盘）。
  
  **Bug 675** — `migrate retire --all --json` 的顶层 JSON 形状**随结果条数变化**
  （1 个包 = 对象，≥2 个包 = 数组）⇒ 机器可读契约不稳定。改为**恒为数组**，
  与 `migrate status --json` / `migrate strip --json` 一致。
  
  **Bug 1006** — `migrate retire --all` 失败时 **stdout 为空** ⇒ `--json` 契约
  下 stdout 不是合法 JSON。改为失败时 stdout 也给出**合法 JSON 信封**
  （`{ok:false, action, targets, error}`），人类面引导仍走 stderr。
  
  **Bug 567 / 586** — 「无可退役」被当成**错误**（库面抛错 ⇒ CLI exit 1）⇒ 用户
  跑一次正常退役却看到红色。改为「无可退役」是**正常结果**（exit 0 + 明确提示）；
  编译器角色的脚本被原样保留时，CLI **打印**该脚本与保留原因（否则看起来像漏改）。
  
  **Bug 588（retire 侧）** — 畸形 `package.json` 被 `readJson` 的「解析失败 =
  不存在」压成同一个 `undefined` ⇒ 谎报「no package.json under X」（与 `nudo check`
  面的「package.json parse failed」不同口径）。改用详细读取并 **fail-closed**；
  `retire --all` 侧同样不再**静默跳过**畸形清单。
  
  **Bug 586（判据收口）** — 「这个脚本是不是编译脚本」的判据必须是「**它会不会真的
  产出产物**」，而不是「命令行里出现了 `-p`」或「脚本名叫 build」：
  - `tsc -p tsconfig.build.json`（带 `outDir` + `declaration`）⇒ **真会 emit**
    ⇒ 编译器角色 ⇒ 原样保留（**报告 586 要的就是这个**）；
  - `tsc -p .` 而 tsconfig 里 `compilerOptions.noEmit: true` ⇒ **不产出任何产物**
    ⇒ 它其实是**类型门禁** ⇒ 改写成 `nudo check` 且 typescript 依赖**可摘**
    （仓内公开样板 `docs/examples/migrate/before` 正是这一形状 —— 旧判定会让
    「退役 tsc」的故事落空：依赖摘不掉）。
  判定会读 tsconfig（含 `extends` 链）与 JSONC 注释；**读不到配置 ⇒ 保守按
  「会 emit」处理**（不得猜着改写）。
- 169ed52: check 面新增了此前**不存在**的诊断码（`nudo:json-invalid` 等）⇒ 机器面新增
  可观测的诊断码属**增量**变更（additive）⇒ minor。
  
  `nudo check` now reports the diagnostics it used to swallow: module-loading
  problems and env-harvest conflicts reach the check face instead of being
  dropped.
  
  - A dependency that could not be found, or that did not provide the requested
    export, was diagnosed by the analyzer but never surfaced, so the gate stayed
    green on a program that could not even be loaded. Module-loading problems
    are now visible on the check face (`nudo:module-missing`, `nudo:missing-export`
    as errors; `nudo:module-cycle`, `nudo:module-depth`, `nudo:json-invalid`,
    `nudo:exports-unresolved` as warnings).
  - The same finding was reported twice when it arrived through both the mock
    channel and the module-graph channel; the duplicates are now collapsed.
  - A handwritten `@nudo:env` that wins over the harvested environment was
    invisible on the check face although the documentation lists it as a check
    warning. It is now reported as `nudo:env-harvest-conflict` (warning, so it
    does not block the gate).
  - `--from` now also sees call sites that live inside a function body: the
    call-site files are scanned statically as well, so a violation that was
    visible when the caller was checked alone is reported when the callee is
    checked with `--from`.
- 02aa122: **BREAKING**: `nudo contract --json` 的**顶层载荷形状**从「一个对象」变成
  「**单元素数组**」（目录形态此前是 N 份 JSON 首尾相接 ⇒ `JSON.parse` 直接抛）。
  
  谁会坏：解析 `nudo contract --json` stdout 的机器消费方 —— 单文件形态的顶层
  从 `{ file, entries[], draftPath, … }` 变成 `[{ file, entries[], draftPath, … }]`
  ⇒ `payload.file` / `payload.entries` 变成 `undefined`；元素内部的键
  （`file` / `entries[].fn` / `entries[].signature` / `draftPath` / `draftSource` /
  `diff`）**未变**。
  
  怎么迁移：消费方改读 `docs[0]`（并按数组遍历，别再假设「单文件 = 单对象」）。
  
  fix(nudojs): `nudo contract` 的 `--json` 机器面（跨文件聚合 + 失败可读）+ `--from-dts` 的用法校验顺序
  
  族 20 · 片 A（658 / 659 / 661 / 664）。
  
  - **Bug 658 —— `contract --json` 的 stdout 必须是**一份** JSON（跨文件聚合层）**。
    改前 JSON 出口是**单文档**（每个 root 一次 `console.log`），而命令层对每个 root
    各跑一次 ⇒ 目录形态的 stdout 是 **N 份 JSON 首尾相接**，`JSON.parse` 抛
    `Unexpected non-whitespace character after JSON`。现在命令层加**跨文件聚合层**：
    收集所有 root 的机器文档后**一次**打印；**单文件也走同一路径** ⇒ 形态恒定。
    ⚠ **破坏性变更**：单文件载荷的**顶层形状**从「一个对象」变成「**单元素数组**」
    （元素内部的键 `file` / `entries[].fn` / `entries[].signature` /
    `draftPath` / `draftSource` / `diff` **未变**）。消费方请改读 `docs[0]`。
    同一修法覆盖 **print 分支**（`contract --json <目录>` 改前同样是多份拼接）。
  - **Bug 659 —— `--from-dts` 不再绕过全部用法校验**。改前 `--from-dts` 在**所有
    校验之前**短路 ⇒ `--emit` / `--draft` / `--json` 被静默吞掉
    （`--from-dts --emit --draft` 不报互斥、exit 0；`--from-dts --json` 的 stdout
    是 draft 文本、不是 JSON）。现在 `--from-dts` 与其它模式共用同一套
    「先校验、后分派」的顺序：`--emit`/`--draft` 互斥、`--write` 需要草稿模式、
    `--exit-on-diff` 需要 `--emit --dry-run` 都对 `--from-dts` 生效；
    `--json` 与 `--from-dts` **显式互斥**（`--from-dts` 没有机器可读载荷 ⇒
    显式拒绝，不许「给了不生效且不报错」）。
    ⚠ `--write` + `--from-dts` 仍是**合法**组合（help 与 CLI Reference 的口径都是
    「With `--draft` / `--from-dts`」）⇒ 校验按模式判定，不误伤。
  - **Bug 661 —— `--json` 形态下路径错误必须进 JSON body**。改前 `--json` 把
    `reportPathErrors`（stderr 面）整段跳过，而 `pathErrors` 只接进 draft 分支 ⇒
    print / emit 形态下「置红的那个原因」既不在 stdout 也不在 stderr，**exit 1
    没有任何理由**。现在路径错误进聚合信封的 `pathErrors[]`
    （print / emit / draft **三形态统一**），exit 仍为 1。
  - **Bug 664 —— 失败的 root 也必须进 `--json` 载荷**。改前 per-root `catch` 只产
    人类文本：单文件形态 stdout **0 字节** + exit 1（违反「绝不空 stdout + 非零
    exit」不变量）；目录形态 stdout 是一份**只含好文件**的合法 JSON，失败文件
    **彻底消失**。现在失败 root 进聚合结果的 `errors[]`
    （`code: nudo:contract-analysis-failed`）⇒ stdout 永不为空、载荷不缺项。
  - 顺带：`--json` 形态下的**用法错误**也落一份机器可读信封
    （`pathErrors[{code:"nudo:usage-error"}]` + exit 1），口径与 `nudo check --json`
    的用法错误信封同款（`--json` 下 stdout 永不为空）。
- 02aa122: **BREAKING**: `nudo contract --from-dts --write` 的**草稿落盘位置**变了
  （Bug 944）—— 此前写在**当前工作目录**，现在写在**源 `.d.ts` 旁边**。
  
  谁会坏：跑 `nudo contract --from-dts --write` 后在**当前目录**读草稿的脚本
  （例如 `cat createUser.nudo.draft.ts`）⇒ 文件现在在源 `.d.ts` 所在目录
  （`types/index.d.ts` ⇒ `types/index.d.nudo.draft.ts`）⇒ 旧路径读不到；
  从 `node_modules` 收割来的包类型**不再**写草稿（此前会写）。
  
  怎么迁移：按源 `.d.ts` 的目录定位草稿（`<dir-of-dts>/<stem>.nudo.draft.ts`），
  别再假设草稿落在 CWD；`node_modules` 里的包类型先把 `.d.ts` 复制进工程再跑。
  
  `nudo contract --emit` / `--from-dts`: unmatched `--fn` names no longer widen
  the write scope, the dry-run preview names the sidecar it would change,
  `--json --emit` now emits a machine payload, and `--from-dts --write` lands its
  draft next to the source `.d.ts` instead of in the current directory.
  
  - **Bug 657 — `--fn <misspelled>` silently dropped the filter.** When none of
    the requested names matched an export of the target file, the filtered list
    was downgraded to "no filter at all", so the emitter refreshed *every*
    existing `@generated` segment (or, with `--all`, created segments for every
    export) and wrote the sidecar — exit 0, no warning. Now a name that matches
    nothing is a usage error: the local export names are listed, the exit code
    is 1, and **nothing is written**. When only *some* names match, the
    unmatched ones are passed through unchanged and surface through the
    emitter's existing `skipped <fn> (not-an-export)` channel — the same wording
    the LSP / agent face already uses.
  - **Bug 662 — the `--emit --dry-run` preview named the source file.** The
    preview said `would update lib.js` while the diff it printed was against
    `lib.nudo.js`. The label now names the sidecar, matching the diff header
    and the other two branches of the same command.
  - **Bug 667 — `--json --emit` ignored `--json`.** stdout was human text and
    the exit code was 0, so a machine consumer got unparseable output with no
    failure signal. `--json --emit` now prints one valid JSON document: the
    per-file machine record (`file`, `sidecar`, `changed`, `written`, `skipped`,
    `issues`, `diff`), shaped like the `--json` / `--draft --json` records and
    collected into the same aggregated array.
  - **Bug 944 — `--from-dts --write` wrote into the current directory and
    overwrote unconditionally** (a draft belonging to a *different* file with
    the same base name was silently replaced; exit 0, no warning). The draft now
    lands next to the source `.d.ts` (same `sidecarDraftPath` convention as
    `--draft --write`), an existing draft with different content is **not**
    overwritten (the write is refused with an explanation and exit 1; override
    with `NUDO_DRAFT_FORCE=1`), the write goes through the same guarded writer
    as `--draft --write` (never the formal sidecar, never `node_modules`, never
    outside the project root, unchanged content is not rewritten, an empty draft
    is not written), and the closing hint names the sidecar to copy the accepted
    exports into.
  
    **Behaviour change:** the draft produced by `--from-dts --write` moves from
    the current working directory to the directory of the source `.d.ts`
    (for example `types/index.d.ts` now yields `types/index.d.nudo.draft.ts`).
    Scripts that read the draft from the working directory have to follow the
    new path. Drafts for package types harvested from `node_modules` are no
    longer written at all — copy the `.d.ts` into the project first.
- 02aa122: 新增 CLI 旗标 `nudo contract --from-dts --write --force`（覆盖既有草稿的**可见**
  逃生口）—— 1.x+ 包的新旗标属**增量**变更（additive）⇒ minor。
  
  fix(nudojs): `nudo contract --from-dts --write` 新增 `--force` 旗标（覆盖既有草稿的可见逃生口）
  
  族 20 · 收口片（主 agent 接线）。`--from-dts --write` 在目标草稿已存在且内容不同时
  会**拒绝覆盖**（exit 1，零写盘）。此前唯一的逃生口是环境变量 `NUDO_DRAFT_FORCE=1`
  —— 对脚本不可见、不可审计。
  
  现在新增 CLI 旗标 `--force`：
  
  - `nudo contract --from-dts --write --force` ⇒ 允许覆盖既有草稿；
  - 与 `NUDO_DRAFT_FORCE=1` **等价**（旗标优先），但**在 CLI 面可见、可被脚本审计**；
  - 不加 `--force` 时的行为**不变**（仍然拒绝覆盖 + exit 1 + 零写盘）。
  
  旗标只在 `--from-dts --write` 组合下有意义；与其它模式同用时不改变既有语义。
- 3432d8c: CaseJson 的断言面新增了**第三种裁决** `unchecked`（外加可选字段
  `uncheckedReason`）⇒ 机器面新增可选字段属**增量**变更（additive）⇒ minor。
  
  `nudo test` can now tell "the engine could not infer the value" apart from
  "the value does not match the expectation".
  
  - **A failed inference used to be reported as a failed assertion.** When the
    engine cannot infer a witness' result (the observed value is `unknown`, or
    its confidence is `opaque`), the assertion verdict was binary: the case was
    reported as `[FAIL]`, `nudo:case-expected` was raised, and the run exited
    `1`. Writing the honest expectation (`=> number()`) could never fix it,
    because the real cause was the failed inference, not a type mismatch — while
    the very same source was only an `INFO` (`nudo:opaque-result`, exit `0`) on
    the `nudo check` face, i.e. the two faces gave opposite severities for one
    fact.
  - **The opposite expectation passed for the wrong reason.** `=> any()` (the
    top type) satisfied every expectation, including the ones the engine could
    not judge at all, so the assertion reported `[ok]` while nothing had been
    inferred — a hollow pass.
  
  Both assertion report faces — the CLI one (`nudo test`, `nudo test --json`,
  `nudo test --abs`) and the LSP agent tool one (`testTool`) — now use the same
  three-state verdict: a case whose observed value could not be inferred is
  recorded as **unchecked** (it is neither a failure nor a pass), it does not
  turn the run red, and the report says so explicitly ("cannot judge — the
  engine could not infer the actual value") and points at the
  `nudo:opaque-result` remediation path instead of claiming a type mismatch. The
  `unchecked` count in the `assertions` summary and in the `--json` payload now
  includes those cases, and a real mismatch is still reported as `[FAIL]` with
  exit `1`.
- ebe909e: `@nudojs/core` 新增公开可选项 `TranspileOptions.disableAsyncGen`（async 生成器路径的**安全网**开关）、
  `@nudojs/service` 新增公开导出 `analyzeFileWithEvalFailures` / `analyzeFileAsyncWithEvalFailures` /
  `FileEvalFailure` ⇒ 均为纯**增量** ⇒ minor。
  
  `nudojs` 的**闸门口径翻转**（模块级求值失败 ⇒ 不再静默放绿）按 **minor** 发布：
  `nudo check` 以 **error 级 `nudo:internal`** 报出并以**非零码**退出，`nudo health` 的
  `Result` 不再报 `OK`。**这是闸门口径的翻转**（详见下方「BREAKING」）。
  
  > **bump 级别说明**：本项目**尚无外部用户**，本批 1.x 包的破坏性变更统一以 **minor**
  > 发布并保留 `**BREAKING**:` 标注（谁会坏 + 怎么迁移照旧写全）⇒ 不占用 major 跳版，
  > 也不触发发布侧 `gate-major` 的人工确认闸门。一旦有外部用户依赖这些包面，
  > 即刻回到 `docs/versioning.md` 的「1.x + API/schema break ⇒ major」政策。
  
  fix: review 报告 34 条缺陷收口（闸门假红/假绿 · 契约面宽松 · 机器面谎报 · 文档与 changeset 漂移）
  
  本轮把一份 34 条缺陷的 review 报告逐条落地：每条都先在当前代码上**复现**（或判定为
  非缺陷），再修，并**逐条用回滚法自证「修前红 / 修后绿」**。新增 **39 个回归测试文件**。
  
  ---
  
  **BREAKING**: `nudo check` / `nudo health` 现在对**引擎内部回落**（模块求值失败 ⇒ 该文件
  的导出全部丢失）**fail-closed**。此前这类文件**零诊断 + exit 0** ⇒ CI 闸门**假绿**
  （合法代码与违约代码都判绿）。现在：命中内部回落 ⇒ 报 **error 级 `nudo:internal`**
  （消息含文件路径与原因）⇒ `nudo check` **非零退出**；`nudo health` 报
  `Result: FAIL (engine internal fallback found)` 并非零退出。
  
  谁会坏：依赖「坏文件也能过闸」的 CI 流水线（此前引擎自己挂了就当无事发生）。这些文件
  本来就是引擎缺陷的暴露面 —— 现在会**显式**报出来。
  
  怎么迁移：修掉被报出的文件（消息里给了路径与原因）。注意**口径边界**：`unsupported:*`
  （能力边界）与 `nudo:opaque-result`（推断精度）**不**触发该失败路径；只有**引擎内部回落**
  （`internal`）才 fail-closed。
  
  ---
  
  ### 高危（闸门级 · 5 条）
  
  - **`await` 的位置表与转译侧脱节 ⇒ `yield` 落进嵌套箭头 ⇒ 整模块编译失败 ⇒ L2 闸门假绿**
    （`core/algebra/exec/transpile/async-plan.ts` · `core/algebra/exec/run.ts`）：async 体的
    真挂起靠**宿主生成器**（`function*(){…}` + `await` 发射 `yield`）实现 ⇒ `yield` 必须落在
    生成器**体内联**位置；而转译侧把若干操作数包进**宿主 thunk** —— `yield` 落在里面是
    **SyntaxError** ⇒ `new Function` 编译失败 ⇒ **整个模块**的导出全部丢失 ⇒ 闸门看不到任何
    入口 ⇒ **零诊断 + exit 0** ⇒ **CI 闸门假绿**。位置表此前只把「分支臂 / 循环体 / 短路右臂 /
    三元两臂」判为 thunk，漏了：**成员调用的实参**（`o.m(await 1)`）、**成员赋值的接收者/计算键/
    右值**（`o.x = await 1`）、**成员自增的计算键**（`o[await k]++`）、**逻辑赋值的右值**
    （`x ||= await 1`）、**循环判别式与步进式**、**switch 的 case 测试**、**早退守卫之后的后续
    语句**（`if (!c) return null; … await …`）。实测：`export async function load(id){ if(!id)
    return null; const res = await fetch("/x/"+id); return res.json(); }` 修前 ⇒ `nudo check`
    **OK / exit 0 / 签名全 unknown**；修后 ⇒ **error 级 `nudo:entry-may-throw`**（与 main 同结论）。
    修法（两处，缺一不可）：① 位置表补齐（上列位置判 thunk ⇒ 该 async 体回落 `$async` 同步
    路径，产物是**合法 JS**）；② **安全网**：生成器模式编译失败时**关闭 `asyncGen` 重试一次**
    ⇒ 纵有未来新增的脱节位置，模块也**编译得出来** ⇒ 导出可见 ⇒ 闸门照常判定
    （**宁可少精确，不可整模块消失**）。
  
  - **模块级求值失败 ⇒ 闸门假绿**（`service/src/analyzer-orchestrate.ts` ·
    `nudojs/src/commands/{check,check-report,health}.ts`）：见上方 **BREAKING** 段。
    修法：按**文件**收集 `internal` 回落（进程级计数无法定位到文件）⇒ 命中即产出
    **error 级 `nudo:internal`**（复用已注册码 `DIAG.internal`，未新增第二套码表）⇒
    `ok:false` ⇒ 非零退出；分析失败的降级产物**不回写磁盘缓存**（回写 ⇒ 下次命中缓存跳过求值
    ⇒ 静默转绿）。
  
  - **早返回的关系补集默认「x 不是 NaN」⇒ 契约被证成 ⇒ 假绿**
    （`core/algebra/exec/transpile/stmt/{fn-body,statement}.ts`）：`¬(x <= k)` 还含 `x` 为
    **NaN** 的情形（NaN 与任何比较皆假）⇒ 后续路径只该断定 `x > k ∨ x is NaN`；此前直接断言
    `x > k`（排除了 NaN）⇒ `if (x < 0) return 0; return x;` + `return nonNeg` 判**成立**
    （零诊断），而原生 `x=NaN` 时返回 NaN ⇒ **真违规被放过**。且与**三元**写法
    （`x < 0 ? 0 : x`）结论**不一致**（三元判 `unproven-return`）。修法：撤销后续路径的否定界
    窄化 ⇒ 两条路径同口径。
  
  - **Bug 370 把「确定违规」降为 warning**（`core/algebra/postcondition.ts`）：证据面判据
    从「`ret.pred` 有事实」改成「含**界原子**」⇒ `typeof` 级证据（`@nudo:contract x num` 的
    **声明域参数**）被判成「无证据」⇒ 返回义务降级成 `nudo:unproven-return`（**warning**，且
    warning **不改变 exit code** ⇒ 门禁空转）。`if (x === -1 || x === -2) return x;` + `return
    positive` 是**确定违规**（x=0 即违约），此前只出 warning。修法：判据回到「`ret.pred` 有
    事实」⇒ 声明域参数 ⇒ **error 级 `nudo:constraint-violated`**。
  
  - **契约合取的结构型义务被静默丢掉 ⇒ 假绿**（`core/algebra/interface.ts`）：合取遇任一侧
    结构型就直接返回前侧 ⇒ 源码 shape`{id}` ∧ 侧车 shape`{id,name}` 的 **`name` 义务整条蒸发**
    ⇒ 契约面比声明面**宽松** ⇒ 违约代码被放过。修法：改为**字段级合并**（两侧都有的字段递归
    合取、单侧字段保留、`optional` 取交集）；合不了的形态组合按既有口径**不**判 conflict
    （能力边界 ≠ 语义不可满足）但**显式留痕**（新增 `EffectiveInterface.undecidable` ⇒ check 面
    发 **warning** 级 `nudo:interface-conflict`，**不静默宽松**）。
  
  ### 闸门可信度（假红 / 假绿 · 14 条）
  
  - **展开实参被计为 1 个 ⇒ `nudo:arg-count` 假红**（`core/algebra/scan/literal-args.ts`）：
    `impl(...args)` 被计成 1 个实参 ⇒ 报「expects 2 argument(s), got 1」；数组字面量展开的**空洞**
    （`three(...[1,,3])`，原生是 3 个实参）被跳过；幻影槽位破坏 rest 聚合（`few(1, ...more)`
    对 `array(number()).max(1)` 报长度违规）。修法：个数不可判时**让位**元数检查；空洞按
    `undefined` 计入；rest / length 边界在展开处**停止**。
  - **裸名 callee 解析不看作用域 ⇒ 无契约也触发 arity 假红**（`core/algebra/scan-call-graph.ts`）：
    外层函数的**形参 / 局部 const / 嵌套函数 / for-of 绑定 / 解构绑定**同名时，把顶层声明当被调
    方 ⇒ 报「log expects 2 argument(s), got 1」+ 假 may-throw。修法：callee 解析引入**作用域链**。
  - **`memberToFn` 按变量名做键 ⇒ 同名局部/参数互相串味**（`core/algebra/scan-call-graph.ts`）：
    别名与成员绑定改为**按作用域分桶**，重新赋值时失效。
  - **TS `x?: T` 与 JSDoc `[x]` 被当成必需参数 ⇒ arity 假红**（`core/algebra/param-surface.ts`）：
    `h()` 对 `/** @param {number} [x] */ function h(x)` 报「expects 1 argument(s), got 0」。
  - **`or` 契约的「不可判定」成员被当成失败**（`core/algebra/scan/literal-shapes.ts`）：
    `union(number().gt(0), lit("a"))` 对**非字面量 number** 实参误报。修法：三值聚合 ——
    **全部**成员确定假才报；不可判定且域容纳该形态 ⇒ 整条 union 保持未决。
  - **显式 `undefined` 被当成值**（`core/algebra/scan/literal-args.ts`）：`d1(undefined)` 对带默认值
    的形参报约束错误。修法：显式 `undefined` ⇒ 走**默认值**。
  - **默认值填充只在零参时发生 ⇒ 假绿**（`core/algebra/scan-literal-calls.ts`）：
    `e4(1)` 缺失的尾部位不补（运行时 x = -5）⇒ 静默。修法：补齐**所有缺失的尾部位置**。
  - **switch 分组 case 标签的 `hit` 收窄不安全**（`core/algebra/exec/transpile/stmt-predicates.ts`）：
    `const x = null; switch (x) { case null: case "ab": return x.length; }` 原生抛 TypeError，
    引擎按源码推导读 `"ab".length` ⇒ **L2 may-throw 消失**。`case 0:` 还会把 `-0` 重绑成 `+0`
    （原生 `1 / -0` = `-Infinity`，引擎算成 `Infinity` = **自信的错值**）。修法：只有**同体全部
    标签都是原始字面量**才产命中事实；`0` 按**交集细化** `{0, -0}`。
  - **`lit(NaN)` 契约被判自相矛盾 ⇒ 假红**（`core/algebra/interface.ts`）：字面量值比较用
    `!==` ⇒ `NaN !== NaN` ⇒ 同一个 `lit(NaN)` 自比被判成「两个不同字面量」⇒
    `nudo:interface-conflict`。修法：改用既有 helper `termEquals`（`===` + NaN 特例）。
  - **import 别名撞 ambient builder 声明 ⇒ 整个 sidecar 装载失败**
    （`core/algebra/refine.ts`）：`import { number as string } from "@nudojs/core"` 与包装器的
    `const { number, string, … } = __nudoInjects` 同处一个外层作用域 ⇒ SyntaxError ⇒ 侧车整体
    装载失败 ⇒ **契约全丢**。修法：显式 import 的本地名从 ambient builder 名单里排除。
  - **`autoBind:false` 下不可读的 ambient sidecar 仍被报成 error ⇒ 假红**
    （`core/algebra/load-deps-fp.ts` · `core/algebra/check.ts`）：**指纹计算**的推测性读取
    走的是**分析读**通道 ⇒ EACCES 被收口成 error；而那份侧车在 `autoBind:false` 下**根本不会被
    绑定**。修法：推测性读走**未经降级闸**的通道（读失败只让指纹标 `readError`）+ 按 ambient
    绑定资格 gate。
  - **缓存的 sidecar 诊断丢失依赖归属**（`core/algebra/refine.ts`）：root→dep 递归求值共享同一
    diags 数组 ⇒ 依赖侧车的诊断一律记到 **root** 名下。修法：诊断带**来源文件**并纳入去重键。
  - **`lit(1n)` 的大字面量被提前过滤 ⇒ 假绿**（`core/algebra/contract-face.ts`）：bigint 过滤
    发生在 `literalMeetsConstraint` **之前** ⇒ `lit(1n)` 契约下返回 `2n` 的被调函数被判**满足**
    ⇒ 违约被放过。修法：bigint 参与比较（`1n !== 1`，与 number 不混同）。
  
  ### 机器面 / 契约面 / 工具链（8 条）
  
  - **`@nudo:skip` 签名分支输出旧机器面**（`core/algebra/check.ts`）：JSON `display` 带
    `#exact` 而终端显示 `number` ⇒ 机器消费方拿到的是**人类面之外的文本**。修法：与其它路径
    同款（`formatSigCached`）。
  - **内部临时名遮蔽用户标识符**（`core/algebra/exec/transpile/{member-path,expr/assignment,
    expr/call,expr/optional-chain,expr/short-circuit}.ts` · `helpers.ts`）：引擎写死的
    `__nudoMp*` / `__nudoDefR` / `__nudoReArgs` / `__v` 会**遮蔽**用户源码里的同名绑定 ⇒ 自信错值
    或 TDZ **ReferenceError**（⇒ 闸门**假红**）；模块级同名还会撞出重复声明 SyntaxError ⇒
    **整模块 fail-closed** ⇒ 闸门**假绿**。修法：改用既有 `internalTmpName` /
    `internalTmpNameSet`（**无碰撞时基名原样返回 ⇒ 产物逐字不变**）。
  - **CJS 对象字面量导出的普查键必须是成员键**（`core/algebra/export-slot.ts`）：
    `module.exports = { greet: function inner(x){…} }` 的侧车契约**整个不绑定**（只剩
    `unproven-return` 警告、签名退成 `unknown` ⇒ **假绿**），且内层 id 与成员键碰撞时映射串。
    修法：导出槽映射**只用成员键**。
  - **`leq` 的 fn arity 只比较必需参数个数**（`core/algebra/leq.ts`）：`(a = 1, b) => b.toFixed()`
    被接受为单参目标（原生 `g(1)` 抛 TypeError）⇒ 判定比原生松 ⇒ 假绿。修法：按**最后一个必需
    参数的位置**比较。
  - **生成的守卫对 `new Proxy(...)` 抛错**（`core/algebra/denote.ts`）：`x instanceof Proxy` 在
    原生**抛 TypeError**（Proxy 没有 prototype）⇒ 守卫产物一跑就炸。修法：对**无可用 prototype**
    的构造器跳过身份子句。
  - **超参 warning 忽略可选/默认槽位**（`core/algebra/diagnostics.ts`）：`f(a, b = 1)` 被 `f(1, 2)`
    调用时误报「takes 1 argument(s) but 2 were passed」。修法：上界按**非 rest 形参总数**。
  - **多行 `@nudo:case … !! throws` 声明丢失**（`core/algebra/directive-scan.ts`）：case 参数跨行
    时后缀正则匹配不到 ⇒ 申报的 throws 丢失 ⇒ `nudo:entry-may-throw` **假红**。修法：先在完整
    注释里找平衡的 case 参数终点再识别后缀。
  - **`export default C` 的类入口被漏**（`core/algebra/scan-top-functions.ts`）：Babel 的
    `Identifier` 字段是 **`name`**（代码读的是 `d.id?.name` ⇒ `undefined`）⇒ 类入口不在入口表里
    ⇒ 构造器入口闸门看不到它 ⇒ **假绿**。
  
  ### async 运行时（2 条）
  
  - **callee 有 2 个及以上 await 时 caller 提前恢复**（`core/algebra/exec/runtime/async.ts`）：
    队列为 `[callee-resume, caller-resume]` ⇒ callee 的**第二次**续体排在 caller 之后 ⇒ caller
    读到**占位符**。实测 `async function g(){ log.push(1); await null; log.push(2); await null;
    log.push(3) }` 原生 `"1,2,3"` / 修前 `"1,2"` / 修后 `"1,2,3"`；`return await h()` 原生 `7` /
    修前 `unknown` / 修后 `7`。修法：live promise 维护 **pending 态 + waiter 列表**，await 的
    恢复排在 settle **之后**。
  - **`Promise.all` 取调用期快照**（`core/algebra/builtins/promise.ts`）：元素尚未 settle 时取到
    占位符 ⇒ 兑现值被永久冻住；元素**拒绝**通道丢失 ⇒ 拒绝臂成死代码（**假绿**）。修法：组合子
    自身 pending，元素 settle 后重算聚合；任一元素确定拒绝 ⇒ 组合子短路拒绝。
  
  ### 约束构造器（1 条）
  
  - **`.int()` 暴露给非 number builder ⇒ 同一约束两个裁决**（`core/algebra/constraint.ts`）：
    `literalMeetsConstraint("abc", string().int())`（域面）接受 `"abc"`，而 Abs/投影面却带整数
    谓词。修法：非 number builder 上 `.int()` **抛错**（与 `shift()` 同口径）。同批收口：
    `fn()` 缺字段表守卫、`boolean().gt(1)` / `string().length(-3)` 等**恒假**契约（假红）、
    `array(1,2)` 静默丢元素约束（假绿）。
  
  ### 文档 · changeset · 诊断注册表（4 条）
  
  - **自称破坏性的 vite-plugin changeset 声明为 patch**（`.changeset/fix-vite-plugin-s{1,3,4}.md`
    等 32 个）：按 `docs/versioning.md` 逐个复核并**校正 bump 级别**（pre-1.0 的破坏性 ⇒ minor；
    1.x+ 的 JSON 形状变更 / 默认严重级变更本应 ⇒ major，但**本项目尚无外部用户** ⇒ 本批
    统一以 **minor** 发布，见上方「bump 级别说明」），并补 `**BREAKING**:` 与迁移说明。
  - **设计文档引用了被 gitignore 的产物**（`docs/design/generator-laziness.md` ·
    `docs/design/architecture-debt.md`）：`tmp/…` 路径（读者不可达）、`bun` 命令、过时行号、
    `$gen` 发射点数目（3 ⇒ 实为 4）。修法：删交接笔记、引用**符号名**、指向仓内回归钉。
  - **中文 API 文档漂移**（`packages/website/i18n/.../api/{agent,cli-reference,lsp,harvester,
    service}.md`）：手写页与 EN 现状不一致（`--json` 的形态、`force?: boolean`、旧契约…）⇒
    逐页同步；同时**收紧**文档覆盖闸门（`docs-coverage.test.ts`）让手写 api 页也进闸门。
  - **诊断码绕过注册表**（`packages/core/src/algebra/diag-codes.ts` ·
    `packages/nudojs/src/commands/migrate.ts`）：`nudo:migrate-strip-failed` 此前直写字面量 ⇒
    进 `DIAG` 注册表并由 CLI 引用常量。
  
  ### 附带（不改变对外行为）
  
  - `nudo init` 的祖先配置继承口径与加载器对齐（本包已有 `nudo` 键 ⇒ 祖先**不可继承** ⇒ 不再用
    祖先配置当拒绝理由，消除「拒绝 + 不可修复」的死锁）。
  - `contract --help` 的 `--json` 描述、`contract --from-dts` 的拒绝提示（同时给出 `--force` 与
    `NUDO_DRAFT_FORCE=1`；**人工改过的草稿永不被覆盖**这条口径不变）。
  - `nudo:migrate-strip-failed` 进注册表；`interface` 缓存面新增 `undecidable` 透传。
  - 6 条**被放松/空转**的既有测试恢复为**强断言**（`check-regex-capture-narrow-136` ·
    `eval-loop-return-join` · `eval-bug-499` · `core-bug-1064` · `loop-pack-shadow-soundness` ·
    `core-bug-1079`）—— 此前它们在 main 上也通过，钉不住任何回归。
- dde4b03: **BREAKING**: dts 面的**投影形状**变了 —— `.d.ts` 现在按**模块面**装配
  （类作为**类声明**投影、成员在类体内；`export default` 保持默认形态；
  `export * from` / `export { x } from` 的再导出被复现）；standard 面的输入面
  导出名也统一成 `<fn>Input`（解构形参不再导出字段级校验器 `act_a` / `act_b`）。
  
  谁会坏：消费方 `import` 生成 `.d.ts` 的类型并按**旧形状**引用的代码 ——
  
  - 类成员此前被摊成**模块级**声明（源码里并不存在这些顶层符号）⇒ 旧 `.d.ts`
    的形状与新 `.d.ts` 不同 ⇒ 消费方 `tsc --noEmit` 会红；
  - 再导出的符号此前**整个缺失** ⇒ 现在出现（反向：依赖「它不在」的代码会冲突）；
  - standard 面解构形参的 `act_a` / `act_b` 导出**移除**，改为 `<fn>Input`。
  
  怎么迁移：重新生成产物并按新形状引用（类成员走 `Class.member`，再导出符号现在
  可用）；standard 面改 import `<fn>Input`。
  
  Cross-shard wiring for the `service-emit` batch: the CLI now feeds the
  product faces the same information the analyzer holds, and a frozen
  witness no longer takes over a function's published type.
  
  - `nudo export --format standard` builds its module with the service
    assembler (`absToStandardSchemaFunction`) instead of a hand-rolled
    projection, so the standard face has the same input validator as the zod
    face (`<fn>Input`, one validator for the whole argument object) and a
    destructured parameter no longer exports field-level validators
    (`act_a`, `act_b`) that reject the correct argument.
  - The dts face is now assembled from the **module** surface: a class is
    projected once as a class declaration (members inside the class body)
    instead of one flat declaration per member, `export default` keeps its
    default form, and `export * from` / `export { x } from` re-exports are
    reproduced. Before, the class members were emitted as module-level
    declarations that did not exist in the source and a re-exported symbol
    was missing from the `.d.ts` entirely.
  - A contract that declares an optional parameter now reaches the product
    faces: the constraint's `isOptional` is carried explicitly (the entry
    `Abs` does not keep it), so the zod input object renders
    `.optional()` and the dts declaration uses `x?: T`.
  - `nudo contract --emit` renders each diagnostic exactly once. The emit
    summary already renders and consumes the issue list, so the CLI's
    trailing error-only loop printed the same diagnostic a second time on
    the dry-run path.
  - `nudo contract --emit --write` now exits non-zero when it refuses to
    overwrite a hand-edited draft. The file is left untouched (as before),
    but a silent exit `0` told CI that the draft had been regenerated.
  - `nudo check --fix` states explicitly when the fix did not turn the gate
    green but changed the diagnostic instead (for example the old
    `constraint-violated` became a new `entry-may-throw`). The previous
    message ("N residual error(s) remain") read as if the fix had worked.
  - `nudo export` no longer collapses a function's published type to a
    single frozen call site. A `@nudo:case` witness without an assertion
    observes **one point**; it is not a domain claim, so it must not own the
    return face. `nudo test --freeze` writes exactly such a witness, so
    freezing a call used to narrow the zod face to `z.literal(3)` and the
    guard face to `data === 3` — a guard that rejects every legal call —
    while `nudo check` still reported `number | string` for the same
    function. A function whose only evidence is a point witness now keeps
    its inferred domain, and the zod, standard, guard and dts faces agree
    with the check face.
  - `nudo test` classifies a case as synthetic by its **source** instead of
    by its name. A witness written by `--freeze` is named after the call
    site (`call@<file>:<line>`) but is declared in the source, so it was
    reported as synthetic and the run claimed "no declared @nudo:case
    expectations" even though the source now declares one.
  - `nudo contract --emit` removes a generated section whose export no
    longer exists in the source. The stale section kept the name occupied
    in the sidecar, so a hand-written contract for a new function of the
    same name produced an invalid sidecar.
  - A rest parameter is now observed as a **variable-length** argument, and
    the entry fallback observation of it is marked uncertain. Before,
    `xs.length` was observed as the literal `1` of the single placeholder
    argument, and the zod, standard and guard faces projected that
    one-off observation as the output domain (`literal(1)`) — a validator
    that rejects the value the exported function itself returns — while the
    dts face wrote `number`.

### Patch Changes

- 5749924: 族 21 修复 C1：Bug 674 682 683 691 947 948 949 —— `nudo health` 的诊断与判定面。
  
  - **674**：`health` 把**所有非 drift 的分析诊断**丢掉 → 坏掉的侧车在 health 面
    **绿灯**（假绿）。现在 analyzer 的 **error 级诊断**（「分析错误」：
    `nudo:interface-load` / `nudo:module-missing` …）进 `report.error` ⇒
    `ok:false` / `errors≥1` / 非零 exit，与 `nudo check` 对同一路径同口径
    （口径 = `guides/health.md` 的 health 门「Analysis errors」）。
  - **682**：witness drift 计数不再用「新集合大小 + 旧集合大小」的**和式**
    （把同一条见证的改写拆成 +1 new / -1 removed 各计一次 ⇒ 只改 1 条见证报
    「2 条变更」，且与同屏 Summary 的「1 case drift」自相矛盾）。改为按**见证
    身份（调用点）**逐条比对的**实际变更条数**（同一条见证被改写只计 1 次）；
    `--json` 面额外给出 `drift.changed`（机器面可拆分 new / changed）。
  - **683**：`health --from` 的使用点**一条调用记录都没有**时，整段漂移检测被
    静默跳过 ⇒ 见证早已陈旧仍报 `Result: OK` / exit 0（假绿）。现在显式报
    「**无法判定漂移**」（`nudo:path-missing-callsite` + `fix:` 提示）并判红；
    没有冻结见证时「0 drift」属实 ⇒ 不发假红。
  - **691**：`health` 的**契约漂移判定**不施加 **mock 通道** ⇒ 同一份陈旧生成段，
    `nudo check` 报 `nudo:interface-drift` 而 `health` 报 0 contract drift / OK /
    exit 0（假绿 + 跨动词自相矛盾）。现在契约漂移判定与 `nudo check`
    **同口径**（同一注入包装配：模块图 + mocks + env 全局 + replace/as）。
  - **947**：`health` **不设「分析目标」闸门** ⇒ 把 `.d.ts` / 侧车 / `.jsx` 当成
    **已检查的源文件**并报「Result: OK」（exit 0），而 `check` / `test` 对同一
    路径 exit 1「Not an analysis target」（假绿 + 跨动词自相矛盾）。现在目标解析
    与 check / test **同口径**（`isNudoTargetPath` 闸门 + 同款 `pathNotTarget`
    错误：同样的 message / suggestion）。
  - **948**：`health --json` 在**空目标集**时给出 `"ok": true` + `"files": []` +
    exit 0 ⇒ 机器消费者读到「一切正常」，而实际上**一个文件都没检查**。现在
    空目录与 check 同口径判红（`nudo:path-empty-dir` + `ok:false` + 非零 exit）。
  - **949**：`health` 的 `uncovered` 指标**在结构上恒为 0**（过滤式恰好排除了文档
    定义的「entry fallback」那一类）⇒ 文档承诺的「uncovered ⇒ Reported,
    informational only」**永不成立**；机器面读出的 `"uncovered": 0` 恒为假。
    现在 `uncovered` = 「无调用点证据（回落 entry@）」的函数（口径 =
    `guides/health.md`）⇒ 文本面逐个点名报出，机器面 `summary.uncovered` 真实；
    仍是 informational only（不判红）。
- 5749924: 族 21 修复 C2：Bug 687 688 925 927 929 —— health 的输出面与 watch 面。
  
  - **687**：文本面与 `--json` 面的 error 计数**同源**（文件内 error + `--from`
    路径错误 ⇒ `totalErrors`）⇒ 同一轮两个面不再给出两个数字（此前文本面
    「0 error(s)」+ JSON 面 `summary.errors: 1`）。
  - **688**：`health` 的 `--from` 多值语义与 `check` / `contract` **同口径** ——
    多文件 `--from` 被**接受**（`nudo health lib.js --from a.js b.js`），
    分析目标仍是 `lib.js`；多值时 stderr 如实说明「`--from` 之后的裸 token
    全部按使用点文件处理」。无位置路径时仍是 usage error（文案如实：
    此时 paths 确实为空，与 check / test / contract 同款）。
  - **925**：`health --json` 的机器面**序列化 budget 截断快照**
    （`files[].budget`，与 `nudo check --json` 同源同义）+ 多文件聚合出
    `summary.budgetTruncated` ⇒ 文本面报「budget truncated / 结果被宽化」时，
    机器消费者也拿得到 `truncated` 标志（此前 JSON 面给 `"ok": true` 的
    「干净」报告）。
  - **927**：`health --watch` 在**装 watch 之前**做路径存在性校验 ⇒ 缺失路径
    与无 watch 面**同款**（`File not found` 上屏 + exit 1）且**不装 watch**
    ⇒ 不再是「静默空会话 + 绿」（假绿）。
  - **929**：watch 的 runner **按轮去重**（`startWatch` 的 `onRoundStart`）——
    一轮只跑一次 `runHealth` ⇒ 首轮只产出一份完整报告（此前按文件数重跑整个
    路径集 ⇒ N 份报告 / N 份 JSON 文档 ⇒ `JSON.parse(stdout)` 必炸）。
- 5749924: 族 21 修复 C3：Bug 671 684 685 686 689 1026 —— 目录扫描与 watch 路径面。
  
  - **671**：目录目标的文件收集**跟随符号链接**判定（`statSync`），链接进来的
    文件 / 目录不再被静默丢弃 ⇒ `check <dir>` 不再对链接进来的坏文件假绿
    （exit 0），目录链接按 realpath 防环。
  - **1026**：目录发现复用产品唯一的范围闸门（`shouldAnalyzeFile`）⇒
    **产品默认安全排除三条全生效**（node_modules / dist / coverage，此前 CLI
    只抄了 1/3）⇒ `dist/` 里的陈旧构建产物不再被当源码门禁（`nudo test <pkg>`
    不再假红），CLI 与 IDE / vite 对同一文件结论一致。
  - **689**：**watch 扫描**走同一个 service 闸门 ⇒ 应用
    `nudo.analysis.include` / `exclude`（文档承诺「watch 扫描：应用」），
    不应用 mode ⇒ 与 IDE 对同一文件口径一致；CLI **非 watch** 的目标扫描仍
    忽略 include/exclude（「点名路径即意图」）。
  - **684 / 685 / 686**：watch 的**监视根按每个路径各自解析**（目录→该目录，
    文件→其所在目录），事件路径按**所属监视根**换算 ⇒ 多路径且首个是文件时
    watch 不再彻底失效，同目录多文件时变更文件不再被误记成首个路径，跨目录
    路径时其余目录不再是盲区；关闭句柄一次关掉全部 watcher。
- 5749924: fix(cli): `check --abs` 观察面与 watch 输出面的产品面修复
  
  - `check --abs --fn <不存在的名字>`：拼错的名字不再被报成「引擎推导失败」
    （unknown / conf: partial），改为与「文件里没有该函数」同款的用法错误
    （stderr + `fix:` 提示）+ 非零 exit。
  - `check --abs --assume <坏值>`：坏值不再被静默吞掉（命令照跑并 exit 0），
    改为用法错误 + 非零 exit，且不进入观察面。
  - `check --abs`：有效契约（源码 `@nudo:contract` + 侧车 `*.nudo.js`）约束的
    形参真的进求值（与签名表同源），不再回落 `any` —— 同一函数在
    `check`（`g(x: number) => string`）与 `check --abs`（`g(number) => string`）
    两个面上不再给出互斥的类型。
  - `check --abs --assume`：`>=` 不再一律按 `>` 构造（`x>=1` 过去实际得到
    `x>1`）；多条假设**合取**（过去互相覆盖，只有最后一条生效）；与
    `--generalize` 组合时显式拒绝（该模式没有 Φ 入口，旧的「接受并回显、
    然后忽略」是静默说谎）。
  - watch 横幅（人类进度）一律走 **stderr**：`nudo test --watch --json` /
    `nudo health --watch --json` 的 stdout 现在是纯 JSON（`JSON.parse(stdout)`
    不再抛）。
  - watch 增量轮：env 模板判定排在 `isNudoTargetPath` 之前（旧的 env 反向边
    分支是死代码 ⇒ 改了 env 模板，依赖它的源文件永不复分析）。
- 5749924: fix(cli): `nudo init` 的幂等判据 / 作用域 / IO 错误面 / 写盘保真度，与 `migrate strip` 的机器面
  
  - `nudo init` 的幂等判据与**配置加载器的真值判据**对齐（`packages/service/src/evaluator/config.ts`
    的 `readNudoKey`）：只有「`nudo` 键存在 **且** 值是非 null 的非数组对象」才算
    一份有效配置。形状非法的值（`null` / 标量 / 数组）过去让 init 报「already has a
    nudo config」而一个字节不写（加载器却按「无配置」提示你去跑 `nudo init` ⇒ 死循环），
    现在被替换成 adoption 基线。
  - `nudo init` 不再**遮蔽**祖先配置：祖先 package.json 已有有效 `nudo` 配置时，
    init 拒绝写入遮蔽键（`error:` / `fix:` 引导 + exit 1）—— 过去它静默写下一个
    `nudo` 键，让 monorepo 根的 strict 档整段消失，**红的 CI 门禁被静默翻绿**。
  - `nudo init` 不再**向上逃逸**：最近的 package.json 若是 workspace / 容器根
    （`pnpm-workspace.yaml` / `lerna.json` / `package.json#workspaces` / 常规
    workspace 目录下的子包），init 拒绝写入（提示先给目标包建 package.json）——
    过去它把基线写进**仓库根**，整个 monorepo 的门禁档被改。
  - `nudo init` 的 IO 失败路径可区分：读失败报「cannot read」（过去被误报成
    「不是合法 JSON」），写失败不再冒泡成裸 errno，而是「cannot write」+ `fix:`
    引导 + 非零 exit。
  - `nudo init` 写盘改为**最小改动**：只在原文本上插入 / 替换 `nudo` 键，其余字节
    逐字保留（缩进单位、键序、冒号后空格、换行风格、尾换行状态）—— 过去整份
    `JSON.stringify(pkg, null, 2)` 重写，把 4 空格缩进规范化成 2 空格、把整数样键
    重排、并强行补尾换行。
  - `nudo migrate strip` 逐目标收集结果：一个目标失败（语法错）不再吞掉其它目标
    的成功结果；`--json` 失败时 stdout 仍是**合法 JSON**（`ok:false` + `results` +
    带文件名的 `pathErrors`），stderr 带文件名。
  - `nudo migrate strip --write` 在**写盘之前**检出「剥完仍有 TS-only 语法」的目标
    （类成员修饰符 `private` / `public` / `protected` / `readonly`、构造器参数属性）
    并**拒绝写盘** + 响亮报错 —— 过去它静默写出一个 Node 解析不了的 `.js`
    （migrate 是一程闸门，写坏了没有回退路径）。产物本身可解析仍取决于
    `packages/core/src/strip-types.ts` 的降级发射面。
- 5749924: Five CLI-surface fixes (flags / JSON envelope / watch / config robustness).
  
  - `--what-if` now accepts `name=type` as well as `name:type`. The documented
    commands (guides/ai-native-dx.md, reference/agents.md) use the equals form;
    the parser only accepted the colon form, so the whole token was taken as the
    binding name and the assumption silently did not apply ("Bindings not
    applied", exit 0).
  - `package.json#nudo.check.ignoreThrows` is parsed by the same parser as
    `--ignore-throws` (comma-separated, trimmed, bare string or array). The
    config side used a strict `string[]` filter, so `"TypeError"` and
    `["TypeError,RangeError"]` were silently dropped and the gate stayed red
    although the throw class looked ignored. A malformed value (number / boolean
    / object) falls back to the default and prints one stderr warning.
  - The `CheckJsonMulti` envelope no longer counts `--from` path errors as
    analysis errors: `summary.errors` equals the sum of `reports[].summary
    .errors` equals the human-face count (the contract core asserts). Path
    errors stay in `pathErrors[]`; a non-empty `pathErrors` still means
    `ok: false` and exit 1.
  - `nudo check --watch --from` re-collects the call-site evidence every round
    instead of using a start-up snapshot, so a dependent file and its caller no
    longer give opposite verdicts for the same call in the same round. Missing
    call-site evidence turns the round red instead of silently reusing stale
    data.
  - `package.json#nudo.env` with a non-array value is reported as a
    `config-shape` warning (file name + diagnostic code) in both the human and
    the `--json` face, and the consumption point no longer iterates it blindly.
- 79d7feb: fix(nudojs): CLI 机器面的 3 条（族 56 · nudojs **CLI 面**）
  
  这 3 条都是**机器消费者**能看见的问题（`nudo migrate` 的 `--json` 面 / 迁移
  闸门）：
  
  - **排除清单未上 stdout**（`migrate status` / `migrate retire --all`）：排除
    清单（pnpm 负向模式 `!packages/legacy` 命中的包）此前**只**出现在 **stderr**
    的人读行 ⇒ **机器消费者**看不到「哪些包被排除了」。现在它同时进 **stdout 的
    机器面**：`--json` 的每行/每条结果多一个 `excluded` 字段（相对**扫描根**的
    posix 路径，与 stderr 那行**逐字一致**）。口径：**只在有排除时出现** ⇒ 无排除
    时 `--json` 输出与旧版**逐字相同**；**文本面 stdout 不变**（stderr 那行人读
    提示仍在原处）。
  - **多目标退役的错误消息只带第一个失败目标**（`migrate retire <a> <b>`）：
    `migrateRetireMany` 此前**遇到第一个失败就抛** ⇒ 其余失败目标**丢失**
    （用户以为只有一个包有问题）。现在消息**列出全部失败目标**（`<原因> (target:
    <目标>)` 之后追加 `  <目标>: <原因>` 清单），`--json` 面另有结构化的
    `failedTargets`。**原子性不变**：任一失败 ⇒ 整批零写盘；单个失败的消息与旧
    实现**逐字同形**。附带修一处**假绿**：一批里混着「无可退役」与**真错误**时，
    旧口径按**第一个**失败项定 exit（真错误被当成正常结果 ⇒ exit 0）⇒ 现在
    「**全部**失败项都是无可退役」才算正常结果，否则报红。
  - **verify 的扫描面不含 `.jsx`**（`migrate verify`）：verify 此前复用 service
    的 `isNudoTargetPath`（排除 `.jsx`）⇒ **JSX 产物**（旧 `migrate strip` 的
    `.tsx → .jsx` 映射产物，Node 加载不了）对迁移闸门**不可见** ⇒ 闸门对**不可
    加载的产物**发绿灯。verify 现在**自己算扫描面**（纳入 `.jsx` / `.tsx` /
    `.cjs`；声明文件 / 侧车 / draft 产物**仍不是**目标 ⇒ Bug 566 同口径不变）。
    ⚠ **根因仍在 service**（`isNudoTargetPath` 排除 `.jsx`）——`nudo check` /
    `nudo health` / `nudo test` 共用那条规则，本片只做 **CLI 侧兜底**。
- ae9a2b9: fix(nudojs): health 文本面量纲 / `pathErrors[]` 命名 / watch 多轮 JSON 形态（族 63 · nudojs CLI 协议面）
  
  这 3 条都是**机器消费者**能看见的问题（`nudo health` 的报告面 + `--json` 面、
  `--watch` 的 stdout 形态）：
  
  - **health 文本面两处量纲不一**：Summary 的「N case drift」计的是**有漂移的
    文件数**，而同屏明细行计的是**见证条数** ⇒ 同一份报告里两个「N」量纲不同
    （一个文件里两条见证陈旧 ⇒ Summary 印「1 case drift」、明细行印「2 witness
    directive(s) changed」⇒ 用户读到的数自相矛盾）。现在 Summary 的数 =
    **见证（case）条数**（= Σ 各文件明细行的条数）⇒ 标签「case drift」（一条
    `@nudo:case` 见证指令）与数字终于同义；`--json` 面的 `summary.drift` 同一
    量纲（= Σ `files[].drift.(added+removed)`）⇒ **文本面 / JSON 面 / 每文件
    明细行三个面同一个数字、同一个量纲**。
    ⚠ **机器契约变更**：`--json` 的 `summary.drift` 的**单位**由「有漂移的
    文件数」改为「见证条数」（无漂移时仍是 `0` ⇒ 无漂移场景的输出**逐字不变**）。
    「有漂移的文件数」仍可由 `files[]` 逐条数出（`summary.files` 是文件总数）。
  - **`pathErrors[]` 命名漂移**：C1 把「**分析目标闸门**」错误（非分析目标 / 空
    目录 / 路径不存在）也推进了同一个 sink ⇒ 该数组名不再只表示「`--from` 路径
    错误」⇒ 机器消费者按名字误读。**既有字段 `pathErrors[]` 的名字与内容逐字
    保留**（兼容既有机器消费者：它是**路径级错误全集**）⇒ 另**新增**一个可选
    字段 `targetErrors[]`（分析目标闸门错误的**精确**子集）⇒ 语义可见、旧字段
    兼容、事实不丢。（`--from` 路径错误**不**进 `targetErrors[]` ⇒ 新字段是精确
    入口，不是副本。）
  - **watch 多轮累积的 JSON 形态**：第 2 轮起 stdout 里会有**第 2 份文档** ⇒
    机器消费者的 `JSON.parse(stdout)` 直接炸（"Unexpected non-whitespace
    character after JSON"）。现在 **`--watch --json` 的 stdout = JSON Lines**
    （**每行**一份完整 JSON 文档；`nudo health --watch --json` 一轮一份，
    `nudo check/test --watch --json` 一轮每文件一份）⇒ 机器消费者可**逐行**
    `JSON.parse`，不再随轮数炸。**非 watch 的单轮输出逐字不变**（仍是一份
    pretty 文档）；watch 横幅继续走 **stderr**（stdout 保持纯机器面）。
- 5323af0: fix(nudojs): `pathErrors[]` 命名漂移 —— check / test / contract 三个动词补齐 `targetErrors[]`（族 63b）
  
  `pathErrors[]` 这个名字原本只承诺「`--from` 路径错误」，但 C1 把「**分析目标
  闸门**」错误（路径不存在 / 空目录 / 非分析目标）也推进了**同一个** sink ⇒
  数组名不再副实 ⇒ **机器消费者**读 `pathErrors[]` 时会误以为里面全是 `--from`
  路径问题。
  
  口径与 `nudo health`（族 63 · health 面）**同款**，三个动词统一：
  
  - **`pathErrors[]`**：**有序全集**，**字段名 + 内容 + 顺序逐字不变**
    （既有机器消费者零影响；`--json` 的既有场景 stdout 逐字不变）；
  - **`targetErrors[]`**（**新增的可选** JSON 字段）= **分析目标闸门**错误的
    **精确**子集
    - `--from` 路径错误**不**进它（它是**精确入口**，不是副本）；
    - 闸门错误**同时**留在 `pathErrors[]` 里（全集不变 ⇒ 不丢事实）；
  - **无**闸门错误 ⇒ `targetErrors[]` **不出现**（既有场景输出逐字不变）。
  
  覆盖动词：`nudo check --json`（CheckJsonMulti 信封）、`nudo test --json`
  （CaseJson 信封）、`nudo contract --json`（聚合信封的错误条目）。
  **人类面（stderr 文案）逐字不变**。
- a069994: `nudo check` now explains mock-load failures with the suggestion that fits
  the failure, instead of one generic sentence.
  
  - A duplicate `@nudo:mock-module` declaration (`nudo:mock-invalid`) used to
    be answered with "Fix the @nudo:mock expression", which points at the
    wrong problem. It now says to remove the duplicate declaration and keep
    one directive per module specifier.
  - A mock file that does not export the named binding
    (`nudo:module-missing`) used to be answered with "Create the mock file",
    although the file exists. It now names the missing export and the mock
    file path, and suggests adding the export or dropping it from the
    directive.
  - Diagnostics, severities and exit codes are unchanged; only the
    suggestion line differs. `nudo check` and `nudo migrate verify` now use
    the same helpers as the editor and agent surfaces, so all of them report
    the same suggestion for the same file.
- 3ce08ae: fix(nudojs): `migrate strip` 库面改**逐文件错误隔离**（族 56b · Bug 696 的库面半边）
  
  台账里的「`migrate verify` 库面整批 abort」经实测**已不成立**（`migrateVerify`
  早已逐文件隔离：同目标内部分文件语法错 ⇒ 失败文件记 `analysis-error`、成功文件
  照常返回）；仍整批 abort 的是同族的 `migrateStrip`——`planStrip` → `makeStripPlan`
  遇解析错即 `throw` ⇒ **同目标内其它文件的成功结果全丢**（且与 verify 的口径不一致）。
  
  现在解析失败**降级成一行错误**（结构与 `migrateVerify` 的逐文件错误行**同款**：
  `code` + `error`，`error` 带文件名；失败码沿用 verify 的 `analysis-error`，**不另立
  码表**）⇒ 库面与 verify **同口径**：**先算完全部结果（含错误行）⇒ 再决定写不写**。
  
  - **原子性不变**：任一文件失败 ⇒ **整批零写盘**（成功文件也不落盘）——好性质保留，
    没有为「不丢结果」改成部分写盘；写盘模式下成功行会附一条「未写盘」注记
    （防调用方把「计划成功」误读成「已写盘」）。
  - **CLI 面逐字不变**：`nudo migrate strip` 的 stdout / stderr / exit code 与改前
    **逐字相同**（失败详情沿用旧文案 `parse failed: <文件>: <原因>`）；失败目标仍
    判失败（exit 1）、不进 `results`。
  - **成功行的字段逐字不变**（负控：成功行不带 `code` / `error` 键 ⇒ `--json` 的
    成功信封与旧版逐字相同）。
  - ⚠ **仍整批 throw 的两类错误**（未改）：`.tsx` 不可迁移（Bug 583 的产品判定）与
    目标级用法错误（`not found` / 非 TS 源）——它们不是逐文件的解析失败。
- b37321b: The command line now answers the same questions as the editor, and stops
  answering them differently.
  
  - `nudo check` and `nudo health` disagreed about an export that has no
    contract root: the health report counted it, the check report did not
    mention it. The check report now lists it as `nudo:interface-entry-only`.
  - `nudo:mock-invalid` was reported as an error, although the reference says
    it is a warning, and the same file reported it as a warning on another
    path. It is a warning now. The gate itself does not change: an explicit
    contract and the entry-throws rule are unaffected, and a mock file that is
    missing is still an error.
  - `nudo test --from` pointed at a file that could not be parsed or evaluated
    reported nothing and exited successfully, which is indistinguishable from
    "no call sites". The failure is reported and the run exits non-zero.
  - A `package.json` whose `nudo` key is not an object — or is a falsy value —
    was accepted without a word. The check report now says the configuration
    could not be read, and the "this project has no Nudo configuration yet"
    hint is not shown.
  - An import cycle made every file in the cycle report `unknown`. The
    dependency graph is no longer dropped, and a genuinely recursive cycle is
    truncated by the recursion budget instead.
  - The vite plugin never read the path-env load failures, so a
    `@nudo:env ./missing.js` that failed to load was invisible during a build.
    The failure is reported now.
  - An unreadable dependency was described as a missing file.
- 5749924: 族 21 收口接线：把各分片「越界发现」里明确交给**主 agent** 的接线项补齐 ——
  以及一条**真源缺口**（672 的剥除面在 core，不在 CLI）。
  
  **Bug 672 的真源（core `strip-types.ts`）** —— `nudo migrate strip --write` 写出的
  `.js` **Node 解析不了**：`private` / `public` / `protected` / `readonly` /
  `abstract` / `override` / `declare` 这些**类成员修饰符**原样保留，构造器**参数属性**
  （`constructor(private opening: number)`）也原样保留 ⇒ 产物仍是 TS。
  现在：
  - 类成员修饰符被**剥掉**（只在类成员节点上删 —— 这些字段名在别的节点上没有 TS 语义）；
  - 构造器参数属性**降级**成「普通形参 + 构造器体开头补 `this.x = x`」
    （TS 语义 =「字段 x + 构造器里 `this.x = x`」；字段声明不必显式写 ——
    JS 的 `this.x = …` 就是动态字段，语义等价）。Babel 7 的 `TSParameterProperty`
    包装节点与 Babel 8 的「修饰符直接挂在参数上」两种 AST 形态都认。
  
  **Bug 670 的越界（`nudo contract --json`）** —— `runContractPrint` 完全不看
  `opts.json` ⇒ `nudo contract --json` 把人类文本（`<file>` + 每行签名）写进
  stdout ⇒ `JSON.parse(stdout)` 抛错。`--json` 是**机器面** ⇒ 现在 stdout 是
  合法 JSON（`{ file, entries: [{ fn, signature }] }`），人类面不变。
  
  **Bug 1026 的残留（`migrate` 的发现清单）** —— `migrate verify` 的扫描集合此前只
  抄了产品默认安全排除 3 条里的 1 条（`node_modules`）⇒ `dist/` 与 `coverage/` 的
  陈旧构建产物被当源码门禁 ⇒ `migrate verify`（绿）与 `migrate retire` 装上的
  `nudo check .`（红）扫描的文件集合不同。现在补齐 3 条（另排除 `.git` / `.nudo`）。
  
  **Bug 928 的 test 面同机制** —— `nudo test --watch --from` 的调用点证据此前是
  **启动快照**、每轮从不刷新 ⇒ 同一轮里两个文件对同一次调用给出相反裁决，且与同一
  磁盘状态下的全新非 watch 运行结论相反。改为**每轮开跑前重采**（与
  `nudo check --watch --from` 同口径）；本轮证据缺失 ⇒ 本轮红。
  
  **Bug 693 的钉真落在 watch 形态** —— 该钉原先用 `node tsx/dist/cli.mjs <cli> …
  --watch` 起子进程：tsx 的 CLI 会把 `--watch` 当成**自己/node 的旗标**吞掉 ⇒
  子进程的 `process.argv` 里没有 `--watch` ⇒ CLI **根本没进 watch 形态** ⇒ 钉在测
  非 watch 路径（假通过）。改用共享的 watch runner（`node --import <绝对路径的
  tsx loader>` + 显式追加 `--watch`）⇒ 钉真的落在 watch 形态上；runner 另支持
  「等 stdout 里出现一份可解析的 JSON」（谓词**分开**收 stdout / stderr ——
  合并判断会被 stderr 的横幅干扰）。
  
  **Bug 948 的文本面对称** —— 空目标集现在 `ok:false` + 非零 exit ⇒ 文本面**必须**
  有裁决行，否则出现「exit 1 但无 Result / 无 Summary」⇒ 与 JSON 面不对称。
  
  **既有钉的契约适配（2 条）** —— 695（信封 `summary.errors` 不再含路径错误）与
  672（真源修好后命令层闸门不再拦）两处契约变更使既有钉失配 ⇒ 按**新契约**改钉
  （不是回退修复）。
  
  **`nudo init` 的文档漂移** —— 新行为（非法值被替换 / 拒绝遮蔽祖先可继承配置 /
  拒绝越界写容器根）此前未写进文档 ⇒ 同步 `docs/design/cli-semantics.md`、
  `packages/website/docs/guides/cli.md`、`packages/website/docs/api/cli-reference.md`
  （及 zh-Hans 版）。
- 0f67015: fix: 并发 review 收口的 25 条缺陷 + 4 条跨文件尾巴（CI 闸门假红/假绿 · 自相信值 · 机器面口径漂移）
  
  本片是一次**并发 review**（8 个分片）收口的结果：25 条缺陷全部修复，另补
  4 条 worker 报告的跨文件尾巴。核心是**闸门可信度**——`nudo check` 是 CI
  闸门，假红会卡死用户仓库、假绿会让门禁空转。
  
  ### 高危（5 条 · 闸门级）
  
  - **L2 实例方法桥把**构造器**的 throws 归因给方法**（`core/algebra/check-may-throw.ts`）：
    实例桥用 `ctorAnyArgs`（全 `any`）跑构造器 ⇒ 构造器里的强制转换 TypeError
    被算进**方法**的 throws 域 ⇒ 普通类即触发 error 级 `nudo:entry-may-throw`。
    修法：构造器改在**独立 may-throw 会话**里跑（证据隔离、副作用保留）⇒
    构造器的 throws 归因给 `new C()` 入口而非方法；构造器抛时退**裸实例**
    继续求值方法体 ⇒ 方法自身的证据照常收集（闸门不整体关掉）。
  - **`async function*` **声明**体的 `await` 发射成裸 `yield`**
    （`core/algebra/exec/transpile/stmt/statement.ts`）：缺 `stmt.generator !== true`
    守卫 ⇒ 产物是非法 JS ⇒ **整模块 fail-closed** ⇒ 全部导出退 unknown/opaque ⇒
    error 级 `nudo:entry-may-throw` 降成 INFO `nudo:opaque-result`（门禁假绿）。
    修法：与函数表达式 / 对象方法 / 类方法三条兄弟路径对齐。
  - **Proxy `getOwnPropertyDescriptor` 陷阱违反 [[GetOwnProperty]] 不变量**
    （`core/algebra/builtins/object/descriptor.ts`）：引擎照抄陷阱的值 ⇒ 自信的
    错值。修法：以 **node v26.10.0 实测矩阵**（82 例零偏差）反推完整谓词 ⇒
    补齐「靶无该自有键」「可配置性不一致」「不可配置属性的 writable /
    enumerable / value 冻结」「数据 / 访问器描述符不得混报」四档。
  - **`Object.getOwnPropertyDescriptors` 丢 symbol 键自有属性**
    （`core/algebra/builtins/object/methods.ts`）：原生走 `[[OwnPropertyKeys]]`
    **含** symbol 键 ⇒ 结果对象少一个自有属性。附带修正 `builtins/invariants.ts`
    把 gOPDs 列进「只枚举字符串键」的**事实错误**注释。
  - **`Uint8ClampedArray` 元素先截断再钳位**（`core/algebra/builtins/error/binary.ts`）：
    `ToUint8Clamp` 是就近偶数取整、**不**向零截断 ⇒ 改传未截断值。
  
  ### 中危（9 条）
  
  - **`strip-types` 把构造器参数属性赋值插到 `super()` 之前**
    （`core/src/strip-types.ts`）：派生类产物在 `new C()` 时抛 ReferenceError ⇒
    `migrate` 是一程闸门（无回退）且 `node --check` 只验语法 ⇒ 静默写出坏代码。
    修法：按 tsc emit 口径插到 `super(...)` **之后**；找不到顶层 `super(...)` 时
    保持源自身的失败形态并产出一条 note（`nudojs/src/migrate.ts` 侧透出）。
  - **`Object.setPrototypeOf(Object.prototype, null)` 过拒绝**
    （`core/algebra/builtins/object/methods.ts` · `objects.ts`）：按 ES2024
    10.4.1.2（`[[SetPrototypeOf]]` 只在 V **非 null** 时抛）+ node v26 实测
    **放行 null**、仍拒非 null ⇒ 不再与原生/规范冲突（无需登记架构债）。
  - **`Reflect.ownKeys` 的 symbol 键排在字符串键之前**（`core/algebra/builtins/reflect.ts`）：
    按 ES2024 `OrdinaryOwnPropertyKeys` 改两段排列。
  - **`arr` 形参 × `tuple` 实参的 α 绑定只取首元素**（`core/algebra/hof.ts`）：
    异构数组字面量 `[1,"a"]` ⇒ `T := number` ⇒ 返回 `number[]`（**窄于**真实类型）
    ⇒ 把「不知道」升级成「知道」。修法：元素域取全部元素的同型 join，异构退 `any`。
  - **项目级 path env 按「被分析文件目录」解析**（`service/src/check-issues.ts` ·
    `service/src/analyzer-orchestrate.ts` · `lsp/src/validation.ts`）：假阳（报
    不存在的路径）+ 假阴（项目级 env 真实失败被静默丢弃）⇒ 改两层基准
    （项目级按项目根 / 文件级按文件目录），与 CLI 同口径。
  - **`check --json --watch` / `test --json --watch` 的路径错误早退分支打 pretty
    JSON**（`nudojs/src/commands/check-command.ts` · `test.ts`）：破坏 watch 面
    「stdout = JSON Lines」契约（机器消费者第一行即炸）⇒ 三动词统一一行一份 JSON。
  - **`migrate strip --json` 的 `pathErrors[].path` 混用目录 / 文件量纲，且同目标内
    成功文件的逐文件结果被整条丢弃**（`nudojs/src/commands/migrate.ts`）⇒
    逐文件隔离在 CLI 面等于没生效 ⇒ 失败条目改用文件路径、成功行进 `results`。
  - **vite-plugin：工程根含软链时全部源文件被判为「依赖」**
    （`vite-plugin/src/scope.ts` · `index.ts`）：`resolve()`（不解析软链）对比
    `realpathSync()`（解析软链）⇒ 整工程被 skip 且**零日志**（静默空转）⇒
    两侧都取 realpath 再比；root 改为按插件实例持有（同进程第二个 Vite config
    不再覆盖第一个的 root）。
  - **zh-Hans 镜像未跟随 en 更新**（5 个页面）：输出块按真机重抄 + 缺段补齐，并
    **新增机械闸门**（`website/tests/docs-coverage.test.ts` 规则 21：blocks /
    machine / tokens / rows / paras 五档 en↔zh 比对）⇒ 漂移不再静默过 CI。
  
  ### 低危（11 条）
  
  `__nudoLv{N}` 循环槽名改走 `internalTmpName`（`core/algebra/exec/transpile/stmt/statement.ts`）；
  后置条件证据面的 Φ 侧改**同项**判定（`core/algebra/postcondition.ts` · `check-return.ts`）
  ——无关 Φ 不再把「证不出」误判为 `disproved`；
  standard-schema 内联 `__nudoDescribe` 与库函数副本的 `-0` 口径统一
  （`service/src/emit/standard-schema.ts`）；整文件缓存键的「项目级 path env 内容」
  维度按项目根解析（`service/src/analyzer-cache.ts`）；两条新诊断码改用 core 的
  `DIAG` 注册表（`service/src/analyzer-orchestrate-uncached.ts`）；用法错误码三动词
  统一为 `nudo:usage-error`（`nudojs/src/commands/test.ts`）；vite-plugin 无 `line`
  的 issue 不再伪造成 `:1:0`（`vite-plugin/src/check-assembly.ts`）；parser 的文件级
  指令位置闸门补 class / 对象字面量体（`parser/src/directives/file-directives.ts`）；
  LSP 语义 token 降级路径复用 core 的真 lexer 遮罩（`lsp/src/semantic-tokens.ts`）；
  架构债台账条目数 9→10（3 处索引）；`walkAbs` 的 brand 解包补空值守卫
  （`scripts/env-coverage-baseline.ts`）。
  
  ### 跨文件尾巴（4 条 · worker 报告的同源缺口，本片一并收口）
  
  - **core 文本路径的同类位置闸门洞**（`core/algebra/directive-scan.ts`）：
    parser 侧修了 class / 对象体，core 的文本路径是孪生路径、同样漏了 ⇒ 按同口径
    补上（`nestedBodyRanges`）。
  - **`generalize.ts` 的类方法桥**（值域通道）：构造器抛 ⇒ 异常逃出 ⇒ 方法签名退
    unknown + 误导的 INFO `nudo:opaque-result`。`check-may-throw.ts` 反向 import
    `generalize.ts` ⇒ 跨模块复用会成包环 ⇒ 按仓库既有「就地复刻」惯例本地实现
    裸实例兜底。
  - **`nudojs/src/migrate.ts` 透出 `ctorParamPropsSuperMissing` note**：core 已置位
    但用户看不到 ⇒ 补提示。
  - **LSP / service 的项目级 env 预载基准**（见上「中危」条）。
  
  ### 验证
  
  全仓 `tsc --noEmit`（**含测试文件**）0 错误；`pnpm run test` **1756 文件 /
  14515 用例全绿**（exit 0）；`pnpm run build` exit 0；`verify-doc-examples.sh`
  278 checks passed / 0 failed；`coverage:env -- --check` exit 0。25 条缺陷各配
  一条「**修前红 / 修后绿**」的回归测试（新增 24 个测试文件），高危项另在
  **产品 CLI 面**逐条复现核对（与原生 node v26.10.0 逐值一致）。
- 2d96c29: `@nudojs/service` **新增**公开导出 `absolutizeEnvSpec`（env 规格的绝对化入口）
  ⇒ 纯**增量**（additive）⇒ minor。
  
  fix: 并发 review 收口的 10 条缺陷（闸门假红/假绿 · IDE/CLI 口径分裂 · 机器面谎报）
  
  上一片（并发 review 收口 25 条 + 族 65/1094 两轮）之后又做了一轮**并发
  review**（5 个分片 × 只读审查 + 逐条代码层复核）⇒ 查出 **10 条**该轮改动
  引入或遗留的缺陷，本片一次性收口。核心仍是**闸门可信度**：`nudo check` 是
  CI 闸门，**假红**卡死用户仓库、**假绿**让门禁空转。
  
  本片新增 **7 个回归测试文件**（全部含「修前红 / 修后绿」实测），另补 1 个
  残留洞（指令作用域闸门）。
  
  ---
  
  ### 高危（4 条 · 闸门级）
  
  - **构造器 may-throw 证据被整体丢弃且「归因落点」根本不存在 ⇒ L2 闸门假绿**
    （`core/algebra/check-may-throw.ts` · `core/algebra/scan-top-functions.ts` ·
    `core/algebra/check.ts`）：实例方法桥把构造器跑在独立 may-throw 会话里
    （软效果不进方法域 ⇒ 假红已消除），但**硬抛**（无条件 `throw`）也被
    `catch {}` 吞掉；而注释声称"归因给 `new C()` 入口"——**该入口并不存在**
    （`scan-top-functions.ts` 只登记 `Class.method`，跳过 ctor）⇒
    `export class A { constructor(x){ throw new TypeError("boom"); } }`
    在 check 闸门与 test 见证面**双面零诊断**（0 error / 0 warning / exit 0）。
    修法：新增**类导出入口**普查面 `listClassEntryNames`（`new C()` 是真实入口）
    ⇒ 类入口并入 L2 入口表（`check.ts`），构造器的**硬抛**进 throws 域、报在
    **类声明位置**；构造器的**软效果**（any 补位的强制转换）仍不进 ⇒ 普通类
    不触发 error 级 `nudo:entry-may-throw`（假红不回归）。另：类入口的
    `@nudo:throws` 申报落点 = 构造器 scope（`C.constructor`）⇒ 用户已申报不再被卡
    （`declaredThrowsForEntry`）。
  
  - **同一「裸实例兜底」在值域通道产出自信的错值 ⇒ 方法签名折 `never` + 假红**
    （`core/algebra/generalize.ts`）：兜底实例的内层是**空 obj** ⇒ 构造器写过的
    字段被建模成「确定不存在」⇒ `this.v` 读成**确定的 `undefined`**、
    `this.v + 1` 读成**确定的 `NaN`**；`this.v.toFixed(2)` 在**虚构实例**上抛
    ⇒ 签名 **`never`**（谎称"该方法必抛、恒返回 never"）⇒ 连带 **error 级
    `nudo:entry-may-throw`**。修法：兜底实例内层改 **unknown**（构造器写过的
    字段 = **不可知**，不是"缺槽"）⇒ 不折确定错值、不在虚构实例上抛 ⇒ 签名落
    `unknown`，且方法体照常求值（不退化成整体 opaque）。与上一条同源，两处
    **就地复刻**的孪生实现已互相点名，防止再漂移。
  
  - **Proxy `getOwnPropertyDescriptor` 不变量新增规则的 3 处阈值错误 ⇒ 假红**
    （`core/algebra/builtins/object/descriptor.ts`）：上一片新增的
    `enforceProxyGetOwnPropDescInvariant` 在 Object 面与 Reflect 面同时接线，
    三处口径与 node v26.10.0 不符 ⇒ **native 不抛、引擎抛 TypeError** ⇒
    error 级 `nudo:entry-may-throw` ⇒ 直接卡 CI：
    1. **形态一致性检查未以「靶属性不可配置」为前提** ⇒ ES2024
       `IsCompatiblePropertyDescriptor` 只在 `current.[[Configurable]]` 为 false
       时比对数据/访问器形态，引擎无条件抛 ⇒ **可配置**靶 + 异形态陷阱整类误判；
    2. **`frozen` 被当成 `enumerable:false`** ⇒ `Object.freeze` 只改
       writable/configurable、**不改 enumerable** ⇒ 冻结靶 + 诚实报告描述符的
       Proxy 被判违约（同处注释"frozen ⇒ enumerable 全 false"本身是事实错误）；
    3. **靶侧标志/extState 只查「内层 obj」不查「接收者」** ⇒ `defineProperty` 把
       标志记在接收者上（brand 靶记在 brand）⇒ 取不到 ⇒ 回落 `configurable:true`
       ⇒ **陷阱报告与靶完全一致也被判违约**。
    修法：形态比对收进「靶不可配置」分支；`frozen` 不再改 enumerable；靶侧三标志
    统一复用同文件 `currentPropDesc`（接收者优先、内层兜底）。**不可配置**靶 +
    异形态陷阱仍抛（能力未关）。
  
  - **项目级 env 的「两层基准」只做了一半 ⇒ 分析器通道丢 env 全局 / IDE 与 CLI
    结论相反**（`service/src/analyzer-orchestrate*.ts` · `service/evaluator/env-loader.ts`
    · `lsp/src/validation.ts` · `lsp/src/agent-tools.ts`）：上一片把项目级 env
    改为**按项目根**解析，但只改了**预载**侧；**收集期**仍用原始相对名查表，
    而相对说明符只有唯一候选（按文件目录解析）⇒ 与预载登记的 key 不匹配 ⇒
    **只要被分析文件声明了任何 `@nudo:env`（哪怕是内建名 `node`），项目级 path
    env 就对它完全不可见** ⇒ 返回面退 `never` + 假阳 `nudo:builtin-unknown`；
    同时 LSP 的 `env-unresolved` 诊断按「记录时的 preload 目录」归档 ⇒ 项目级 env
    的失败被**静默吞掉**（IDE 假绿，CLI 同刻仍报）。
    修法：绝对化规则收进 `env-loader.ts` 的**单一 helper**（`absolutizeEnvSpec`），
    预载侧 / 收集期 / 缓存键 / LSP 注入 / LSP 诊断**五处共用**；LSP 诊断按
    `fileEnvBaseDir + projectEnvBaseDir` 双取合并去重。改后 IDE 与 CLI 对同一
    文件结论一致。
  
  ### 中危（4 条）
  
  - **`migrate strip --write` 把「未写盘」的成功行报成 `wrote`**（`nudojs/src/migrate.ts`
    · `nudojs/src/commands/migrate.ts`）：库面在有失败时整批零写盘（原子性）并给
    成功行附注记，命令层却把注记行当普通成功行推入 `results`，人类面用
    `opts.write ? "wrote" : "dry"` **无条件**打 `wrote` ⇒ 同一行既说 "wrote"
    又说 "not written"，而磁盘上根本没有 `.js`；`--json` 侧只有一条自由文本
    `notes` 能区分 ⇒ 机器消费方极易误判已产出。修法：新增机器可判定的
    **`writeStatus`**（`"written"` / `"not-written"` / `"planned"`），人类面按逐行
    状态措辞（`wrote` / `not written` / `dry`）。
  
  - **HOF 元组元素域把**已知**的 null/undefined 压成 `any`**（`core/algebra/hof.ts`）：
    引擎把 `null`/`undefined` 建模成 **`unknown` 形状 + lit 项**，而元素域按
    **shape kind** 判"域是否可知" ⇒ 把**已知**类型误判成"域不可知" ⇒
    `[null]` 的元素域从 `null` 退成 `any`、`[1,null]` 退成 `any`（应为
    `number | null`）；`any` 是"自信的任意值"，参与算术即强制转换 ⇒ 记
    may-throw ⇒ L2 假红面。修法：三分类——已知 nullish（不参与异型判定、只贡献
    可空性，用仓内既有 `makeSum` 表达联合）、真·推断失败（退 **`unknown`**，
    不是 `any`）、其它（同型判定不变，异型仍退 `any`）。
  
  - **文件级指令的作用域闸门未覆盖 `ArrayExpression` / `ObjectPattern` / `ArrayPattern`**
    （`parser/src/directives/file-directives.ts` · `core/algebra/directive-scan.ts`）：
    写在数组字面量 / 解构模式里的 `@nudo:env` 被**静默提升**成整文件生效（零诊断，
    越权）。修法：两侧孪生闸门同步扩到三类嵌套体（两通道 23 组样例逐例一致）。
  
  - **引理账本写入是「死写」**（`core/algebra/check-return.ts`）：Φ 侧的消费在
    证明段里记进账本，而调用方传入的 `consumedAssume` 快照取自**调用之前** ⇒
    Φ 侧的写入永远读不到 ⇒ 账本与归因两套口径（changeset 宣称的"经
    `noteAssumeConsumed` 记进账本 ⇒ 归因可见"实际断在取数时序上）。
    修法：归因集**就地取账本**（读在写之后）⇒ 账本是"消费过"的唯一事实源，
    调用方快照退化为兜底。
  
  ---
  
  ### 验证
  
  - 全仓 `tsc --noEmit`（`pnpm run lint`）**0 错误**；`pnpm run build` exit 0；
  - `pnpm run test` 全量绿（**1757+ 文件 / 14500+ 用例**，exit 0）；
  - 新增 8 个回归测试文件，全部**修前红 / 修后绿**实测（红数由**回滚修复**逐条复核）：
    `core-bug-1095`（Proxy 阈值，22 例 · 修前 12 红）、`core-bug-1096`（构造器
    归因，11 例 · 修前 6 红）、`core-bug-1097`（HOF 元素域，15 例 · 修前 10 红）、
    `core-bug-1102` + `parser-bug-1101`（指令闸门，79 例 · 修前 12 红）、
    `core-bug-1103`（引理账本，5 例 · 修前 1 红）、`service-bug-1098` +
    `lsp-bug-1099` + `lsp-bug-1104`（env 两层基准，11 例 · 修前 6 红）、
    `nudojs-bug-1100`（migrate strip 写盘状态，6 例 · 修前 5 红）—— 合计 **149 例**；
  - 产品 CLI 面逐条复现核对：`nudo check` 对"构造器必抛"报 **error 级
    `nudo:entry-may-throw`（归在类入口）**、对"构造器软 throw"**零 error**；
    Proxy 三场景（可配置靶异形态 / 冻结靶 / brand 靶）**零 error**；
    `migrate strip --write` 失败批输出 **`not written`** 且磁盘**零写盘**、
    `--json` 带 **`writeStatus: "not-written"`**；项目级 env + 文件级 env 并存时
    `nudo check` 得 `f() => 42`（修前为 `never` + 假阳）。
  
  ### 已知边界 / 未闭合
  
  - **Proxy `gOPD` 仍有 3 处漏抛**（靶不可扩展且键不存在时报 `configurable:true`；
    靶不可写+不可配置而陷阱省略 `value`；靶为不可配置访问器且 get/set 身份不同）——
    **基线同样不抛**（非本次回归），新增抛点有制造新假红的风险 ⇒ 已把 node v26.10.0
    实测矩阵写进 `core-bug-1095` 测试文件注释，留待单独立项。
  - **不可配置访问器靶现在也会比对 `enumerable`**（原生确实抛）——属**收紧**，
    若有用例依赖旧的"访问器靶跳过该比对"需按原生重判。
  - **HOF 异型元素仍退 `any`**（`[1,"a"]`）——既有保守口径，本片未窄化成联合。
  - **真·未知 ⇒ `unknown`** 会让该 α 恰为返回类型时多一条 **warning 级**
    `nudo:unknown-inference`（级别 warning，不影响 L2 闸门）。
  - **进程级 `lastEnvBaseDir` 单槽**（同步 `analyzeFile` 路径下的**文件级**相对名）
    与 **Windows 下 `isPathEnvName` 只认 `/`** 均为既有基线，本片未动。
  - **MCP `nudo check` 工具面**（同步、无 path env 预载）与 **`migrate strip --json`
    顶层形态不统一**（成功=裸数组 / 失败=对象信封）仍待单独立项。
- 2af2bae: `nudo check` now sees assignments inside function bodies, judges generated
  segments against cross-file call sites, and points diagnostics at the
  offending directive.
  
  - `nudo:assign-mismatch` only covered module top-level assignments: the
    assignment recorder was installed around the top-level evaluation, but
    function bodies had already been evaluated (by the generalizer) before
    that, so every `$assignRecord` from a function body was dropped. Real
    code assigns mostly inside functions, so the check reported "OK" on
    functions that assign a string to a number. The recorder is now installed
    before the function loop, and repeated evaluations of the same assignment
    site are folded into one diagnostic.
  - `nudo:interface-drift` never fired when the call site lived in another
    file: the "today" evidence came only from evaluating the checked file
    itself, so a generated segment written with `--from` could not be judged
    stale. `CheckOptions.from` now carries cross-file call-site records into
    the same judgment; records are attributed to the checked file, so a
    same-named function in another module cannot pollute the verdict.
  - `nudo:assume-invalid`, `nudo:invariant-invalid`, `nudo:contract-syntax`
    and `nudo:interface-conflict` carried no position: the LSP drew the red
    squiggle at line 1 column 1 and `nudo check --json` reported
    `issues[].line: null`, even when the offending directive was on line 7.
    All four codes now report the line and column of the directive that
    caused them.
- e59c991: Type renderings no longer read as the wrong type, and `nudo check --what-if
  --target` prints a real return domain instead of `?`.
  
  - A function type inside an array or a union is now grouped with
    parentheses. `formatShape` rendered an array of functions as
    `(number) => number[]`, which TypeScript reads as "a function returning
    `number[]`" rather than "an array of functions", and rendered a union of a
    function and a number as `(number) => number | number`, where the `|` binds
    to the function's return type. The `.d.ts` renderer already grouped both,
    so the two renderers disagreed about the same abstract value. Function
    members and function elements are now parenthesized; other member kinds are
    unchanged.
  - `nudo check --what-if --target <function>` printed `() => ?` for the
    targeted function: the top-level binding's abstract value carries no
    return type, while the signature table reads a different abstract value.
    The target now takes the function's real return domain, so the two faces
    agree; the `?` placeholder itself is unchanged.
- e59c991: String unions are now concatenated member by member, and generated line
  comments no longer carry a block-comment escape.
  
  - A value that is one of several string literals was concatenated as if the
    literals were one piece of text. `("a" | "b") + "!"` was reported as the
    single string `"ab!"` — a value no call can produce, because the real
    answers are `"a!"` and `"b!"`. The same happened to `` `v=${x}` ``, which
    was reported as `"v=ab"`. A union now keeps its members apart while it is
    converted to text, and the two sides are combined member by member, so the
    result is the union `"a!" | "b!"`.
  - The comment cleaner escaped the end of a block comment everywhere it was
    used, including inside `//` line comments, where it has no meaning. The
    contract draft printed by `nudo contract --draft` — the text a user is
    asked to copy into the sidecar — showed `/* no evidence — tighten *\/`
    instead of `/* no evidence — tighten */`. Line comments now keep the text as
    it is; a line break inside a comment is still flattened, so a comment can
    never spill out of its line. Block comments (the JSDoc in the emitted
    `.d.ts`) still escape it, because there the escape is what keeps the
    comment from ending early.
  
  - **Member results are combined with the engine's existing "same primitive"
    rule** (`joinValues`), not as a raw union. Two *literal* members still form an
    enumeration (`"a!" | "b!"`), but a literal combined with a same-primitive arm
    that carries no narrowing evidence collapses to that primitive — the same
    rule the rest of the algebra uses. Without it, a union member whose rendering
    is already `string` would sit next to a literal and print as
    `"NaN days" | "NaN day" | string | …`: harder to read than the type it
    describes, and inconsistent with the signature the same function has
    everywhere else (`formatAge(durationMs: number) => string`).
- e59c991: `nudo check --json` no longer ships the engine's internal variable ids, and its
  signatures now match the ones printed on the terminal.
  
  - The machine-readable signature fields rendered the abstract value's `term` /
    `pred` unconditionally. Those terms mix in the engine's internal variable
    ids (`len#0`, `len#2`, …), which are minted by a **process-wide counter**, so
    the id a file got depended on the file's position in the command line.
    Checking three identical files gave `len#0` / `len#2` / `len#4`, and swapping
    the order swapped the ids — the JSON payload of a single file was a function
    of its argument position rather than of its contents. The internal ids are now
    replaced by a **stable name** (`len#2` → `len`), so the abstract term and
    predicate evidence survives while the drifting number is gone.
  - `signatures[].display` is now rendered with the same `formatShape` projection
    the terminal uses, so the machine face and the human face of one command
    agree: `nudo check` prints `f() => number` while `--json` used to report
    `number = len#0 where len#0 ≥ 0 #path` for the very same function. The
    confidence marker and the branch-join note are still available — through the
    `conf` field and the `detail` / `abs` fields.
- 5dd89ca: fix(nudojs): `migrate strip` 的产物面事实回报 + 兜底闸门扩围（族 12 S2）
  
  族 12 的六条缺陷（445 / 446 / 447 / 448 / 913 / 968）的**根因**全部在
  `@nudojs/core` 的 `strip-types.ts`（已由 S1 修好）。本片只做**产物面**：
  
  - **`migrate strip` 的 notes 跟事实**（`stripTsToJs`）：notes 现在基于
    `stripTypes` 的 `report` 事实回报，而不是「enum 被删」这一过时口径 ——
    运行时 enum 现在是**被合成**（不是被删除）⇒ note 改成「已合成运行时对象」，
    不再误报「runtime semantics lost」。另补：`export =` / `export as namespace`
    被剥除（CommonJS 出口面消失）、`this` 形参被剥除、类型专用 import 被消掉
    （tsc 同口径）、保守保留的 import（本地再导出 / 包说明符 / 未引用 ⇒ 产物
    可能链接失败）与「指令条数前后不一致」的提示。
  - **兜底闸门扩围**（`migrate strip` 写盘前的「产物可解析性闸门」）：除
    `TSParameterProperty` 与 4 个类成员修饰符 flag 外，新增认得
    `export =` / `export as namespace`、类成员的 `x!` / `y?` / `m?()`、TS 的
    `this` 形参。**零误伤**：这些判据在纯 JS 源码里零命中（TS-only 节点类型 /
    TS-only 字段 / `this` 不是合法形参名）。
  - **六条产物面回归钉**（`packages/nudojs/src/__tests__/cli-bug-445|446|447|
    448|913|968-migrate-strip-*.test.ts`）：产物必须 `node --check` 过、
    指令必须存活、门禁行为正确（源红 / 产物**同样红**，不再假绿）。
  
  `migrate verify` 的语义**未改**（它的契约是「跑 `nudo check`」）；`nudojs` 的
  公开导出面**零新增**。
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
- e5b3f38: 族 16 修复 M1：Bug 570 / 579 / 943 / 966 / 967 / 924 / 580 / 1005 —— tsc 的**检测口径与改写口径统一**（版本钉住 `tsc@5.4.5`、路径限定型 `./node_modules/.bin/tsc`、非命令位的 `tsc` 旗标值/描述文字），CI workflow 改写改为 **YAML 语义**（只认 `run:` 标量、引号标量不再漏改、块标量跨行命令不再被拆坏），tsc argv 解析认识 `${{ … }}` / `$( … )` / glob，不再写出必然红的门禁命令。
- e5b3f38: 族 16 修复 M3：Bug 581 / 584 / 597 —— `nudo migrate` 的 workspace 包枚举改为真 glob：对象式 `workspaces`（`{ packages: [...] }`）不再被静默丢弃（子包在 status 与 `retire --all` 里可见并被真正退役）；pnpm 负向模式 `!packages/legacy` 真的排除该包（不再被 `retire --all` 改写 / 删依赖 / 写 marker）；`packages/**` 与多段 pattern（`packages` 目录下两层 `*`）能发现嵌套成员（不再「nothing to retire」假绿）。被排除 / 未匹配的包通过 stderr 显式说明。
- e5b3f38: 族 16 修复 M4：Bug 574 / 575 / 583 / 585 / 587 / 591 / 592 / 596 / 917 / 923 / 969 —— `nudo migrate strip` 的**写盘面**修好：两阶段（先算完再写）+ 事务写盘 ⇒ 语法错文件不再留下半写状态，错误信息点名文件；写目标前检测既有同名 `.js` ⇒ 不再静默覆盖手写 JS（`--backup` 时先备份）；`--backup` 撞名改用 `*.1.bak` 并在输出里交代，不再静默跳过；侧车草稿落在**草稿路径** `*.nudo.draft.js`（不再冒充正式侧车 `*.nudo.js`）；产物的相对模块说明符按真实文件补成显式扩展名（`./helper` → `./helper.js`）；notes 改为**基于 AST 事实**（注释 / 字符串里的 "enum" / "namespace" 不再误报）；`.cts` 产物不再谎称 CommonJS；`.tsx` 明确拒绝（strip 不做 JSX 变换，不再产出 Node 加载不了的 `.jsx`）；单文件路径与目录路径走同一条侧车迁移逻辑（既有 `*.nudo.ts` 一并迁到 `*.nudo.js`，产物契约不丢）；目录级分析按**模块**计数（源 `.ts` 与产物 `.js` 是同一模块，不再翻倍）。
- e5b3f38: 族 16 修复 M5：Bug 567 / 576 / 578 / 586 / 595 / 920 / 1006 / 1028 —— `nudo migrate retire` 的退役面、审计记录与作用域：
  
  - **没有可退役的东西就不写盘**（567）：既无 `typescript` 依赖、又无门禁角色 tsc 脚本的包，`retire` 现在报「nothing to retire」并**零写盘**（此前仍写 `.nudo/migrate-retired.json` 并注入 `check:nudo`，`migrate status` 随后把它标成 `[retired]`）。
  - **二次运行不再擦掉审计记录**（576）：`.nudo/migrate-retired.json` 与既有记录**合并**（并集 + 保留首次 `retiredAt`），此前第二次运行把 `removedDeps` / `rewrittenScripts` / `rewrittenWorkflows` 清空并改写 `retiredAt`。
  - **注入真的落盘**（578）：`check:nudo` 注入写回 `pkg.scripts`（此前只改了局部副本 ⇒ 落盘文件里根本没有 `scripts` 键，CLI 输出与审计记录却都谎报「已改写」）。
  - **编译脚本不再被换成门禁**（586）：只改写**门禁角色**的脚本（`--noEmit` / 裸 tsc）；`build` / `compile` / `bundle` / `emit` 等构建角色与带发射语义旗标（`--outDir` / `--declaration` / `-b` / `-p` 无 `--noEmit`）的脚本**原样保留**，并在结果与审计记录里列出（`preservedScripts`）；这类脚本仍需 tsc ⇒ `typescript` 依赖相应保留（摘掉它 build 当场坏掉）。只有编译脚本的包明确拒绝退役并说明原因。
  - **多目标全退役或全报错**（595）：新增 `migrateRetireMany(paths)`（原子；任一目标失败 ⇒ 整批零写盘），CLI 侧需把 `targets[0]!` 换成 `targets`（见交付报告）。
  - **workflow 改写作用域限定在被退役包**（920）：退役子包只改写**该包自有**的 `.github/workflows`，仓库根共享的 workflow 属于整仓作用域，不再被静默替换成 `npx nudojs check .`。
  - **`retire --all` 包间原子**（1006）：整批先规划后统一提交，第 N 个包失败 ⇒ **前 N−1 个包也不落盘**（此前已提交的包留在仓库里而错误消息不点名）；错误消息点名本批涉及的包。
  - **同键同型**（1028）：stdout `--json` 报文与落盘 marker 的 `rewrittenWorkflows` 现在都是 `{file,from,to}` 对象数组（此前 stdout 是对象数组、marker 是路径字符串数组），审计记录不再丢掉 CI 改写的前后内容。
- e5b3f38: 族 16 修复 M6：Bug 566 568 569 582 589 593 —— `migrate verify` 与 `nudo check` 判定同源（文件筛选排除侧车/`.d.ts`、分析注入带模块图与 mock）、`--json` stdout 只放 JSON（人工报告走 stderr）、批量目标 per-file 隔离（语法错不再整批中止）、`--with-tsc` 基线真的加载 tsconfig 并按文件切分诊断、空目录判红（不再静默 exit 0）。
- 169ed52: `nudo check` no longer bails out early on a flag combination, and the JSON
  machine face now reports usage errors inside the same envelope as every other
  failure.
  
  - `--fix` combined with `--json` / `--abs` / `--gha` / `--gitlab` / `--watch` /
    `--verbose` / `--from` / `--what-if` used to abort with a bare usage string,
    so a CI job that combined two flags got no machine-readable answer at all.
    The combination is now rejected through the normal JSON envelope
    (`ok: false` plus a `pathErrors` entry carrying the machine code
    `nudo:usage-error`), and the process exit code is decided only by `ok`.
  - `--dry-run` combined with `--write` used to run the write path, so a
    supposedly read-only invocation still mutated files on disk. The dry-run
    flag now wins, and the write path is not entered.
  - `--watch` together with `--json` used to fall back to the human face and
    print a second, different report. The JSON face is now honoured in watch
    mode as well (`jsonFace` is an optional field, so the existing callers are
    unaffected).
- 169ed52: `nudo check --gitlab` and the disk cache no longer lose or duplicate results.
  
  - `--gitlab` annotations were emitted a second time on stdout in addition to
    the collected rows, so a CI log carried the same finding twice. When the
    caller collects the rows, they are no longer printed as well.
  - A run that produced both a per-file result and a whole-project result
    entered the disk cache twice under two different keys, so the second entry
    could be served for the first one's input. Both entries now collapse into a
    single cache entry.
- 169ed52: `nudo check` and `nudo check --fix` now analyse the same program, and the gate
  no longer accepts TypeScript-only syntax in a `.js` file.
  
  - `nudo check --fix` fed the analyzer a different input set than `nudo check`:
    the auto-bind setting, the project directory and the injected modules were
    missing, and the mock environment was not assembled. A project could pass
    the gate and still be reported as broken by `--fix`, or the other way
    around. Both commands now build their analyzer input through one shared
    constructor.
  - `--fix` also materialised plans for findings that had been downgraded to a
    warning, so a diagnostic that no longer blocks the gate still wrote a
    sidecar into the user's repository. Only error-level findings are
    materialised now.
  - A `.js` file containing TypeScript-only syntax (`private x = 0`, `x as T`)
    was parsed happily, so the gate reported success on a file that Node cannot
    even load. The parser now picks its plugins from the file extension, and the
    check face reports the syntax error instead.
  - A project-level path environment (`package.json#nudo.env`) was resolved
    relative to the analysed file rather than to the project root, so a
    subdirectory file could not find the environment it declared.
  - Environments are merged with the harvested ones under the same precedence
    the test and service faces use, so a harvested export that does not collide
    with a handwritten environment is no longer dropped.
- 169ed52: `nudo check` no longer loses a failing input, misreports the gate tier, prints
  an unappliable diff, or stays green on a broken sidecar.
  
  - An input file that exists but cannot be read (permissions, I/O) escaped the
    command as a raw `EACCES` message. With `--json` the command printed
    nothing at all, so a CI job got an empty stdout and a non-zero exit code
    without a machine-readable reason. The failure is now reported as a path
    error (`nudo:path-io`) inside the usual JSON envelope, and the human face
    prints the reason plus a `fix:` hint.
  - The warning about an unknown `package.json#nudo.check.profile` always said
    `using default strict`, even when an explicit `check.entryThrows` (or a CLI
    flag) had put the gate into a different tier. The message now names the tier
    that is actually in effect, so it can no longer contradict the report.
  - `nudo check --fix` printed its own `---`/`+++` header in addition to the
    header of the unified diff, polluted the `+++` path field with the
    `[fix] …` explanation, and used absolute paths (which produced `a//…`).
    The diff now has a single header with a relative path, exactly like the
    sibling `nudo test --freeze --dry-run` output, and can be consumed by
    `git apply`.
  - A sidecar that imports something that is not a constraint builder (for
    example `import { totallyBogus } from "@nudojs/core"`) was diagnosed while
    the sidecar was executed, but the diagnosis was dropped as soon as the
    execution result was cached. Because the analyzer runs before the gate, the
    gate itself never saw it: `nudo check` reported success and exited 0 on a
    sidecar that could not be loaded. The diagnosis is now cached together with
    the execution result and reported again on every cache hit, so the gate
    reports `nudo:interface-load` and turns red.
- 169ed52: Two reported `nudo check` defects were already fixed by earlier releases; this
  change only adds regression pins that keep them fixed.
  
  - A string in `package.json#nudo.env` is rejected with a shape warning and the
    environment list is ignored; it is no longer expanded character by character.
  - A cycle in the module graph no longer discards the whole dependency graph,
    so a cyclic and an acyclic project produce the same result.
- 169ed52: `nudo check <callee> --from <caller>` now closes the loop on call sites that
  live inside a function body, arrow function, or method body.
  
  The `--from` usage-site files were handed to the checker only as executed call
  records. A call site that had never been executed — for example one wrapped in a
  function body — produced no record at all, so the callee's gate stayed green
  while checking the caller alone reported the very same violation. The usage-site
  file paths now reach the checker as well, and the call-site obligation is
  re-checked with the same criterion the single-file channel uses, so both
  channels report the same code for the same fact.
  
  - `nudo check <callee> --from <caller>` now exits 1 with exactly one
    `nudo:interface-domain-exceeds` for a call site wrapped in a function body;
    before this change the same command exited 0.
  - Checking the caller directly is unchanged: it still reports exactly one
    `nudo:constraint-violated`.
  - A call site that is reported by both channels is still reported only once.
- 02aa122: fix(nudojs): `nudo contract --draft` 的 dry-run 面（打 unified diff）+ `--json`/`--write` 显式互斥 + 项目根判据按路径分量
  
  族 20 · 片 B（660 / 663 / 665）。
  
  - **Bug 660 —— `--draft --write --dry-run` 不打 unified diff**（只打一行
    「[dry-run] would write → …」），而 CLI Reference 承诺 `--dry-run` =
    "Print a unified diff instead of writing"。同一个 `--dry-run` 旗标在
    `--emit` 与 `--draft` 两条分支上语义不同。现在 `--draft` 分支**复用
    `--emit` 分支的同一个 diff 生成器**（`unifiedDiff`，已在
    `@nudojs/service/emit` ⇒ 零新增导出），对照面是**既有草稿文件**的磁盘内容
    （与 `--draft --json` 审阅面同款口径），diff 头与 `--emit --dry-run` 同形
    （`--- a/<path>` / `+++ b/<path>`）；dry-run 仍然**不写盘**。
  - **Bug 663 —— `--draft --json --write` 静默丢弃 `--write`**（`--json` 分支
    早退 ⇒ 写盘分支不可达）⇒ 草稿根本没落盘、exit 0、零提示 ⇒ **假绿 + 静默
    数据丢失**。现在 `--json` 与 `--write` **显式互斥**：
    `error: --write cannot be combined with --json` + **exit 1**，机器面仍给出
    一份合法 JSON 载荷（`{file, errors:[{code:"nudo:usage-error"}]}`，由命令层的
    跨文件聚合层收进恒定数组外壳）。
  - **Bug 665 —— 项目根边界用 `rel.startsWith("..")` 判逃逸** ⇒ 项目根下的
    **合法目录名**（`..data/` / `...cfg/`）与**合法文件名**（`..data.js`）被误判
    成「越出项目根」⇒ 草稿**拒写**（exit 1），而同一项目里的普通文件正常写出。
    判据改成**按路径分量**：「整段等于 `..`」或「以 `..` + 路径分隔符开头」或
    「跨盘（绝对路径）」——CLI 半（`nudo contract --draft --write`）与 service 半
    （`writeInterfaceDraft` 的写盘守卫）**逐字同款**；真正越出项目根的路径**仍被
    拒**。
- 02aa122: refactor(nudojs): `nudo contract` 的三个分支函数拆到同包内部模块（**行为零变化**）
  
  族 20 · S0（串行前置重构）。`packages/nudojs/src/commands/contract.ts` 里
  按分支天然分块的三个函数，搬到**同包内部模块**：
  
  - `runContractDraft` → `packages/nudojs/src/commands/contract-draft.ts`
  - `runContractEmit` → `packages/nudojs/src/commands/contract-emit.ts`
  - `runContractFromDts` → `packages/nudojs/src/commands/contract-from-dts.ts`
  
  `contract.ts` 只保留 `registerContractCommand`（**唯一导出**）+ `runContractPrint`
  + action（含 per-root 循环）。
  
  - **函数签名逐字不变**（参数、返回类型、行为全部不变）；函数体逐字搬移。
  - **零新增公开导出**：`packages/nudojs/src/index.ts` 一行未动；`nudojs` 的
    `exports` 仍只有 `"."` ⇒ 三个新模块**不在公开面上**。
  - **行为零变化**：同一批夹具（`nudo contract` 的 print / `--json` / `--draft` /
    `--draft --json` / `--emit` / `--emit --dry-run` / `--from-dts` 七个形态）
    改前 / 改后各跑一遍，**stdout / stderr / exit code 逐字零差异**。
- 3432d8c: `nudo test`: one failure channel for the machine face, one conclusion for
  "this file has no functions", and the flags the help text promises are now
  actually accepted.
  
  - **Bug 650 — a syntax error was reported as a bare message with no file
    name, and `--json` printed nothing at all.** The Babel parse error
    escaped `runTest` up to the top-level catch, which printed only
    `err.message` (no path, no `line:column`, no source excerpt), and the
    `--json` serialization point sat *after* the throw ⇒ stdout was 0 bytes
    and `JSON.parse(stdout)` threw. `nudo test` now reuses the syntax-error
    branch of `nudo check`: the human face gets a tsc-style block (path +
    `line:column` + source excerpt + `^` caret) and the `--json` face gets
    the same CaseJson envelope as every other failure, with
    `pathErrors[{code:"syntax-error"}]`.
  - **Bug 652 — `nudo test --abs` exited 1 on a file that declares no
    function, while the same command without `--abs` exited 0.** The `--abs`
    face borrowed `runAbsView`, which treats "this file has no functions" as
    a usage error (`Function not found` + exit 1) — that is the *intended*
    behaviour of `nudo check --abs` (Bug 669) and is left untouched. Inside
    `nudo test` the observation face is now skipped when the file declares no
    function, so both faces print the same report and exit with the same
    code.
  - **Bug 653 — `--exit-on-diff` was silently ignored without `--freeze`.**
    The precondition check lived *inside* the `if (opts.freeze !== undefined)`
    branch ⇒ without `--freeze` the flag was swallowed and the command
    exited 0, which turns a CI gate into a no-op. The check now runs before
    the branch, so `--exit-on-diff` without `--freeze` is a usage error
    (exit 1) — the same stance `nudo contract --exit-on-diff` takes.
  - **Bug 654 / Bug 656 — `--help` promised `--freeze` modes `update | add`,
    but `--freeze=add` was rejected with exit 1.** The help text and the flag
    parser had each been written on their own. The parser now accepts
    `--freeze=add` (identical to omitting the value), and the error message
    for an invalid value lists the same set of legal values as the help.
  - **Bug 919 — `nudo test --abs` swallowed the whole diagnostics section.**
    The predicate that decides whether diagnostics are printed excluded the
    `--abs` face ⇒ a wrong expectation (`=> 42x`) produced *zero* hints on
    screen while the assertion failed. `--abs` no longer excludes
    diagnostics, so the default, `--json` and `--abs` faces report the same
    number of diagnostics for the same file. `nudo check --abs` keeps its
    existing shape.
  - **Bug 957 — `--json` usage errors produced an empty stdout plus a
    non-zero exit.** Every usage-error branch of `nudo test` (missing path,
    `--json` + `--abs`, `--json` with several files, `--freeze` + `--json`,
    the variadic `--from` swallow) wrote to stderr and returned before the
    machine face could be produced, while the *path* failures of the very
    same verb did produce a proper envelope ⇒ two failure channels, two
    machine shapes. Usage errors now go through the same CaseJson envelope
    (`pathErrors[{code:"usage-error"}]` + exit 1); the human-readable text of
    the non-`--json` face is unchanged.
- 3432d8c: `nudo test --watch` no longer swallows a failed file, and `nudo test --from`
  no longer lets an unresolvable import pass silently.
  
  - **Bug 926 — `nudo test --watch` kept the gate green when a file failed to
    analyze.** The shared watch loop (`startWatch`, used by the `check` /
    `test` / `health` watch faces) caught the exception thrown by a single
    file, printed one stderr line and moved on — without ever setting a
    non-zero exit code. The watch face was therefore the only place where a
    broken file stayed green: `nudo check --watch`, `nudo health --watch` and
    the non-watch `nudo test` all exit 1 on the same directory. The per-file
    catch now marks the round red (`process.exitCode = 1`), in the full round
    and in the incremental round alike, matching the exit-code semantics the
    same file states ("the exit code is the gate state of the most recent
    round"). A broken file still does not abort the round — one bad file must
    not stop the others from being analyzed.
  - **Bug 1060 — `nudo test --from <callsite>` silently accepted a callsite
    file whose imports do not resolve.** Importing a module that does not
    exist, or a name the module does not export, evaluated successfully (the
    lenient loader stubs out the unresolved import) but the call sites were
    lost: the command printed no `call@` record, fell back to `entry@`, and
    exited 0 — a false green, because the user believes the call sites were
    verified while nothing was. Syntax errors and top-level throws were
    already reported (that was the half of the previous fix); module
    resolution failures are now reported the same way. The callsite probe
    asks the engine for the module-graph issues it already computes
    (`missing` / `missing-export` / `unreadable` / `json-invalid` — the same
    set the main analysis channel reports as `nudo:module-missing`), and a
    callsite file that carries one is reported as a callsite load failure
    (`nudo:path-missing-callsite`) with a non-zero exit code. The probe now
    runs for every callsite file, not only for the ones that produced zero
    records: an unresolved import produces a record pointing at a function
    that does not exist, so the record count alone never revealed it.
- 3432d8c: nudo test: 补一条**反向回归钉**，锁住「声明式 `@nudo:case` 不得因名字前缀被丢出断言面」。
  
  本片**零实现改动** —— Bug 651 的引擎侧根因已由族 14/15 的收口提交 `dde4b037` 修掉：
  synthetic 判据已从**名字前缀**（`name.startsWith("call@") || name.startsWith("entry@")`）
  改成**来源**判据（`c.source !== "directive"`，CLI 面 `packages/nudojs/src/run-test.ts`
  与平行副本 `packages/service/src/test-report.ts` 同改）。本片只补钉，把「已修」的
  行为钉住 ⇒ 防止将来有人把判据改回**名字前缀**。
  
  新钉 `packages/nudojs/src/__tests__/cli-bug-651-declared-case-name.test.ts`（5 例，
  只钉**语义**、不钉汇总行字面量）：
  
  - 声明式见证 `@nudo:case "call@L42" (2) => 5`（实得 4）⇒ 计入失败、**exit 1**、
    报告面出现 `[FAIL]` 行（旧行为：被当成 synthetic ⇒ 断言面「0 failed」、**exit 0**，
    而诊断面同时报 `nudo:case-expected` error ⇒ 报告自相矛盾）。
  - 同一形状的 `entry@L42` 前缀变体 ⇒ 同上。
  - `--freeze` 写回形态的名字（`call@<file>:<line>`）⇒ 同上（这正是来源判据的原始动机：
    写回的见证**写在源码里** ⇒ 已声明）。
  - **同名对照**：普通名字（`myCase`）的失败断言行为与前缀变体**完全一致**。
  - 期望相符的 `call@L42` ⇒ 计入通过、**exit 0**（不是 `unchecked`、不是 synthetic）。
  
  实测：钉子在 HEAD 只读副本上**通过**（5/5 ⇒ 假阳性钉在 HEAD 上通过）；
  把副本里的判据改回名字前缀后 **4/5 失败**（只有普通名字的对照例仍通过）
  ⇒ 钉子确实能抓住「判据改回名字前缀」这一回归。
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
- Updated dependencies [97f28ed]
- Updated dependencies [e2880fd]
- Updated dependencies [5c750f2]
- Updated dependencies [4d1a249]
- Updated dependencies [af09752]
- Updated dependencies [fcaa9e9]
- Updated dependencies [7fea13a]
- Updated dependencies [9ccffb3]
- Updated dependencies [e9fdaa7]
- Updated dependencies [cc9b638]
- Updated dependencies [2688251]
- Updated dependencies [7fea13a]
- Updated dependencies [a1c093f]
- Updated dependencies [9f26414]
- Updated dependencies [1caec28]
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
- Updated dependencies [b0878e3]
- Updated dependencies [a069994]
- Updated dependencies [493b8c2]
- Updated dependencies [d7ae28a]
- Updated dependencies [edc7590]
- Updated dependencies [5c750f2]
- Updated dependencies [ed4d259]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [b4768ca]
- Updated dependencies [1b08a18]
- Updated dependencies [b4768ca]
- Updated dependencies [5fd3cbb]
- Updated dependencies [5fb8a51]
- Updated dependencies [e20c128]
- Updated dependencies [abff33b]
- Updated dependencies [e3b8791]
- Updated dependencies [5c750f2]
- Updated dependencies [c80456a]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [f87c9f9]
- Updated dependencies [27a795e]
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
- Updated dependencies [02aa122]
- Updated dependencies [3432d8c]
- Updated dependencies [3432d8c]
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
- Updated dependencies [aa23265]
- Updated dependencies [535adcd]
- Updated dependencies [5c750f2]
- Updated dependencies [535adcd]
- Updated dependencies [e3b8791]
- Updated dependencies [b6abab4]
- Updated dependencies [356172a]
- Updated dependencies [ebe909e]
- Updated dependencies [e3b8791]
- Updated dependencies [a069994]
- Updated dependencies [b37321b]
- Updated dependencies [b37321b]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [b37321b]
- Updated dependencies [b37321b]
- Updated dependencies [106ad1d]
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
- Updated dependencies [8542f44]
  - @nudojs/core@1.16.0
  - @nudojs/service@1.10.0
  - @nudojs/env@0.5.3
  - @nudojs/parser@1.5.3
  - @nudojs/harvester@0.4.3

## 1.6.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/env@0.5.2
  - @nudojs/harvester@0.4.2
  - @nudojs/parser@1.5.2
  - @nudojs/service@1.9.2

## 1.6.1

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
  - @nudojs/harvester@0.4.1
  - @nudojs/parser@1.5.1
  - @nudojs/service@1.9.1

## 1.6.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

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
- 9a3d6e7: Stop silently swallowing business-Promise failures. `nudo check/test --watch`
  incremental rounds died silently when the round body threw outside the
  per-file try (`buildModuleGraph` / `evictForDependents` / `topoSortDirty`) —
  the screen just froze on the previous round's results; the error is now
  printed (`nudo <label> incremental failed: …`), mirroring the existing
  first-round BUG-023 handling. In the LSP server, `validateDocument` (didOpen /
  didChange debounce) and `handleNudoDepFileChanged` (didOpen / didChange /
  watched-files) rejections were discarded with an empty catch — a file throwing
  in the analyzer produced no diagnostics and no trace, forever; failures are
  now logged to stderr as `[nudo-lsp] …` lines. Best-effort client capability
  requests (`DiagnosticRefresh` / `CodeLensRefresh` / inlay-hint refresh) keep
  their intentional silent catch.
- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/service@1.9.0
  - @nudojs/harvester@0.4.0
  - @nudojs/parser@1.5.0
  - @nudojs/env@0.5.0

## 1.5.0

### Minor Changes

- c19bd48: DX batch: face consistency across check/fix/export/health/test, plus `nudo init` and onboarding (fix-12, 20-point TS-parity batch).
  
  - `export --format dts` consumes contract faces through the same `effectiveInterface` source as `check` — non-exported top-level functions no longer leak into `.d.ts`; evidence-less params stay unknown with a stderr note.
  - `health` budget line no longer contradicts `check`: per-file budget snapshot, attribution segments only for the budget that actually triggered (depth 64/64, not "eval calls 71/20000"); human face and multi-envelope budgets aligned.
  - `check --fix` no longer writes non-fixing contracts: array-method receivers synthesize `array(shape({...}))` from callback element reads, and a re-check gate downgrades unprovable totality to `[review]` — no auto-applied half-fixes.
  - new `nudo init`: writes an idempotent adoption baseline into package.json (L2 → warning).
  - zero-config failing check prints an onboarding block (`init` / `contract --draft` / `--profile` adoption); gate exit code unchanged.
  - `nudo.test.profile` typos warn on stderr; syntax-error files print tsc-style blocks (path:line:col + excerpt + caret), `--json` folds them into `pathErrors`.
  - `nudo test` annotates `entry@` fallback cases on contracted functions.
  - TTY colors for severity markers / section headers (`NO_COLOR` master switch, `FORCE_COLOR` override, piped output stays plain); `check --quiet` suppresses signatures; `check --help` flags grouped (Common/Observation/Fix/CI/What-if); `contract --draft` emits uncomment-to-accept suggested bindings; diagnostics outside cwd print absolute paths; multi-file check prints an opt-in cache hint.

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/service@1.8.0
  - @nudojs/env@0.4.42
  - @nudojs/harvester@0.3.28

## 1.4.0

### Minor Changes

- 0d9e7de: `@nudo:skip` no longer kills `@nudo:case` evaluation (#176) — the declared face and runtime ground truth are no longer a trade-off.
  
  - A skipped function keeps `combinedAbs` from its declared return face (dts/sidecar/draft consumers unchanged), while declared `@nudo:case` directives are evaluated and asserted as usual; `nudo test` prints the skip note and the case assertions in the same block (previously the cases vanished entirely: "no declared @nudo:case expectations")
  - `nudo check` behavior is byte-identical (caseMode none — no case evaluation, no synthesized entry@ for skipped functions)

### Patch Changes

- Updated dependencies [0d9e7de]
- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/service@1.7.0
  - @nudojs/env@0.4.41
  - @nudojs/harvester@0.3.27
  - @nudojs/parser@1.4.23

## 1.3.26

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/env@0.4.40
  - @nudojs/harvester@0.3.26
  - @nudojs/parser@1.4.22
  - @nudojs/service@1.6.25

## 1.3.25

### Patch Changes

- Updated dependencies [e4e491f]
- Updated dependencies [1881f97]
- Updated dependencies [1881f97]
- Updated dependencies [8466793]
  - @nudojs/core@1.12.0
  - @nudojs/env@0.4.39
  - @nudojs/harvester@0.3.25
  - @nudojs/parser@1.4.21
  - @nudojs/service@1.6.24

## 1.3.24

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/env@0.4.38
  - @nudojs/harvester@0.3.24
  - @nudojs/parser@1.4.20
  - @nudojs/service@1.6.23

## 1.3.23

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.
- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/service@1.6.22
  - @nudojs/env@0.4.37
  - @nudojs/harvester@0.3.23
  - @nudojs/parser@1.4.19

## 1.3.22

### Patch Changes

- Updated dependencies [612d64f]
  - @nudojs/core@1.11.1
  - @nudojs/env@0.4.36
  - @nudojs/harvester@0.3.22
  - @nudojs/parser@1.4.18
  - @nudojs/service@1.6.21

## 1.3.21

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/env@0.4.35
  - @nudojs/harvester@0.3.21
  - @nudojs/parser@1.4.17
  - @nudojs/service@1.6.20

## 1.3.20

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/env@0.4.34
  - @nudojs/harvester@0.3.20
  - @nudojs/parser@1.4.16
  - @nudojs/service@1.6.19

## 1.3.19

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/env@0.4.33
  - @nudojs/harvester@0.3.19
  - @nudojs/parser@1.4.15
  - @nudojs/service@1.6.18

## 1.3.18

### Patch Changes

- 35ce944: Fix recursive-fn local hover poisoning and arity-only fn hover display
  
  - `$nodoPos` position records and call/assign records now carry the caller-frame depth; hover replay surfaces (`absNodeAtPosition`, `collectEnclosingFnLocals`) only read outermost-frame records. Recursive functions on self-referential contracts (`lazy(() => astNode)`) no longer bind cycle-truncated `opaque unknown` into local-variable hovers (`obj` now shows the computed `null | string | undefined`).
  - `const x = <non-call init>` declarations record the bound Abs at the declarator-id position during hover replay (`recordPositions` only) — ternary/optional-chain/literal-initialized locals are hoverable (`prop`, `q`).
  - `callTranspiledExportFullInner` refines the called fn Abs `returnType` slot after a successful call (same policy as class method slots, display-only).
  - LSP hover: an arity-only fn Abs (empty `returnType` slot) no longer preempts the generalize intension face; fn-name/callee hovers show the full contract signature `(node: nullable(astNode)) => null | string | undefined` instead of `(arg0) => ?`.
- Updated dependencies [334b914]
- Updated dependencies [94197eb]
- Updated dependencies [b8db17b]
- Updated dependencies [fa52735]
- Updated dependencies [35ce944]
- Updated dependencies [5e275df]
  - @nudojs/core@1.10.0
  - @nudojs/service@1.6.17
  - @nudojs/env@0.4.32
  - @nudojs/harvester@0.3.18
  - @nudojs/parser@1.4.14

## 1.3.17

### Patch Changes

- Updated dependencies [2af4016]
- Updated dependencies [2af4016]
  - @nudojs/core@1.9.4
  - @nudojs/env@0.4.31
  - @nudojs/harvester@0.3.17
  - @nudojs/parser@1.4.13
  - @nudojs/service@1.6.16

## 1.3.16

### Patch Changes

- Updated dependencies [b6495c6]
- Updated dependencies [b6495c6]
- Updated dependencies [04a6d1d]
  - @nudojs/core@1.9.3
  - @nudojs/service@1.6.15
  - @nudojs/env@0.4.30
  - @nudojs/harvester@0.3.16
  - @nudojs/parser@1.4.12

## 1.3.15

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/env@0.4.29
  - @nudojs/harvester@0.3.15
  - @nudojs/parser@1.4.11
  - @nudojs/service@1.6.14

## 1.3.14

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/env@0.4.28
  - @nudojs/harvester@0.3.14
  - @nudojs/parser@1.4.10
  - @nudojs/service@1.6.13

## 1.3.13

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/env@0.4.27
  - @nudojs/harvester@0.3.13
  - @nudojs/parser@1.4.9
  - @nudojs/service@1.6.12

## 1.3.12

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0
  - @nudojs/env@0.4.26
  - @nudojs/harvester@0.3.12
  - @nudojs/parser@1.4.8
  - @nudojs/service@1.6.11

## 1.3.11

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10
  - @nudojs/env@0.4.25
  - @nudojs/harvester@0.3.11
  - @nudojs/parser@1.4.7
  - @nudojs/service@1.6.10

## 1.3.10

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9
  - @nudojs/env@0.4.24
  - @nudojs/harvester@0.3.10
  - @nudojs/parser@1.4.6
  - @nudojs/service@1.6.9

## 1.3.9

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/env@0.4.23
  - @nudojs/harvester@0.3.9
  - @nudojs/parser@1.4.5
  - @nudojs/service@1.6.8

## 1.3.8

### Patch Changes

- d6fa067: fix(core): 函数边界缺参归一——省略尾实参不再以宿主 undefined 流入（Bug 7 / Bug 12）
  
  - **Bug 7（部分传参，假阳性）**：`two(s)` 对 `two(a, b)` 把宿主 `undefined` 送进 `$add` 等算子（读 `.shape` 崩溃被收成假 may-throw），或经 return 通道泄漏裸值。修复：宿主绑定元数内省略槽位按「显式传 undefined」归一为 `lit(undefined)`——函数声明/类方法在转译 prologue 收形（`p = $absVal(p)`），函数表达式/对象方法在 `$fnVal` apply 钩子按 `impl.length` 补齐（读宿主 `arguments` 的 function 包装走 `padArgs: false` + 体内归一，`arguments.length` 不膨胀）。
  - **Bug 12（零参调用，假阴性）**：`f(a){return a.b}` 零参原折 `unknown` 无 throws（确定抛被折成保证不抛）。归一后 `$get`/解构守卫走 nullish 硬抛——`throws TypeError` 与原生一致；wave-1 的 unknown 接收者政策不变。
  - `+` 代数不设 `lit(undefined) ⊗ any` 专用零抛臂：`undefined + any` 落既有 anyLike 臂（值域 `number | string`，any 侧可为 Symbol → 原生 may TypeError，与 `any + 1` / `any ⊕ any` 同口径记 may-throw——省略归一只消除宿主裸值崩溃/泄漏，不放宽 any 的投射面）；`s + 1` 的 policy 不变。
  - 红线保持：默认参照常取默认、rest 收 `[]` 不补、`typeof` 折 `"undefined"`、显式 `undefined` 实参语义不变、数组解构零参迭代守卫硬抛、checkSource 入口 any 路径不变。
- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/env@0.4.22
  - @nudojs/harvester@0.3.8
  - @nudojs/parser@1.4.4
  - @nudojs/service@1.6.7

## 1.3.7

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/env@0.4.21
  - @nudojs/harvester@0.3.7
  - @nudojs/parser@1.4.3
  - @nudojs/service@1.6.6

## 1.3.6

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/env@0.4.20
  - @nudojs/harvester@0.3.6
  - @nudojs/parser@1.4.2
  - @nudojs/service@1.6.5

## 1.3.5

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/env@0.4.19
  - @nudojs/harvester@0.3.5
  - @nudojs/parser@1.4.1
  - @nudojs/service@1.6.4

## 1.3.4

### Patch Changes

- 50e50f1: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/service@1.6.3
  - @nudojs/parser@1.4.0
  - @nudojs/env@0.4.18
  - @nudojs/harvester@0.3.4

## 1.3.3

### Patch Changes

- a00bccc: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- 446914f: fix(nudojs): `check --gitlab` 多 target 在 action 层聚合成单个 Code Quality JSON 数组（旧实现逐文件各打一个数组，拼接产物无法被 GitLab 解析）；--gitlab 面 stdout 不再混入 docs 深链（机器契约面与终端面分离）。watch（check/test 共用循环）每轮前复位 `process.exitCode`——红轮置 1 后不再粘滞，退出码始终反映最近一轮门禁状态。`check --fix` 读文件失败改为上屏并计入 residualErrors（不再静默跳过导致静默绿）。重构：runCheck 拆为 loadCache / buildInjection / report+exit 三段，门禁解析链抽 `resolveGateForFile` 单源（plain check 与 --fix 同链），静态依赖的 `await import` 提升为顶部静态引入（输出/退出码零漂移，cli-e2e-golden 快照不变）。
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [446914f]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [89358f2]
- Updated dependencies [89358f2]
- Updated dependencies [89358f2]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2
  - @nudojs/service@1.6.2
  - @nudojs/parser@2.0.0
  - @nudojs/env@0.4.17
  - @nudojs/harvester@0.3.3

## 1.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/harvester@0.3.2
  - @nudojs/parser@1.3.2
  - @nudojs/service@1.6.1

## 1.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/service@1.6.0
  - @nudojs/harvester@0.3.1
  - @nudojs/parser@1.3.1

## 1.3.0

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
  - @nudojs/service@1.5.0
  - @nudojs/parser@1.3.0
  - @nudojs/harvester@0.3.0

## 1.2.0

### Minor Changes

- 64ca356: feat: clamp bounds + scalar-over-sum + action-map quickfixes (#68 #69)
  
  ## #68 inference
  
  - `Math.min` / `Math.max` / `Math.round` (and floor/ceil/trunc) propagate
    operand numeric bounds: `max(0, min(100, n))` derives `[0, 100]`.
  - NaN is explicit (option 1): a possibly-NaN operand yields `NaN | number@bounds`,
    so clamp contracts stay honest; `if (Number.isNaN(n)) return …` narrows the
    false arm (`ne(n, NaN)`) and the guarded clamp is provable.
  - Scalar return contracts now distribute over sum arms like shape/array
    (`nullable(c)` + multi-return `null | number` is provable). Gold-FP
    protection kept: any-widened bare-prim arms downgrade siblings to
    `unproven-return` warnings instead of errors.
  
  ## #69 DX
  
  - `actionsForIssue` kinds are materialized as LSP quickfixes with
    `[fix]` / `[silence]` / `[review]` / `[adjust]` / `[scaffold]` titles.
  - `nudo check --fix [--only <code>] [--write]` reuses the same edit layer
    (default dry-run prints unified diffs).
  - Body-read fields auto-fill types from usage (`node.type === "x"` →
    `string()`, arith → `number()`, no evidence → `any()`); never emit empty
    `shape({})`.
  - L2 `entry-may-throw` suggestions include a copyable sidecar clause.

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0
  - @nudojs/service@1.4.0
  - @nudojs/harvester@0.2.19
  - @nudojs/parser@1.2.1

## 1.1.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0
  - @nudojs/parser@1.2.0
  - @nudojs/service@1.3.0
  - @nudojs/harvester@0.2.18

## 1.0.9

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/harvester@0.2.17
  - @nudojs/parser@1.1.9
  - @nudojs/service@1.2.4

## 1.0.8

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/harvester@0.2.16
  - @nudojs/parser@1.1.8
  - @nudojs/service@1.2.3

## 1.0.7

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/harvester@0.2.15
  - @nudojs/parser@1.1.7
  - @nudojs/service@1.2.2

## 1.0.6

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1
  - @nudojs/harvester@0.2.14
  - @nudojs/service@1.2.1
  - @nudojs/parser@1.1.6

## 1.0.5

### Patch Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
  The AST-walk interpreter is long gone, so the dual-engine campaign name
  "B-path" no longer means anything and forced a glossary entry just to
  explain itself. The single production evaluation engine is now simply
  the **evaluator** (mechanism: transpile → `new Function` on Abs).
  
  Renamed B-path engine to evaluator/eval — see the @nudojs/core table above.
- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/service@1.2.0
  - @nudojs/harvester@0.2.13
  - @nudojs/parser@1.1.5

## 1.0.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/harvester@0.2.12
  - @nudojs/parser@1.1.4
  - @nudojs/service@1.1.4

## 1.0.3

### Patch Changes

- Updated dependencies [3bf9997]
- Updated dependencies [43fb345]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/service@1.1.3
  - @nudojs/harvester@0.2.11

## 1.0.2

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2
  - @nudojs/harvester@0.2.10
  - @nudojs/parser@1.1.2
  - @nudojs/service@1.1.2

## 1.0.1

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1
  - @nudojs/harvester@0.2.9
  - @nudojs/parser@1.1.1
  - @nudojs/service@1.1.1

## 1.0.0-beta.3

### Patch Changes

- 247f751: docs(website): product narrative — runtime-adjacent variables, Observation/Contracts layers, cost face (tokens / rounds / edit latency), top-level glossary (Abs origin, B-path, fail-closed, conf grades), TypeScript comparison without permanent dual-gate framing.

## 1.0.0-beta.2

### Patch Changes

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
- Updated dependencies [4305674]
  - @nudojs/service@5.0.0-beta.1
  - @nudojs/harvester@1.0.0-beta.1

## 1.0.0-beta.1

### Major Changes

- e29ceac: **BREAKING**: merge `@nudojs/cli` into `nudojs` — one install unit for the `nudo` command.
  
  - **`nudojs` is now the full CLI** (`check` / `test` / `contract` / `export` / `health` / `migrate`), with `bin: nudo` and the previous `@nudojs/cli` dependencies. `nudo --version` prints `nudojs <ver>` (+ `@nudojs/core <ver>` when resolvable).
  - **`@nudojs/cli` is a deprecated migration stub** that forwards `nudo` and the module entry to `nudojs` and prints a deprecation line on stderr. Prefer `npm i -g nudojs`. The stub will be unpublished.
  - No more "shell ≠ engine" version heads-up: the package you install is the product version.
  
  Migration:
  
  ```bash
  npm rm @nudojs/cli
  npm i -g nudojs   # same `nudo` bin
  ```
  
  `import "@nudojs/cli"` / `npx @nudojs/cli` keep working via the stub for one beta cycle.

## 1.0.0-beta.0

### Major Changes

- 0e1432a: feat!: source contract directive is `@nudo:contract` only
  
  `@nudo:refine` and `@nudo:interface` are deleted with no alias layer. The product word is **contract** end to end (sidecar `*.nudo.js`, `@nudo:contract`, `nudo contract`, `package.json#nudo.contract.*`).
  
  - **BREAKING:** replace every `@nudo:refine` / `@nudo:interface` with `@nudo:contract` (including `@nudo:contract return <constraint>`). Grammar is unchanged: `@nudo:contract <param> <constraint>`.
  - Constraints still enter Abs as Preds and participate in algebra (`x>0` ⇒ `x+1>1`) — this is not a call-site validation gate.
  - Diagnostic codes `nudo:interface-*` are unchanged in this release.
  - Chinese product copy uses 契约, not 精化.
- 8db7320: feat!: remove `env harvest` from the product CLI face
  
  Harvest is not a user task. Product verbs are `check` / `test` / `contract` / `export` / `health`.
  
  - **BREAKING:** `nudo env harvest` (and the `env` command group) is removed. Third-party `@types` still auto-fill during analysis via module-graph harvest; env-package generation stays available as the `@nudojs/harvester` library.
  - Handwritten `@nudojs/env` remains the fixed product env (`es` / `web` / `node`) and still wins over harvest on overlapping modules/exports.
  - Scripts that called `nudo env harvest` should either rely on analysis auto-fill or call `harvestDts` / `emitEnvModule` from `@nudojs/harvester` directly.

### Patch Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).
- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies
- Updated dependencies [279d73a]
- Updated dependencies [8db7320]
- Updated dependencies [5a5e167]
  - @nudojs/cli@4.0.0-beta.0

## 0.3.2

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/cli@3.0.0

## 0.3.1

### Patch Changes

- @nudojs/cli@2.0.1

## 0.3.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/cli@2.0.0

## 0.2.2

### Patch Changes

- @nudojs/cli@1.0.1

## 0.2.1

### Patch Changes

- bd28356: Rename thin shell package from unavailable npm name `nudo` to `nudojs`. The installed command remains `nudo` (`npx nudojs infer …` / `npm i -g nudojs` → `nudo infer …`).

## 0.2.0

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudojs`（`bin` 委托 `@nudojs/cli`，命令名仍为 `nudo`）

- 0fd253f: 新增 `nudojs` 薄壳包：`npm i -g nudojs` 或 `npx nudojs` 直接获得 `nudo` 命令（委托 @nudojs/cli，参数与退出码透传）。

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
  - @nudojs/cli@1.0.0
