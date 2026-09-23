import React, {useState, type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Translate from '@docusaurus/Translate';
import TagsListInline from '@theme/TagsListInline';

import EditMetaRow from '@theme/EditMetaRow';

const FEEDBACK_KEY = 'nudo-doc-feedback';

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
