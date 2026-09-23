# 替换 TypeScript 可行性报告（第二份：真实 npm 包）

> 对象：`commander`（monorepo 依赖，有 `.d.ts` + JS 入口）  
> 工具：`scripts/scan-npm-package.ts`  
> 前提：CJS require 静态解析、harvest-package、nudo check 门禁已落地

---

## 1. 实测（commander）

```
harvest:  1 d.ts, 11 symbols
import:   7 文件（含 require 相对依赖）
intension: 8 个内涵签名
check:    argument.js → OK
```

命令：

```bash
npx tsx scripts/scan-npm-package.ts commander
```

---

## 2. 链路是否打通

| 环节 | 状态 | 证据 |
|---|---|---|
| CJS `require('./x')` 静态跟 | ✅ | 7 文件图 |
| `exports.foo` / `module.exports` | ✅ | cjs-require 测试 |
| harvest 包内 `.d.ts` | ✅ | 11 symbols |
| 内涵签名 | ✅ | 8 poly |
| `nudo check` 门禁 | ✅ | 字面量违例 → FAILED / exit 1 |
| this / class / async | ✅（前一轮） | algebra language |

---

## 3. 与 TS 对照（commander 级包）

| 能力 | `tsc` | Nudo Abs 路径 |
|---|---|---|
| 读 `.d.ts` 做依赖类型 | ✅ | harvest 骨架 ✅ |
| 本包 JS 内涵签名 | 需 checkJs | **默认可推** |
| 跨 CJS 文件 | ✅ | **静态 require 图** ✅ |
| 约束违例门禁 | 结构赋值 | **`if (x>0)` + 字面量调用** |
| 大包（typescript 本体） | 快 | harvest 全量 **偏慢**（dts 限 8） |
| 完备 soundness | ✅ | ❌ 仍非 checker |

---

## 4. 覆盖矩阵（更新）

| 状态 | 特性 |
|---|---|
| ✅ | ESM import / CJS require（相对） |
| ✅ | class / this / 继承 / instanceof |
| ✅ | async / await |
| ✅ | harvest npm `.d.ts` |
| ✅ | nudo check 字面量约束门禁 |
| 🚧 | harvest 大包性能（typescript 级） |
| 🚧 | `@types/*` 自动解析 |
| ❌ | 动态 require / 条件导出 |
| ❌ | 完整 Node API env（process/fs 流…） |
| ❌ | 完备 soundness |

---

## 5. 结论

> **真实 npm 包（commander 量级）上：CJS 图 + harvest + check 已打通。**  
> 作为 **JS 库的内涵类型事实源** 可用。  
> 替换 `tsc` 仍卡在：大包 harvest 性能、Node API env、以及「错误金标」召回率。

**错误金标进展（人工标注）：** `check-recall-gold.test.ts` 已扩至 101 条单文件 + 15 条跨文件人工标注（可选字段 / find·pop·push 返回值 / 字典查找 / filter 回调 / `==null` 折叠 / 数组下标边界 / refine 边界邻域 / HOF arg-structure / 可变绑定 assign / shape·return·union）。门禁 recall=precision=1.0（8 条已知 FN 以 `it.fails` 钉住并成文，不计入门禁、禁止改标凑绿）。真实包 zero-FP 仍绿。残余漏报集中在：optional/undefined 传入显式契约、`find`/`pop`/缺键 未命中值、元组下标字面量跟丢、内联 `push` 表达式实参、null 守卫打断无条件转发。

**下一步（若继续替换）：**

1. 消掉 8 条已知 FN（值流：optional/undefined、find/pop 未命中、下标、内联 push、守卫转发）  
2. `@types/node` harvest 预置  
3. `nudo check` 接入 CI 示例  

---

## 附录

- CJS：`packages/service/src/static-imports.ts`  
- harvest：`packages/service/src/harvest-package.ts`  
- check：`packages/core/src/algebra/check.ts`  
- 扫描：`scripts/scan-npm-package.ts [pkg]`  
- 测试：全绿（`pnpm run test`，数量随提交增长，不在此钉死）
