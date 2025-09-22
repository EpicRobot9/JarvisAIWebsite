import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { defaultSchema } from 'hast-util-sanitize'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import Mermaid from './Mermaid'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

type Props = {
  content: string
  prefs?: {
    icon?: 'triangle' | 'chevron' | 'plusminus'
    color?: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose'
    expandAll?: boolean
    expandCategories?: boolean
  }
}

export default function Markdown({ content, prefs }: Props) {
  const text = useMemo(() => content ?? '', [content])
  const icon = prefs?.icon || 'triangle'
  const color = prefs?.color || 'slate'
  const expandAll = !!prefs?.expandAll
  const expandCategories = !!prefs?.expandCategories
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const details = Array.from(el.querySelectorAll('details')) as HTMLDetailsElement[]
    if (expandAll) {
      details.forEach(d => { try { d.open = true } catch {} })
    } else if (expandCategories) {
      details.forEach(d => {
        const isNested = !!d.closest('details details')
        if (!isNested) { try { d.open = true } catch {} }
      })
    }
  }, [text, expandAll, expandCategories])

  return (
    <div className="markdown" data-icon={icon} data-color={color} ref={containerRef}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, {
            ...defaultSchema,
            tagNames: [...(defaultSchema.tagNames || []), 'details', 'summary'],
            attributes: {
              ...(defaultSchema.attributes || {}),
              details: ['open'],
              summary: []
            }
          }]
        ]}
        components={{
          a({ href, children, ...rest }) {
            const url = String(href || '')
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="jarvis-link" {...rest}>
                {children}
              </a>
            )
          },
          code(p: any) {
            const { inline, className, children, ...rest } = p || {}
            const langMatch = /language-(\w+)/.exec(String(className || ''))
            const raw = String(children ?? '')
            const isInline = inline ?? (!raw.includes('\n') && !langMatch)
            if (isInline) return <code className="inline-code" {...rest}>{raw}</code>
            // Render Mermaid diagrams when language is mermaid
            if ((langMatch && langMatch[1] === 'mermaid') || /^\s*(graph|sequenceDiagram|classDiagram|flowchart|erDiagram)\s/.test(raw)) {
              return <Mermaid chart={raw} />
            }
            return <CodeBlock code={raw} lang={(langMatch && (langMatch[1] as string)) || undefined} />
          }
        }}
      >
        {text}
      </ReactMarkdown>
      <style>{`
        .markdown details {
          margin: 0.5rem 0;
          background: rgba(7, 12, 24, 0.6);
          border: 1px solid #0f172a;
          border-radius: 8px;
        }
        .markdown summary {
          cursor: pointer;
          padding: 0.5rem 0.75rem;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--sum-color, #e2e8f0);
          list-style: none;
        }
        .markdown summary::-webkit-details-marker { display: none; }
        /* Icon variants */
        .markdown[data-icon='triangle'] summary::before {
          content: '▸';
          display: inline-block;
          margin-right: 0.5rem;
          transition: transform 0.15s ease;
        }
        .markdown[data-icon='triangle'] details[open] summary::before { transform: rotate(90deg); }
        .markdown[data-icon='chevron'] summary::before {
          content: '›';
          display: inline-block;
          margin-right: 0.5rem;
          transition: transform 0.15s ease;
        }
        .markdown[data-icon='chevron'] details[open] summary::before { transform: rotate(90deg); }
        .markdown[data-icon='plusminus'] summary::before {
          content: '+';
          display: inline-block;
          margin-right: 0.5rem;
        }
        .markdown[data-icon='plusminus'] details[open] summary::before { content: '−'; }
        .markdown details > *:not(summary) {
          padding: 0.5rem 0.75rem 0.75rem;
        }
        /* Color accents */
        .markdown[data-color='slate'] { --sum-color: #e2e8f0; }
        .markdown[data-color='blue'] { --sum-color: #bfdbfe; }
        .markdown[data-color='emerald'] { --sum-color: #a7f3d0; }
        .markdown[data-color='amber'] { --sum-color: #fde68a; }
        .markdown[data-color='rose'] { --sum-color: #fecdd3; }
      `}</style>
    </div>
  )
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const clean = code.replace(/\n$/, '')
  async function copy() {
    try {
      await navigator.clipboard.writeText(clean)
      setCopied(true)
      setTimeout(()=>setCopied(false), 1200)
    } catch {}
  }
  return (
    <div className="code-wrap">
      <div className="code-toolbar">
        <div className="code-lang">{lang || 'text'}</div>
        <button className="code-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          background: 'rgba(9, 18, 38, 0.7)',
          overflowX: 'auto'
        }}
        wrapLongLines
      >
        {clean}
      </SyntaxHighlighter>
    </div>
  )
}
