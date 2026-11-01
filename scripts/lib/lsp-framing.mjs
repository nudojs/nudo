/**
 * LSP stdio framing（`Content-Length` 定长切帧）单一真源 —— 冒烟脚本共用
 * （`scripts/` 下直接 import `./lib/lsp-framing.mjs`；包内脚本
 * `packages/{vscode,lsp}/scripts/` 用相对路径 `../../../scripts/lib/…`）。
 * 此前 vscode `smoke.mjs` 与 lsp `smoke-stdio.mjs` 各手抄同一循环
 * （找头 → 正则取长度 → 定长切帧 → JSON.parse → buf 前移），坏头跳帧 /
 * 半帧等待等细节一旦单边修掉就会漂移：同一服务器一个脚本能解帧、另一个死等。
 */

/**
 * 创建增量帧读取器：把 `child.stdout` 的 chunk 逐段喂进返回的函数，
 * 每解出一条 JSON 消息回调一次 `onMessage`。
 *
 * - 坏头（无 `Content-Length`）：跳过这段头继续找下一帧（不卡死）。
 * - body 不完整：留在缓冲里等下一个 chunk。
 * - `JSON.parse` 失败：跳过该帧（冒烟脚本不因单帧坏包中断）。
 *
 * @param {(msg: any) => void} onMessage
 * @returns {(chunk: Buffer) => void}
 */
export function createFrameReader(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;
      const header = buf.subarray(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        buf = buf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      const bodyStart = headerEnd + 4;
      if (buf.length < bodyStart + len) break;
      const body = buf.subarray(bodyStart, bodyStart + len).toString("utf8");
      buf = buf.subarray(bodyStart + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      onMessage(msg);
    }
  };
}
