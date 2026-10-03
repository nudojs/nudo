---
"nudojs": patch
---

fix(nudojs): `check --gitlab` 多 target 在 action 层聚合成单个 Code Quality JSON 数组（旧实现逐文件各打一个数组，拼接产物无法被 GitLab 解析）；--gitlab 面 stdout 不再混入 docs 深链（机器契约面与终端面分离）。watch（check/test 共用循环）每轮前复位 `process.exitCode`——红轮置 1 后不再粘滞，退出码始终反映最近一轮门禁状态。`check --fix` 读文件失败改为上屏并计入 residualErrors（不再静默跳过导致静默绿）。重构：runCheck 拆为 loadCache / buildInjection / report+exit 三段，门禁解析链抽 `resolveGateForFile` 单源（plain check 与 --fix 同链），静态依赖的 `await import` 提升为顶部静态引入（输出/退出码零漂移，cli-e2e-golden 快照不变）。
