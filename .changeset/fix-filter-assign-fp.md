---
"@nudojs/core": patch
"@nudojs/lsp": patch
---

fix(core): filter 元组投影保真 + assign 拓宽补全数组 sum（OSS semver L1 FP）

- `filter` 空元组结果从 `unknown[]`（无界长度）改为 `[]`；不确定谓词对 ≤3 元组
  枚举精确子序列和（长度有界——filter 不增元素），更大元组保持无界 arr（sound 旧口径）
- `widenForAssign` 补全数组 sum 分支：全 tuple/arr 成员的 sum 按 tuple 分支同口径
  拓宽为单 arr（可变绑定持数组后赋任意数组是合法 JS）；混入 obj/prim 的 sum 仍精确对账
- 复合效果：循环 push-join 绑定（`[] | [unknown]`）重赋 `map(...).filter(...)` 不再
  假报 `nudo:assign-mismatch`（benchmark/oss 语料 semver/bin/semver.js L109，#91
  循环 pack 健全化暴露的既有失真）；元素改型等真违例仍报
- lsp：补全面放行 path-conf 元组（filter 子集和臂成员的 length 是诚实字面量），
  sum 臂 detail 渲染去重
