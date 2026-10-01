import React, {useState, type ReactNode} from 'react';
import clsx from 'clsx';
import useIsBrowser from '@docusaurus/useIsBrowser';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Translate from '@docusaurus/Translate';
import TagsListInline from '@theme/TagsListInline';

import EditMetaRow from '@theme/EditMetaRow';
import {buildTechArticleJsonLd, ogImageAlt} from '../../../seo/jsonld.ts';

const FEEDBACK_KEY = 'nudo-doc-feedback';

// DefinePlugin（docusaurus.config.ts）在构建期注入；typeof 守卫让未注入的
// 环境（例如将来其它打包路径）退化为不显示，而不是 ReferenceError。
const ENGINE_VERSION: string =
  typeof __NUDO_ENGINE_VERSION__ === 'string' ? __NUDO_ENGINE_VERSION__ : '';
const DOCS_COMMIT: string =
  typeof __NUDO_DOCS_COMMIT__ === 'string' ? __NUDO_DOCS_COMMIT__ : '';

// 反馈按页存储：全局键会让投一票就全站致谢（pathname 含 locale 前缀，各语言页独立计）
const feedbackStorageKey = () => `${FEEDBACK_KEY}:${window.location.pathname}`;

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

function FeedbackRow({issueUrl, praiseUrl}: {issueUrl: string; praiseUrl: string}): ReactNode {
  const [vote, setVote] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(feedbackStorageKey());
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
        <>
          <span className="doc-feedback-thanks">
            <Translate id="theme.DocItem.footer.feedback.thanks">
              Thanks for the feedback!
            </Translate>
          </span>
          {vote === 'yes' && (
            // 正样本也要能被收集：Yes 只写 localStorage 无法聚合，
            // 追一个预填 issue 的轻入口（与 No 的负反馈对称）。
            <a
              className="doc-feedback-button doc-feedback-link"
              href={praiseUrl}
              target="_blank"
              rel="noopener noreferrer">
              <Translate id="theme.DocItem.footer.feedback.tellUs">
                Tell us what worked
              </Translate>
            </a>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className="doc-feedback-button"
            aria-label="Yes, this page was helpful"
            onClick={() => {
              window.localStorage.setItem(feedbackStorageKey(), 'yes');
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
              window.localStorage.setItem(feedbackStorageKey(), 'no');
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
  const {i18n} = useDocusaurusContext();

  const canDisplayTagsRow = tags.length > 0;
  const canDisplayEditMetaRow = !!(editUrl || lastUpdatedAt || lastUpdatedBy);

  // 逐页结构化数据 + 社交卡片替代文本（站点级图在 docusaurus.config.ts）。
  const articleJsonLd = buildTechArticleJsonLd({
    title: metadata.title,
    description: metadata.description,
    permalink: metadata.permalink,
    locale: i18n.currentLocale,
    lastUpdatedAt: lastUpdatedAt ?? undefined,
  });
  const imageAlt = ogImageAlt(metadata.title);

  // 「No」不再跳编辑页：预填 issue（带页面路径与 locale），反馈能真正被收集。
  const issueUrl = `https://github.com/nudojs/nudo/issues/new?title=${encodeURIComponent(
    `Docs feedback: ${metadata.permalink ?? metadata.title ?? ""}`,
  )}&labels=documentation`;
  // 「Yes」的对称入口：同样进 issue 队列（title 前缀区分正负样本）。
  const praiseUrl = `https://github.com/nudojs/nudo/issues/new?title=${encodeURIComponent(
    `Docs feedback (positive): ${metadata.permalink ?? metadata.title ?? ""}`,
  )}&labels=documentation`;

  return (
    <footer
      className={clsx(ThemeClassNames.docs.docFooter, 'docusaurus-mt-lg')}>
      <Head>
        <meta property="og:type" content="article" />
        <meta property="og:image:alt" content={imageAlt} />
        <meta name="twitter:image:alt" content={imageAlt} />
        <script type="application/ld+json">{JSON.stringify(articleJsonLd)}</script>
      </Head>
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
      <FeedbackRow issueUrl={issueUrl} praiseUrl={praiseUrl} />
      {ENGINE_VERSION && (
        <div className={clsx('doc-provenance', 'margin-top--sm')}>
          <Translate
            id="theme.DocItem.footer.provenance"
            values={{version: ENGINE_VERSION}}>
            {'Docs built against nudojs@{version}'}
          </Translate>
          {DOCS_COMMIT && <span>{` · main@${DOCS_COMMIT}`}</span>}
          {' · '}
          <Link to="/docs/releases">Releases</Link>
        </div>
      )}
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
