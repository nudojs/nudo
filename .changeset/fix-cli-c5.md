---
"nudojs": patch
---

fix(cli): `nudo init` 的幂等判据 / 作用域 / IO 错误面 / 写盘保真度，与 `migrate strip` 的机器面

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
