---
"@nudojs/service": patch
---

fix(service): `@nudo:env` 多名合并取**并集**（顺序无关）——Bug 1045

`@nudo:env node, web` 与 `@nudo:env web, node` 此前得到**两张不同的全局表**
（`packages/service/src/evaluator/env-loader.ts` · `applyEnvDefinition` 对同名
全局做**整块替换**，后一个 env 赢）⇒ **同一份源码**只因 env 名书写顺序不同，
签名不同、门禁结论相反（`OK` vs `FAILED`：`performance.toJSON` 在 web 有、
node 无 ⇒ 顺序换成 node 赢时 `pf()` 被判「必抛 TypeError」）——与文档承诺的
「env 名之间是 union」相悖。

合并改为并集：

- **obj ⊕ obj** ⇒ 逐槽并集（同名槽的值域再并集，不折「后者赢」）；
- **brand ⊕ brand**（同名同 tag）⇒ 内层并集，保留品牌名；
- **其余形态**（fn ⊕ fn / obj ⊕ brand / prim ⊕ prim …）⇒ 值域并集（sum）；
- **模块侧**同名导出名同样取并集，不再 last-wins；
- `globalEnv.bind` 绑**合并后**的值（全局表与 globalEnv 不再分叉）。

并集满足三条纪律，缺一条就会退回「顺序敏感」：**可交换**（sum 成员按结构键
排序——core 的 `makeSum` 按入参顺序排成员）、**可结合**（值域并集是「成员集合
的并」而非两两折叠）、**不丢实现**（fn 的 relation / apply 挂在 Abs 对象上，
并集成员保留原对象，不复制不重建）。

单 env（只写 `@nudo:env web` / `node`）行为**逐字不变**：同名声明若结构同构
则直接取同一份对象 ⇒ 全局表与 env 自身声明逐字相同。
