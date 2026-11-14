# 大文件单文件分析基线（2026-11-14）

> **性质**：一次性测量报告（非 CI 门禁、非产品宣称）。回答「单个超大源码文件
> 的 analyze / check 墙在哪」，用来决定是否值得做文件内分段/记忆化。
> **复现**：`tsx` 进程内直接调用 `analyzeFile` / `checkSource`（空会话缓存、
> 默认 `loadModule`），宿主 Linux / Node v26.10.0；绝对值只与同宿主复跑比较。

## 结论

1. **单文件 AST 规模本身不是 4 分钟级墙**。自包含的 `typescript/lib/typescript.js`
   （9.14 MB / 201k 行）`checkSource` **16.3 s**（0 诊断，RSS 2.0 GiB）；
   `@babel/parser/lib/index.js`（0.49 MB / 14.6k 行）**4.7 s**（98 诊断）。
2. **`@babel/types/lib/index.js` 的 >3 min 不是单文件成本**：入口 0.33 MB，
   但 `defaultLoadModule` 会拉起整包依赖图（数百模块）⇒ 时间花在模块图
   加载/求值，属 [`ABS-17`](../design/plans/2026-11-09-abs-improvement-plan.md)
   的「依赖解析上下文」形态，不是 AST 遍历。JS 模式接线后 check 仍 >180 s
   ⇒ 该入口不作为单文件性能结论；与 `typescript.js`（9.14 MB 自包含，
   check 16.3 s / analyze 14.6 s）分开看。
3. **纯 JS 源此前在多个解析入口按 ts 模式跑 strip-types**：`parseSource` 的
   模式由 filename 决定（`.js/.mjs/.cjs/.jsx` 跳过两趟全 AST 遍历），但
   service/transpile/module-graph 的多条路径调用时**未传 filename** ⇒
   `typescript.js` analyze 20.8s 中 strip 占 24%。把 filename 从
   `analyzeFile` / `transpileModule` / 模块图 / 指纹 / 指令抽取一路透传后
   **20,755 → 14,594 ms（−29.7%）**，strip 占比降到 ~2%（`checkSource`
   路径同样只剩 1.7%）。
4. **已修复一个真实的 O(函数数 × 节点数) 热点**：`listFnDirectiveScopes`
   原先每个函数查询都全量遍历 AST；`checkSource` 对每个函数调用
   `findFnDirectiveScope` ⇒ `@babel/parser` 文件 13.2 s 中 **54.1%**
   （7098/13126 CPU 样本）落在该递归访问器。按 AST 对象 WeakMap 缓存后
   **13.2 s → 4.7 s（−64%）**。

## 测量数据

| 文件 | 大小 / 行数 | analyze | check | RSS | 备注 |
|---|---|---:|---:|---:|---|
| `@babel/parser/lib/index.js`（修复前） | 0.49 MB / 14,613 | — | **13,179 ms**（98 issues） | 637 MiB | CPU 热点 54% = directive-scan 访问器 |
| `@babel/parser/lib/index.js`（修复后） | 0.49 MB / 14,613 | — | **4,675 ms**（98 issues） | 646 MiB | 同一宿主、同一进程口径 |
| `typescript/lib/typescript.js`（check） | 9.14 MB / 201,040 | — | **16,277 ms**（0 issues） | 2,059 MiB | 自包含 bundle |
| `typescript/lib/typescript.js`（analyze，修复前） | 9.14 MB / 201,040 | **20,755 ms** | 11,347 ms（同进程随后） | 2,408 MiB | strip-types 24% |
| `typescript/lib/typescript.js`（analyze，JS 模式接线后） | 9.14 MB / 201,040 | **14,594 ms** | — | 2,568 MiB | strip 占比 → ~2% |
| `@babel/types/lib/index.js` | 0.33 MB / 10,759 | > 298 s（300 s 超时） | > 180 s（超时；JS 模式接线后仍超时） | — | 单文件小，但依赖图数百模块 ⇒ ABS-17 形态；非单文件优化面 |

`@babel/parser` 的 analyze 未单列：check 的 CPU 样本已足够定位；`@babel/types`
的 analyze 在 300 s 墙钟超时前未完成（未取得可信数字，如实不填）。

### `typescript.js` analyze 热点（CPU profile，总 21,148 samples）

| 占比 | 位置 | 说明 |
|---:|---|---|
| **24%** | `strip-types.ts`（匿名 + `transformNode` + `transformValue` + `deleteTypeSyntaxFields`） | TS 语法剥离一次全树改写 |
| 11.2% | GC | 9 MB AST + 改写产物 |
| 5.0% | `directive-scan.ts` 访问器 | 单次全量扫描（已按 AST 缓存） |
| 3.2% | `@babel/parser::readWord` | 解析 |
| ≤2% | scope-collect / load-deps-fp / eval-diagnostics / code-text | 长尾 |

**`$copy` / `copyWithMemo` 不在前 25 名**（<0.5%）。⇒ ABS-17 的触发
「单文件 analyze >5s」虽被本文件满足，但成本主体是 strip-types + GC，
不是大对象图拷贝；写时复制不会改善这个输入。

## CPU 热点（`@babel/parser` check，修复前）

按 `url :: function` 聚合的 self samples（总 13,126）：

| 占比 | 位置 | 说明 |
|---:|---|---|
| **54.1%** | `directive-scan.ts` 递归访问器（`listFnDirectiveScopes`） | 每函数一次全量 AST 遍历 |
| 3.3% | GC | 与上者同源（分配/回收） |
| 3.0% | `generalize.ts::extractFn` | 逐函数泛化 |
| 1.6% | `generalize.ts`（匿名） | |
| 1.6% | `objects.ts::identitySuffix` | Abs 身份键 |
| 1.5% | `abs-key.ts::shapeKey` | 结构键 |

修复后（总 5,320）：GC 6.2%、`extractFn` 4.5%、`identitySuffix` 4.3%、
`shapeKey` 3.6%，**无单点 >5%** —— 剩余成本是逐函数分析的正常分布。

JS 模式接线后 `typescript.js` analyze 的 strip 只剩 ~2%，热点回到
GC / `extractFn` / 结构键等逐函数分析面。

## 修复

`packages/core/src/algebra/directive-scan.ts`：

- `listFnDirectiveScopes(file)` 增加 `WeakMap<object, FnDirectiveScope[]>` 缓存；
  `parseSource` 的 LRU 对同一源码返回同一 AST 对象，分析期不改写 AST ⇒
  按对象身份缓存不改变结果，WeakMap 随 AST 回收。
- 回归钉：`directive-scope-cache.test.ts`（同 AST 二次查询返回同一实例；
  不同 AST 不共享）。
- 复测：`@babel/parser` check **13,179 → 4,675 ms**；`typescript.js` 同口径
  16.3 s（未做前后对比，属新基线）。

## 决定

- **不做文件内分段/语句级 memo**：9 MB 自包含文件 16 s 已可接受，且热点
  修复后无单点主导；再拆 AST 只会把成本搬进维护面。
- **大包入口的分钟级成本**继续归 `ABS-17`（依赖图 / `$copy`）与
  `ABS-16`③（worker 并行，触发条件未命中），本报告不立项。
- 对外不引用本报告数字（`benchmark/README.md` 的对外口径不变）。
