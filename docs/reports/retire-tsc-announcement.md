# Retire tsc — 对外分发材料（C2）

> 状态：**可直接粘贴**。技术叙事以站内 [Case study: retire tsc](https://nudojs.github.io/nudo/docs/guides/case-study-retire) 为准。  
> 分发渠道：博客 / HN / release notes / 微博·即刻。发出前把示例命令跑一遍（`pnpm run verify:examples`）。

---

## 1. 博客 / 长文（约 600 字）

**标题（EN）**  
We retired `tsc` on our JavaScript packages — and the gate got sharper

**标题（中文）**  
我们把 JS 包上的 `tsc` 退役了——门禁反而更尖

**正文（中文）**

大多数团队留着 `tsc --noEmit`，不是因为喜欢写注解，而是因为没有别的 CI 门禁。Nudo 的答案不是「再写一套类型语言」，而是：

1. **JS 保持 JS** —— 不改运行时，不发明第二 IR。  
2. **契约按需** —— `*.nudo.js` / `@nudo:contract`，义务只来自你接受的声明。  
3. **单向门** —— `nudo migrate status → strip → verify → retire`。出口是 **retire tsc**，不是双跑。

我们用三个可运行样例钉住了故事：

| 案例 | 依赖 | 终态 |
|------|------|------|
| checkout-demo | 合成小库 | `nudo check` 一门禁 |
| **ms**（vercel/ms） | 真实 npm | 依赖不动，消费方 JS + nudo |
| **debug**（visionmedia/debug） | 真实 npm | 同上；native 返回诚实标 unknown |

```bash
npx nudojs migrate status ./my-pkg
npx nudojs migrate strip ./my-pkg/src --write
npx nudojs check ./my-pkg/src
npx nudojs migrate retire ./my-pkg --dry-run
```

违例读起来是值和谓词，不是类型名：

```text
actual:   0  #exact
expected: ms > 0
→ use a value satisfying ms > 0
fix:  nudo contract --draft
```

**不是「报得更多」，是「报得更真、带证据、带下一步」。**

全文与可运行矩阵：  
https://nudojs.github.io/nudo/docs/guides/case-study-retire

---

## 2. Hacker News / Reddit 标题 + 导语

**Title**  
Show HN: Nudo – retire tsc on JavaScript packages (real `ms` / `debug` case studies)

**Body**

We built a type/contract gate for JavaScript that replaces `tsc --noEmit` on JS packages — no type language, contracts are optional `*.nudo.js` builders, migration is a one-way `migrate retire` (including GHA workflow rewrite).

Runnable stories: public checkout-demo + real npm `ms` and `debug` consumers.

- Case study: https://nudojs.github.io/nudo/docs/guides/case-study-retire  
- Error faces (actual/expected/fix): https://nudojs.github.io/nudo/docs/guides/error-faces  
- 10-minute mental model: https://nudojs.github.io/nudo/docs/getting-started/mental-model  

Not trying to beat TypeScript at the full type language — we win on zero annotations, runtime-true values, sharper Preds (`x>0 ⇒ x+1>1`), and a 7-day retire path.

**中文导语（即刻 / 微博）**

> JS 包上的 `tsc --noEmit` 可以退役了。Nudo：零注解起步、契约按需、违例是「值 ⊭ 谓词 + 下一步」。真实包 `ms` / `debug` 案例可跑。出口是 `migrate retire`，不是双跑。  
> https://nudojs.github.io/nudo/docs/guides/case-study-retire

---

## 3. Release notes 片段（GitHub / npm）

```markdown
## Retire tsc on JavaScript packages

- `nudo migrate retire --all` batches workspace packages and rewrites `tsc` lines in `.github/workflows`
- Real-package case studies: `ms` (vercel/ms) and `debug` (visionmedia/debug) — see [Case study: retire tsc](https://nudojs.github.io/nudo/docs/guides/case-study-retire)
- Bare JS package entries are executed (returns fold instead of `unknown` stubs)
- Error faces: `actual` / `expected` / `fix: nudo contract --draft` — [error-faces](https://nudojs.github.io/nudo/docs/guides/error-faces)
- Budget observability: `check --json` carries call/fork usage + `budgetTruncated`
```

---

## 4. 发出前检查清单

- [ ] `pnpm run verify:examples`（240 pins）绿  
- [ ] `pnpm run docs:build` 双语绿  
- [ ] 站内 case study / error-faces / mental-model 可打开  
- [ ] 链接指向 **nudojs.github.io/nudo** 正式域名  
- [ ] 不承诺 soundness / 类型语言全集（战略红线）
