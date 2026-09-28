---
date: 2026-09-28
slug: retiring-typescript-in-practice
title: 我们把 JS 包上的 `tsc` 退役了——门禁反而更尖
authors: [default]
tags: [engineering, typescript, migrate, case-study]
---

> JS 包上的 `tsc --noEmit` 可以退役了。零注解起步、契约只在你接受的地方生效、违例读作**值 ⊭ 谓词 + 下一步**——出口是 `migrate retire`，不是永远双跑两个编译器。

大多数团队留着 `tsc --noEmit`，不是因为喜欢写注解，而是因为没有别的 CI 门禁可选。Nudo 的答案不是「再写一套类型语言」，而是三条承诺：

1. **JS 保持 JS** —— 不改运行时，不发明第二 IR。
2. **契约按需** —— `*.nudo.js` / `@nudo:contract`，义务只来自你接受的声明。
3. **单向门** —— `nudo migrate status → strip → verify → retire`。出口是 **retire tsc**，不是双跑。

我们用三个可运行样例钉住了这个故事，而不是几页幻灯片：一个公开的 checkout-demo，加上两个真实 npm 消费方。

<!-- truncate -->

## 为什么敢把旧门禁撤掉

`nudo check` 是跑在 Abs（shape × term × pred × conf）上的谓词蕴含门禁——类型是可计算的值，所以 `x>0` 蕴含 `x+1>1`，而不是退化成 `number`。门禁对着金标准，不对着感觉：check 套件上 recall = precision = 1.0，外加真实包零误报测试。这才让 `nudo check` 能当*唯一的*门禁，而不是一个咨询层。

证据树是提交进仓库、可复跑的（`pnpm run verify:examples`）：

| 案例 | 依赖 | 终态 |
|------|------|------|
| checkout-demo | 合成小库 | `nudo check` 一门禁 |
| **ms**（vercel/ms） | 真实 npm | 依赖不动，消费方是纯 JS + Nudo |
| **debug**（visionmedia/debug） | 真实 npm | 同上；native 返回诚实标 `unknown` |

`ms` 和 `debug` 是真实包，不是合成 fixture——动的是消费方，依赖一个没改。

## 四步门

```text
audit (migrate status) → strip → verify (nudo check) → retire (drop tsc)
```

可直接粘贴，路径换成你的包：

```bash
# 0. audit —— 还有什么在背着 tsc
npx nudojs migrate status ./my-pkg

# 1. strip —— .ts → .js（注解出去，运行时不动）。--write 落盘。
npx nudojs migrate strip ./my-pkg/src --write

# 2. 可选 —— 把旧注解反向抽取成可评审的契约草稿
npx nudojs contract --from-dts ./my-pkg/src/index.ts
#    → @nudo:draft（不复制进 *.nudo.js 就不生效）

# 3. verify —— strip 出的 JS 必须过 nudo check
npx nudojs migrate verify ./my-pkg/src

# 4. retire —— 卸掉 typescript，改写 tsc 脚本 / GHA 行，写 marker
npx nudojs migrate retire ./my-pkg --dry-run   # 然后去掉 --dry-run
```

| 步骤 | 效果 | 何时出门 |
|------|------|----------|
| `status` | 数 `.ts`、找 `tsc` 脚本 + `typescript` 依赖、列 **blockers** | 你摸清了面积 |
| `strip` | `.ts` → `.js`；可选尽力而为的侧车草稿 | 源码是纯 JS |
| `verify` | 对 strip 后的 JS 跑 `nudo check`（可选 `--with-tsc` 双跑，**仅限**搬家期间） | 门禁绿 |
| `retire` | 卸 `typescript`，`tsc` 脚本 → `nudo check`，改写 `.github/workflows`，写 `.nudo/migrate-retired.json` | **tsc 消失** |

两个细节扛起了信任。`--from-dts` 草稿**绝不静默生效**：旧注解只有在评审并复制进 `*.nudo.js` 之后才变成义务。双跑只存在于搬家期间的 `migrate verify --with-tsc`——共存是迁移战术，从来不是终点。

## 违例读起来是什么样

搬家之后，违例是值和谓词，不是类型名：

```text
actual:   0  #exact
expected: ms > 0
→ use a value satisfying ms > 0
fix:  nudo contract --draft
```

不是「报得更多」，是**「报得更真、带证据、带下一步」**。全部错误面孔见 [Error faces](/docs/guides/error-faces)。

## 诚实的限制

上面每个样例都是来自 `docs/examples/` 的**示例级**规模（各 2–3 个模块）——耗时与摩擦计数是示例级数字，不是生产规模迁移审计。我们不发布生产级的时/天数，所谓「7 天退役路径」是产品目标叙事，不是测得的中位数：估算真实包请从 `migrate status` 报出的 `.ts` 文件数出发，别按博客文章算。

原生或未 harvest 的依赖以引擎债务的形式保持可见：`ms()` 和 `debug()` 的返回显示 `unknown` / `conf=opaque`，带 `nudo:unknown-inference` 或 `nudo:opaque-result` 警告和修复路径（`@types/*` harvest、`@nudo:mock`、或 `refine return`）。诚实的债务在你钉住之前一直是警告——绝不被伪装成成功。

## 迁移后的工作流

`nudo check` 是唯一的门禁，签名**即使成功也打印**——未约束的入口参数显示为 `any`，真正的 `unknown` 意味着推断失败。有意的 `throw` 以 L2（`nudo:entry-may-throw`）浮出，带确切的下一步（`@nudo:throws`、guard，或第一周先软化的 `package.json` 配置）。之后收紧约束，面孔就变成值 + 谓词。

完整的命令走查、before/after 代码与诊断、摩擦表：[Case study: retire tsc](/docs/guides/case-study-retire)。门本身写在 [Migrate from TypeScript](/docs/guides/migrating-from-typescript)；如果你刚接触 Nudo，从 [Quick Start](/docs/getting-started/quick-start) 开始。
