---
"nudojs": patch
"@nudojs/core": patch
---

族 21 收口接线：把各分片「越界发现」里明确交给**主 agent** 的接线项补齐 ——
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
