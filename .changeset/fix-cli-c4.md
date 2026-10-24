---
"nudojs": patch
---

fix(cli): `check --abs` 观察面与 watch 输出面的产品面修复

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
