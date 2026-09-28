/**
 * remark 插件：为 ```js verify-sidecar``` 围栏配对最近的前置 ```js verify``` 主代码，
 * 供 CodeBlock 生成双栏 Playground 链接（playground 支持 ?code=&sidecar= 双参数；
 * sidecar 围栏自身只有契约半边，主码取配对源）。
 *
 * 机制：fenced code 的 mdast `node.data.hProperties` 会成为 CodeBlock 组件 props
 * （docusaurus codeCompatPlugin 注入 `metastring` 用的同一条链路）。写入的
 * `playgroundMain` 已按 Playground 解码格式预编码 —— `decodeURIComponent(atob(raw))`，
 * 即 `btoa(encodeURIComponent(value))`；encodeURIComponent 输出必为 ASCII，
 * Node ≥16 的全局 btoa 处理安全。没有前置 verify 源的 sidecar 围栏不设该属性
 * （CodeBlock 保持无链接）。
 */

/** mdast 局部结构类型（不引入 unist/mdast 依赖） */
interface MdastNode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  children?: MdastNode[];
  data?: {hProperties?: Record<string, unknown>} | null;
}

interface MdastRoot extends MdastNode {
  children: MdastNode[];
}

const MAIN_LANGUAGES = new Set(['js', 'javascript']);

function fenceMeta(node: MdastNode): string[] {
  return (node.meta ?? '').split(/\s+/).filter(Boolean);
}

/** ```js verify``` —— 可作为 sidecar 配对源的主代码围栏（verify-sidecar 不算源） */
function isVerifyFence(node: MdastNode): boolean {
  return (
    node.type === 'code' &&
    MAIN_LANGUAGES.has(node.lang ?? '') &&
    fenceMeta(node).includes('verify')
  );
}

/** ```js verify-sidecar``` —— 契约围栏，等待配对 */
function isSidecarFence(node: MdastNode): boolean {
  return (
    node.type === 'code' &&
    MAIN_LANGUAGES.has(node.lang ?? '') &&
    fenceMeta(node).includes('verify-sidecar')
  );
}

/**
 * 按文档序深度优先遍历：命中 verify 围栏就更新配对源（中间的其它块不重置），
 * 命中 verify-sidecar 围栏且当前有配对源时写入预编码主码。多个 sidecar
 * 可共享同一配对源，配对源用后不清除。
 */
function pairSidecar(root: MdastRoot): void {
  let pairedMain: string | undefined;
  const visit = (node: MdastNode): void => {
    if (isVerifyFence(node) && typeof node.value === 'string') {
      pairedMain = node.value;
    } else if (isSidecarFence(node) && pairedMain !== undefined) {
      node.data = node.data ?? {};
      node.data.hProperties = node.data.hProperties ?? {};
      node.data.hProperties.playgroundMain = btoa(encodeURIComponent(pairedMain));
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
}

/** remark/unified 插件（返回 transformer；签名按结构匹配，不 import unified 类型） */
export function remarkPairSidecarPlayground(): (root: MdastRoot) => void {
  return pairSidecar;
}

export default remarkPairSidecarPlayground;
