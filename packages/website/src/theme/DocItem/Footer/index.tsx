import React, {useState, type ReactNode} from 'react';
import clsx from 'clsx';
import useIsBrowser from '@docusaurus/useIsBrowser';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Translate from '@docusaurus/Translate';
import TagsListInline from '@theme/TagsListInline';

import EditMetaRow from '@theme/EditMetaRow';

const FEEDBACK_KEY = 'nudo-doc-feedback';

/**
 * 每页 agent 面：文档页在构建期旁挂同名 `.md`（scripts/gen-llms.mjs），
 * 这里提供「复制 markdown」与「在 ChatGPT / Claude 打开」。
 * 取不到 .md（本地 dev 未生成）时退化为复制页面 URL，不报错。
 */
function AgentActions({permalink, title}: {permalink?: string; title?: string}): ReactNode {
  const [copied, setCopied] = useState(false);
  // SSR 渲染时 window 不存在；useIsBrowser 在挂载后触发重渲染，
  // 否则 href 会停留在服务端算出的空 prompt（React 不会为 hydration 差异重算属性）。
  const isBrowser = useIsBrowser();

  const copyMarkdown = async () => {
    if (!isBrowser) return;
    try {
      const res = await fetch(`${window.location.pathname}.md`, {headers: {accept: 'text/markdown'}});
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
    } catch {
      await navigator.clipboard.writeText(window.location.href);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const prompt = isBrowser
    ? encodeURIComponent(
        `Read ${window.location.origin}${permalink ?? window.location.pathname}${title ? ` (${title})` : ''} and help me with it.`,
      )
    : '';

  return (
    <div className="doc-agent-actions">
      <button type="button" className="doc-agent-button" onClick={copyMarkdown}>
        {copied
          ? <Translate id="theme.DocItem.agent.copied">Copied!</Translate>
          : <Translate id="theme.DocItem.agent.copyMarkdown">Copy as Markdown</Translate>}
      </button>
      <a
        className="doc-agent-button"
        href={`https://chatgpt.com/?q=${prompt}`}
        target="_blank"
        rel="noopener noreferrer">
        <Translate id="theme.DocItem.agent.openChatGPT">Open in ChatGPT</Translate>
      </a>
      <a
        className="doc-agent-button"
        href={`https://claude.ai/new?q=${prompt}`}
        target="_blank"
        rel="noopener noreferrer">
        <Translate id="theme.DocItem.agent.openClaude">Open in Claude</Translate>
      </a>
      <span className="doc-agent-hint">
        <Translate id="theme.DocItem.agent.hint">
          Agent-facing: every page ships as raw markdown at this URL + `.md`.
        </Translate>
      </span>
    </div>
  );
}

function FeedbackRow({issueUrl}: {issueUrl: string}): ReactNode {
  const [vote, setVote] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(FEEDBACK_KEY);
  });

  const thanks = vote === 'yes' || vote === 'no';

  return (
    <div className="doc-feedback margin-top--md">
      <span className="doc-feedback-question">
        <Translate id="theme.DocItem.footer.feedback.question">
          Was this page helpful?
        </Translate>
      </span>
      {thanks ? (
        <span className="doc-feedback-thanks">
          <Translate id="theme.DocItem.footer.feedback.thanks">
            Thanks for the feedback!
          </Translate>
        </span>
      ) : (
        <>
          <button
            type="button"
            className="doc-feedback-button"
            aria-label="Yes, this page was helpful"
            onClick={() => {
              window.localStorage.setItem(FEEDBACK_KEY, 'yes');
              setVote('yes');
            }}>
            <Translate id="theme.DocItem.footer.feedback.yes">Yes</Translate>
          </button>
          <a
            className="doc-feedback-button doc-feedback-link"
            href={issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="No, this page needs work — report an issue"
            onClick={() => {
              window.localStorage.setItem(FEEDBACK_KEY, 'no');
              setVote('no');
            }}>
            <Translate id="theme.DocItem.footer.feedback.no">No</Translate>
          </a>
        </>
      )}
    </div>
  );
}

export default function DocItemFooter(): ReactNode {
  const {metadata} = useDoc();
  const {editUrl, lastUpdatedAt, lastUpdatedBy, tags} = metadata;

  const canDisplayTagsRow = tags.length > 0;
  const canDisplayEditMetaRow = !!(editUrl || lastUpdatedAt || lastUpdatedBy);

  // 「No」不再跳编辑页：预填 issue（带页面路径与 locale），反馈能真正被收集。
  const issueUrl = `https://github.com/nudojs/nudo/issues/new?title=${encodeURIComponent(
    `Docs feedback: ${metadata.permalink ?? metadata.title ?? ""}`,
  )}&labels=documentation`;

  return (
    <footer
      className={clsx(ThemeClassNames.docs.docFooter, 'docusaurus-mt-lg')}>
      {canDisplayTagsRow && (
        <div
          className={clsx(
            'row margin-top--sm',
            ThemeClassNames.docs.docFooterTagsRow,
          )}>
          <div className="col">
            <TagsListInline tags={tags} />
          </div>
        </div>
      )}
      <AgentActions permalink={metadata.permalink} title={metadata.title} />
      <FeedbackRow issueUrl={issueUrl} />
      {canDisplayEditMetaRow && (
        <EditMetaRow
          className={clsx(
            'margin-top--sm',
            ThemeClassNames.docs.docFooterEditMetaRow,
          )}
          editUrl={editUrl}
          lastUpdatedAt={lastUpdatedAt}
          lastUpdatedBy={lastUpdatedBy}
        />
      )}
    </footer>
  );
}
