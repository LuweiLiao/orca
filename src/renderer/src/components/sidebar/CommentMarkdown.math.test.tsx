// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CommentMarkdown from './CommentMarkdown'

afterEach(cleanup)

// The reply from the bug report: display math in `\[…\]`, text math in `\(…\)`.
const REPLY = [
  '行列式计算我重新核过，是对的。但按它自己的模型，',
  '\\[',
  '\\tau_y=(h-c_z)(X_1+X_2)+c_x(Z_1+Z_2).',
  '\\]',
  '在无外力的水平悬停中，竖直推力为 \\(mg\\)，于是 \\(\\tau_y=c_xmg\\)。'
].join('\n')

function formulas(container: HTMLElement): { display: string[]; inline: string[] } {
  const tex = (element: Element): string =>
    element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? ''
  return {
    display: Array.from(container.querySelectorAll('.katex-display'), tex),
    inline: Array.from(container.querySelectorAll(':not(.katex-display) > .katex'), tex)
  }
}

describe('comment markdown math', () => {
  it('typesets the display and text math an agent writes', () => {
    const { container } = render(<CommentMarkdown content={REPLY} variant="document" math />)
    expect(formulas(container)).toEqual({
      display: ['\\tau_y=(h-c_z)(X_1+X_2)+c_x(Z_1+Z_2).'],
      inline: ['mg', '\\tau_y=c_xmg']
    })
    expect(container.textContent).not.toContain('\\[')
  })

  it('keeps prices and variables as text beside a real formula', () => {
    const { container } = render(
      <CommentMarkdown
        content="价格是 $5 和 $10，`echo $HOME`，而 $a_1 + b_1$ 成立。"
        variant="document"
        math
      />
    )
    expect(formulas(container)).toEqual({ display: [], inline: ['a_1 + b_1'] })
    expect(container.textContent).toContain('价格是 $5 和 $10')
    expect(container.querySelector('code')?.textContent).toBe('echo $HOME')
    // The subscripts stayed TeX, not emphasis.
    expect(container.querySelector('em')).toBeNull()
  })

  it('fades the words around a formula without splitting its typeset glyphs', () => {
    const { container } = render(
      <CommentMarkdown content={REPLY} variant="document" math fadeWords />
    )
    expect(formulas(container).inline).toEqual(['mg', '\\tau_y=c_xmg'])
    expect(container.querySelector('[data-word-group]')).not.toBeNull()
    expect(container.querySelector('.katex [data-word-group]')).toBeNull()
  })

  it('shows a formula KaTeX cannot parse as its source', () => {
    const broken = 'see \\(\\frac{1}{\\)'
    const { container } = render(<CommentMarkdown content={broken} variant="document" math />)
    expect(container.querySelector('.katex-error')?.textContent).toBe('\\frac{1}{')
  })

  it('leaves other markdown surfaces without math', () => {
    const source = 'cost $x$ and \\(y\\)'
    const { container } = render(<CommentMarkdown content={source} />)
    expect(container.querySelector('.katex')).toBeNull()
    expect(container.textContent).toBe('cost $x$ and (y)')
  })

  it('streams a formula to the same document as the finished reply', () => {
    // The rendered blocks, without the line breaks between them, which lay out as nothing.
    const blocksOf = (container: HTMLElement): string[] =>
      Array.from(container.firstElementChild?.children ?? [], (block) => block.outerHTML)
    const whole = render(<CommentMarkdown content={REPLY} variant="document" math />)
    const expected = blocksOf(whole.container)
    whole.unmount()

    const streamed = render(<CommentMarkdown content="" variant="document" math growing />)
    for (let end = 3; end < REPLY.length + 3; end += 3) {
      streamed.rerender(
        <CommentMarkdown content={REPLY.slice(0, end)} variant="document" math growing />
      )
    }
    streamed.rerender(<CommentMarkdown content={REPLY} variant="document" math />)
    expect(blocksOf(streamed.container)).toEqual(expected)
  })
})
