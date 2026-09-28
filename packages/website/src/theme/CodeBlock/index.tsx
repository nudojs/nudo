import React, {isValidElement, useMemo, type ReactNode} from 'react';
import useIsBrowser from '@docusaurus/useIsBrowser';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Translate from '@docusaurus/Translate';
// LSP-G8：经根级 shim 导入——Docusaurus v4 若上提 Content/*，只改 shim
import ElementContent from './Element';
import StringContent from './String';
import type {Props} from '@theme/CodeBlock';

/**
 * Best attempt to make the children a plain string so it is copyable. If there
 * are react elements, we will not be able to copy the content, and it will
 * return `children` as-is; otherwise, it concatenates the string children
 * together.
 */
function maybeStringifyChildren(children: ReactNode): ReactNode {
  if (React.Children.toArray(children).some((el) => isValidElement(el))) {
    return children;
  }
  // The children is now guaranteed to be one/more plain strings
  return Array.isArray(children) ? children.join('') : (children as string);
}

const RUNNABLE_LANGUAGES = new Set(['js', 'javascript']);

/**
 * Playground preload query for runnable code blocks.
 * The playground decodes each param as `decodeURIComponent(atob(raw))`;
 * `noplayground` meta opts out. Plain `verify`
 * blocks link with `code=<enc(block)>`. `verify-sidecar` blocks (sidecar
 * contract files) link with the dual-pane query
 * `code=<main>&sidecar=<enc(block)>` — the playground opens both panes;
 * `playgroundMain` arrives pre-encoded (`btoa(encodeURIComponent(main))`,
 * same scheme the playground decodes) from the remark-pair-sidecar plugin
 * pairing the fence with the nearest preceding `verify` block; an unpaired
 * sidecar gets no link. Language comes from the prism `language-<lang>`
 * className (md fences do not pass a `language` prop).
 */
function playgroundQuery(
  className: string | undefined,
  metastring: string | undefined,
  playgroundMain: string | undefined,
  code: string,
): string | undefined {
  const language = /language-([\w-]+)/.exec(className ?? '')?.[1];
  if (!RUNNABLE_LANGUAGES.has(language ?? '')) return undefined;
  const meta = metastring?.split(/\s+/) ?? [];
  if (meta.includes('noplayground')) return undefined;
  try {
    // Params are percent-encoded when embedded: URLSearchParams reads a raw
    // `+` in a query value as a space (same reason the playground's own
    // share links go through searchParams.set). playgroundMain is already
    // btoa(encodeURIComponent(main)) — only URL-escape it here, re-running
    // the btoa/encodeURIComponent chain would corrupt it.
    const encoded = encodeURIComponent(btoa(encodeURIComponent(code)));
    if (meta.includes('verify-sidecar')) {
      return playgroundMain
        ? `code=${encodeURIComponent(playgroundMain)}&sidecar=${encoded}`
        : undefined;
    }
    return `code=${encoded}`;
  } catch {
    return undefined;
  }
}

export default function CodeBlock({
  children: rawChildren,
  playgroundMain,
  ...props
}: Props & {playgroundMain?: string}): ReactNode {
  // The Prism theme on SSR is always the default theme but the site theme can
  // be in a different mode. React hydration doesn't update DOM styles that come
  // from SSR. Hence force a re-render after mounting to apply the current
  // relevant styles.
  const isBrowser = useIsBrowser();
  const playgroundBaseUrl = useBaseUrl('/playground');
  const children = maybeStringifyChildren(rawChildren);
  const block =
    typeof children === 'string' ? (
      <StringContent key={String(isBrowser)} {...props}>
        {children}
      </StringContent>
    ) : (
      <ElementContent key={String(isBrowser)} {...props}>
        {children}
      </ElementContent>
    );

  const playgroundHref = useMemo(() => {
    if (typeof children !== 'string') return undefined;
    const query = playgroundQuery(
      props.className,
      props.metastring,
      playgroundMain,
      children,
    );
    return query ? `${playgroundBaseUrl}?${query}` : undefined;
  }, [
    children,
    props.className,
    props.metastring,
    playgroundMain,
    playgroundBaseUrl,
  ]);

  // ```js verify / verify-sidecar``` fences run against the real engine at
  // build time (scripts/verify-doc-examples.sh) — badge both.
  const meta = props.metastring?.split(/\s+/) ?? [];
  const isVerified = meta.includes('verify') || meta.includes('verify-sidecar');

  if (!playgroundHref && !isVerified) return block;

  return (
    <div className="nudo-code-playground">
      <div className="nudo-code-playground-bar">
        {isVerified && (
          <span className="nudo-code-verified">
            <Translate id="theme.CodeBlock.verified">engine-verified</Translate>
          </span>
        )}
        {playgroundHref && (
          <a
            className="nudo-code-playground-link"
            href={playgroundHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this snippet in the browser playground"
          >
            <Translate id="theme.CodeBlock.runInPlayground">
              Run in Playground
            </Translate>
            <span aria-hidden="true"> ↗</span>
          </a>
        )}
      </div>
      {block}
    </div>
  );
}
