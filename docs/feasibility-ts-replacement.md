# Nudo kernel 替换 TypeScript 可行性报告（第一份）

> 对象：`docs/examples/mini-repo/`（风格化真实小库：ESM 跨文件 + class + async + HOF + 约束算术）  
> 日期：kernel M0–M5 + 语言覆盖补齐之后  
> 方法：`buildModuleGraph` + `generalize` + 具体/符号求值 + 覆盖矩阵

---

## 1. 执行摘要

| 问题 | 结论 |
|---|---|
| kernel 能否吃下这类 JS 小库？ | **能**（模块图、class brand、async eff、约束算术均已接通） |
| 能否替代 `tsc --noEmit`？ | **不能**（无完备检查；this/继承方法仍部分） |
| 能否作为「类型事实源」给 IDE/Agent？ | **可以**，且在约束与字面量上 **优于 TS** |
| 建议产品定位 | JS 小库 / 存量 JS 的内涵类型 + case 驱动检查；非完备 checker |

**一句话**：语言覆盖已过「能分析真实 JS 形态」门槛；离「删掉 tsc」还差 this 方法体、继承派发、动态 require 与生态 harvest。

---

## 2. 实测结果

### 2.1 模块图

```
user-service.js  →  validators.js
                 →  store.js
```

3 文件、9 个导出符号，`buildModuleGraph` 一次扫齐。

### 2.2 内涵签名（节选）

```
score:        <A1>(x: A1) => number = (A1 + 1)
fetchUser:    <A1>(id: A1) => { id: unknown, name: unknown }   # entry 未带约束时
createService:<>() => { store: brand, load: (id) => ? }
```

**约束算术（TS 做不到）**：

```
score(x)  where Φ: x > 0
  → term = (x + 1)
  → pred: (x + 1) > 1
```

### 2.3 async / class

```
fetchUser(3)  →  Promise<{ id: 4, name: "u" }>   # eff 包装，inner exact 字面量
new MemoryStore()  →  brand(MemoryStore)
p instanceof Point  →  true / false  #exact（brand 名）
```

### 2.4 与 TS 对照（同一 mini-repo）

| 能力 | `tsc` | kernel |
|---|---|---|
| 跨文件导出类型 | ✅ 结构类型 | ✅ 内涵签名 + 模块图 |
| `score` 在 `x>0` 下 | `number` | **`(x+1)>1`** |
| `fetchUser(3)` | `Promise<User>` | **`Promise<{id:4,…}>`**（字面量） |
| class 名义性 | private/#brand 技巧 | **brand 一等** |
| 零注解 | 需 JS+checkJs 或迁 TS | 默认可推 |
| 完备赋值检查 | ✅ | ❌（抽象解释） |
| `this.x` 方法体 | ✅ | 🚧 构造可写，方法内未 eval |
| 继承方法 | ✅ | 🚧 shape 可 meet，派发未接 |

---

## 3. 覆盖矩阵（扫描输出）

| 状态 | 特性 | 备注 |
|---|---|---|
| ✅ | 数值算术 + 约束 | `score` |
| ✅ | template 拼接 | |
| ✅ | HOF map/reduce | 不动点 |
| ✅ | 对象 spread | |
| ✅ | class / new / brand | |
| ✅ | instanceof | brand 精确 |
| ✅ | async / await | eff |
| ✅ | ESM 模块图 | 相对 import |
| ✅ | export function | unwrap ExportNamed |
| 🚧 | this 字段 | 方法体未绑定 this |
| 🚧 | 继承 | superClass shape，方法派发未接 |
| ❌ | CJS 动态 require | 仅静态 module.exports 名 |
| ❌ | 完整 Node API | 旧宿主 / harvest |
| ❌ | 完备 soundness | 设计如此 |

---

## 4. 替换 TS 的差距（按优先级）

### P0 — 不做就不能谈替换

1. **方法体求值带 `this`**：`new C().method()` 应在 this=brand 下 eval body  
2. **继承派发**：`super` / 覆写方法  
3. **真实 npm 库**：对 lodash 子集或 json-ext 级别跑同样扫描（本报告用 synthetic mini-repo）  
4. **`nudo check` 门禁语义**：赋值/调用蕴含失败 → CI 红

### P1 — 产品可用

5. CJS `require` 静态解析  
6. harvest `.d.ts` → env  
7. intension 进默认 `infer` / LSP hover（现需 `setKernelModule`）  
8. 方法/品牌在 `formatShape` 的展示（当前 brand/eff 显示 `·`）

### P2 — 规模

9. 大文件性能、增量  
10. 拆掉 evaluator 双栈物理结构  

---

## 5. 建议路线

```
Week 1–2   this + 继承方法派发（kernel）
Week 2–3   nudo check 门禁 + intension 默认可见
Week 3–4   拿 json-ext / lodash.isEqual 级库出第二份报告（指标：unknown 率、耗时）
之后     harvest + 文档化「何时可删 tsc」边界
```

**删除 tsc 的充要条件（写进产品文档）**：

- 目标仓库 100% 函数有内涵签名或 case  
- `nudo check` 在 CI 零漏报（相对人工金标）  
- 依赖库 harvest 覆盖率达标  
- 团队接受「非完备、路径敏感」的检查模型  

---

## 6. 附录

- fixture：`docs/examples/mini-repo/`  
- 扫描脚本：`scripts/scan-mini-repo.ts`（**host 脚本**，不在 `packages/*/src`）  
- 静态 import：`packages/service/src/static-imports.ts`（host）  
- 运行：`npx tsx scripts/scan-mini-repo.ts`  
- 语言测试：`packages/kernel/src/__tests__/language.test.ts`

### 分层（架构纠偏）

| 层 | 职责 | 不该做 |
|---|---|---|
| **kernel** | 对 AST/源码抽象解释（Abs、term、pred） | fs / path / 模块加载 |
| **host（service/cli）** | 读文件、**最薄**相对 import 扫描、把 source 喂给 kernel | 当 Node 加载器 / bundler |
| **Node / 打包器** | 真正解析与执行 ESM/CJS | — |
| **Babel/parser** | 把不能直接跑的（TS 等）剥成可分析 JS | 类型语义本身 |

引擎产物仍是 **JS + 内涵类型事实**；跨文件只服务「导出签名」，不实现运行时模块系统。

---

## 7. 结论

> **kernel 已从「算术内核」长成「能分析真实 JS 形态的语言子集」。**  
> 作为 TS 的 **内涵类型事实源** 已可用且在约束/字面量上更强；  
> 作为 **完备类型检查器** 尚不可替代 tsc。  
> 下一份报告必须上真实 npm 库，否则仍是 demo 级证据。
