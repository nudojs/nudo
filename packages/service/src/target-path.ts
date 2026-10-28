/**
 * nudo 推断目标文件判定（纯扩展名规则，路径无需存在）。
 *
 * 规则：.js / .mjs / .cjs / .ts / .mts / .cts 可作为推断目标；其余扩展
 * （.tsx/.jsx/.d.ts…）一律 false。显式排除：
 *  - .d.ts —— 类型声明文件（harvester 的输入），不是可求值的实现源码；
 *  - .tsx / .jsx —— JSX 构造的求值超出 nudo 推断器范围（真·能力边界，
 *    与 `migrate verify` 的目标集合的差异见下）；
 *  - *.nudo.js / *.nudo.mjs / *.nudo.ts —— 侧车契约模块（interface 绑定源），
 *    不是源码推断目标；目录级 check/infer/doctor 展开不得把它们当实现分析；
 *  - *.nudo.draft.js / *.nudo.draft.mjs / *.nudo.draft.ts —— draft 产物，
 *    明确不被 ambient 绑定，也不得当实现源码分析。
 *
 * ⚠ 覆盖面必须与 `migrate verify` 的目标集合一致（Bug 101）：
 * `migrate retire` 把门禁写成 `nudo check .`，若本函数比 verify 窄，
 * **装出来的门禁在该包上恒红**（对目标目录返回空集 ⇒ `nudo:path-empty-dir`
 * ⇒ exit 1）。此前只允许 .js/.mjs/.ts ⇒ `.mts`/`.cts`/`.cjs` 包的门禁
 * 一装上就是红的。JSX 面是**能力边界**而非集合漂移：verify 侧对
 * `.tsx`/`.jsx` 的分析同样不成立（解析不出 JSX 语义）。
 *
 * 消费方：CLI 的 collectNudoFiles/watch 过滤/doctor 目录展开（.ts 放开后统一
 * 走本函数，避免各处手写 endsWith 漂移），以及 LSP 的 isNudoFile（接线由
 * LSP 侧负责）。
 */
export function isNudoTargetPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) {
    return false; // 类型声明，非推断目标
  }
  // 侧车 / draft：先于 .js/.ts 后缀判定，避免 foo.nudo.js 被当成源码目标
  if (
    lower.endsWith(".nudo.js") ||
    lower.endsWith(".nudo.mjs") ||
    lower.endsWith(".nudo.ts") ||
    lower.endsWith(".nudo.draft.js") ||
    lower.endsWith(".nudo.draft.mjs") ||
    lower.endsWith(".nudo.draft.ts")
  ) {
    return false;
  }
  return (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  );
}
