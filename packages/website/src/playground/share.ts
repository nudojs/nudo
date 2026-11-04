/**
 * 分享链接编解码（纯函数，无 window/框架依赖，vitest 直测）。
 *
 * 方案：源码与预设 id 编码进 location.hash（`#code=<b64>&sidecar=<b64>&preset=<id>`）。
 * 值编码沿用站点既有契约 `btoa(encodeURIComponent(x))` ↔ `decodeURIComponent(atob(raw))`
 * （remark-pair-sidecar 预编码主码用的同一条链）；经 URLSearchParams 序列化时
 * base64 的 `+` `/` `=` 自动转义，读取侧同样走 URLSearchParams，round-trip 无损。
 *
 * 防超长：整条 URL 超过 MAX_SHARE_URL_LENGTH 时按「先截 sidecar、再截主码」的
 * 顺序在源码前缀上二分，保证产出的 URL 落在预算内，并把截断事实返回给 UI 提示。
 */

/** 链接总长上限（含 origin+path）。现代浏览器远高于此，取保守值兼容聊天工具/markdown 粘贴面。 */
export const MAX_SHARE_URL_LENGTH = 8000;

export function encodeShareValue(value: string): string {
  return btoa(encodeURIComponent(value));
}

export function decodeShareValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(atob(raw));
  } catch {
    return null;
  }
}

export interface ShareParams {
  code: string | null;
  sidecar: string | null;
  preset: string | null;
}

/**
 * 解析 `#code=…&sidecar=…&preset=…` 形态的参数串。`#`/`?` 前缀可省；
 * 值按 `decodeShareValue` 解码，坏值归 null（不抛）。
 */
export function parseShareParams(raw: string): ShareParams {
  const params = new URLSearchParams(raw.replace(/^[#?]/, ''));
  return {
    code: decodeShareValue(params.get('code')),
    sidecar: decodeShareValue(params.get('sidecar')),
    // preset id 是 ASCII，不走 base64（与 code/sidecar 的编码链区分开）
    preset: params.get('preset'),
  };
}

export interface ShareLinkInput {
  preset: string;
  code: string;
  /** 仅 sidecar 布局需要；undefined = 不写 sidecar 参数 */
  sidecar?: string;
}

export interface ShareLink {
  /** `#code=…&sidecar=…&preset=…`（URLSearchParams 序列化，已转义 + / =） */
  hash: string;
  /** baseUrl + hash，长度保证 ≤ MAX_SHARE_URL_LENGTH */
  url: string;
  truncatedCode: boolean;
  /** 主码实际保留的源码字符数（未截断时 === code.length） */
  codeChars: number;
  truncatedSidecar: boolean;
}

function serialize(code: string, sidecar: string | undefined, preset: string): string {
  const params = new URLSearchParams();
  params.set('code', encodeShareValue(code));
  if (sidecar !== undefined) params.set('sidecar', encodeShareValue(sidecar));
  params.set('preset', preset);
  return params.toString();
}

/** 在 [0, source.length] 上二分「序列化后仍落在预算内」的最大前缀长度 */
function fitPrefix(
  baseUrl: string,
  source: string,
  build: (value: string) => string,
): number {
  const fits = (value: string): boolean =>
    baseUrl.length + 1 + build(value).length <= MAX_SHARE_URL_LENGTH;
  let lo = 0;
  let hi = source.length;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo + 1) / 2);
    if (fits(source.slice(0, mid))) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function buildShareLink(baseUrl: string, input: ShareLinkInput): ShareLink {
  const full = serialize(input.code, input.sidecar, input.preset);
  if (baseUrl.length + 1 + full.length <= MAX_SHARE_URL_LENGTH) {
    return {
      hash: `#${full}`,
      url: `${baseUrl}#${full}`,
      truncatedCode: false,
      codeChars: input.code.length,
      truncatedSidecar: false,
    };
  }
  // 超预算：先截 sidecar（次要面板）到「preset + sidecar + 空 code」可容纳；
  // 再用截断后的 sidecar 截主码。两侧都是前缀二分，确定性、无相互循环。
  let sidecar = input.sidecar;
  let truncatedSidecar = false;
  if (sidecar !== undefined) {
    const keep = fitPrefix(baseUrl, sidecar, (s) => serialize('', s, input.preset));
    sidecar = sidecar.slice(0, keep);
    truncatedSidecar = keep < input.sidecar!.length;
  }
  const codeKeep = fitPrefix(baseUrl, input.code, (c) => serialize(c, sidecar, input.preset));
  const code = input.code.slice(0, codeKeep);
  const query = serialize(code, sidecar, input.preset);
  return {
    hash: `#${query}`,
    url: `${baseUrl}#${query}`,
    truncatedCode: codeKeep < input.code.length,
    codeChars: codeKeep,
    truncatedSidecar,
  };
}
