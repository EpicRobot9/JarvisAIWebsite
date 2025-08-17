import React, { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

type Props = { content: string }

export default function Markdown({ content }: Props) {
  // Memoize to avoid re-highlighting on every render
  const text = useMemo(() => content ?? '', [content])
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...rest }) {
            const url = String(href || '')
            return (
              <a href={url} target="_blank" rel="noopener noreferrer" className="jarvis-link" {...rest}>
                {children}
              </a>
            )
          },
          code(codeProps) {
            const { node, className, children, ...rest } = codeProps as any
            const match = /language-(\w+)/.exec(className || '')
            const raw = String(children || '')
            // react-markdown v9 doesn't expose `inline` prop; infer by tagName
            const isInline = (node as any)?.tagName === 'code'
            if (isInline) {
              return (
                <code className="inline-code" {...rest}>{raw}</code>
              )
            }
            return <CodeBlock code={raw} lang={(match && match[1]) || undefined} />
          }
        }}
      >
        {text}
      </ReactMarkdown>
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
          background: 'rgba(9, 18, 38, 0.7)'
        }}
        wrapLongLines
      >
        {clean}
      </SyntaxHighlighter>
    </div>
  )
}
