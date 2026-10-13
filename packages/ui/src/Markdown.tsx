import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { Element } from 'hast'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from './i18n.ts'
import { useTouch } from './touch/context.tsx'
import { Icon } from './touch/icons.tsx'
import { fenceClosed } from './touch/widget.ts'

// How long the copy button shows its tick after a copy (ms).
const COPIED_MS = 1500

// A code block with a button that copies its text (a toast, and a tick for a moment; a toast if it failed).
// children: the block's content as react-markdown renders it.
function CodeBlock({ children }: { children?: ReactNode }) {
  const { toast } = useTouch()
  const pre = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = () =>
    (navigator.clipboard?.writeText(pre.current?.textContent ?? '') ?? Promise.reject(new Error('no clipboard'))).then(
      () => {
        toast(t('codeCopied'))
        setCopied(true)
        setTimeout(() => setCopied(false), COPIED_MS)
      },
      () => toast(t('copyFailed'))
    )
  return (
    <div className="code-block">
      <pre ref={pre}>{children}</pre>
      <button type="button" className={`copy-code${copied ? ' done' : ''}`} aria-label={t(copied ? 'codeCopied' : 'copyCode')} title={t('copyCode')} onClick={() => void copy()}>
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </div>
  )
}

// A web address alone, as Claude often writes one in inline code (`https://…`): no spaces, http or https.
const BARE_URL = /^https?:\/\/\S+$/

// A fenced code block as the chat may show it instead of code: its class ("language-x"), its text, and whether its
// closing fence has arrived (a streaming reply may still be writing it).
export type FencedBlock = { className?: string; body: string; closed: boolean }
// Shows a fenced block some other way (a chat widget); undefined: as code.
export type RenderBlock = (block: FencedBlock) => ReactNode | undefined

// The text of a hast element's children (a code element holds text nodes only).
function textOf(element: Element): string {
  return element.children.map((child) => (child.type === 'text' ? child.value : child.type === 'element' ? textOf(child) : '')).join('')
}

// Untrusted markdown (assistant text, plans): raw HTML is never rendered (react-markdown default, no rehype-raw),
// images become links so a prompt-injected image cannot leak data by loading a URL, and links open outside.
// openExternal: opens an http(s) link in the system browser (desktop); absent → links are inert text.
// renderBlock: shows some fenced blocks another way (assistant replies: widgets). Keep it stable: the components are
// memoised on it, so a streaming reply does not remount what is already shown (a widget's frame would reload).
export function Markdown({ text, openExternal, renderBlock }: { text: string; openExternal?: (url: string) => void; renderBlock?: RenderBlock }) {
  const source = useRef(text)
  source.current = text
  const components = useMemo<Components>(() => {
    // Clicking a link never navigates the app window.
    const follow = (href: string | undefined) => (event: React.MouseEvent) => {
      event.preventDefault()
      if (href) openExternal?.(href)
    }
    return {
      pre: ({ node, children }) => {
        const code = node?.children[0]
        if (renderBlock && code?.type === 'element' && code.tagName === 'code') {
          const { start, end } = node?.position ?? {}
          const closed = start?.offset !== undefined && end?.offset !== undefined && fenceClosed(source.current.slice(start.offset, end.offset))
          const className = Array.isArray(code.properties.className) ? code.properties.className.join(' ') : undefined
          const shown = renderBlock({ className, body: textOf(code), closed })
          if (shown !== undefined) return shown
        }
        return <CodeBlock>{children}</CodeBlock>
      },
      // Inline code holding just a web address is a link too (a block's code ends with a newline, so it never matches).
      code: ({ children, className }) => {
        const url = typeof children === 'string' && !className && BARE_URL.test(children) ? children : undefined
        const code = <code className={className}>{children}</code>
        return url ? (
          <a href={url} onClick={follow(url)}>
            {code}
          </a>
        ) : (
          code
        )
      },
      a: ({ href, children }) => (
        <a href={href} onClick={follow(href)}>
          {children}
        </a>
      ),
      img: ({ src, alt }) => {
        const href = typeof src === 'string' ? src : undefined
        return (
          <a href={href} onClick={follow(href)}>
            {alt || href}
          </a>
        )
      }
    }
  }, [openExternal, renderBlock])
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  )
}
