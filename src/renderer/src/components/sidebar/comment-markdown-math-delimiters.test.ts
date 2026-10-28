import { describe, expect, it } from 'vitest'
import { normalizeMarkdownMathDelimiters } from './comment-markdown-math-delimiters'

describe('normalizeMarkdownMathDelimiters', () => {
  it.each([
    ['设 $x$ 为变量，$a+b$', '设 $$x$$ 为变量，$$a+b$$'],
    ['where $a_1 + b_1$ holds', 'where $$a_1 + b_1$$ holds'],
    ['费用 $5，公式 $x^2$', '费用 $5，公式 $$x^2$$'],
    ['($x$) and $f(x)$.', '($$x$$) and $$f(x)$$.'],
    ['\\(\\tau_y\\) 和 \\(c_x\\)', '$$\\tau_y$$ 和 $$c_x$$'],
    ['so \\[x = 1\\] inline', 'so $$x = 1$$ inline'],
    ['$$E = mc^2$$', '$$E = mc^2$$']
  ])('reads %j as math', (source, expected) => {
    expect(normalizeMarkdownMathDelimiters(source)).toBe(expected)
  })

  it.each([
    '价格是 $5 和 $10',
    'echo $HOME and $PATH',
    'copy $HOME/$USER there',
    'from $5-$10 a month',
    'US$500 or US$600',
    'a $ b $ c',
    'one \\$5 and \\$x\\$',
    'run `echo $HOME $x$` now',
    '```sh\nexport A=$x$\n```',
    '[a \\[b\\] title](orca-conversation://reference/x?host=local)',
    'an empty \\(\\) pair'
  ])('leaves %j as text', (source) => {
    expect(normalizeMarkdownMathDelimiters(source)).toBe(source)
  })

  it('keeps a `$` pair on one line', () => {
    expect(normalizeMarkdownMathDelimiters('costs $x\nand y$ more')).toBe('costs $x\nand y$ more')
  })

  it('turns `\\[…\\]` on lines of its own into display math', () => {
    expect(normalizeMarkdownMathDelimiters('Torque:\n\\[\n\\tau_y = c_x m g\n\\]\nso')).toBe(
      'Torque:\n$$\n\\tau_y = c_x m g\n$$\nso'
    )
    expect(normalizeMarkdownMathDelimiters('\\[ x = 1 \\]')).toBe('$$\nx = 1\n$$')
  })

  it('keeps display math inside its list item and quote', () => {
    expect(normalizeMarkdownMathDelimiters('1. Model:\n   \\[\n   x\n   \\]')).toBe(
      '1. Model:\n   $$\n   x\n   $$'
    )
    expect(normalizeMarkdownMathDelimiters('> \\[\n> x\n> \\]')).toBe('> $$\n> x\n> $$')
    expect(normalizeMarkdownMathDelimiters('- \\[x\\]')).toBe('- $$\n  x\n  $$')
  })

  it('shows an unclosed `$$` as text, so a streamed formula never swallows the reply', () => {
    expect(normalizeMarkdownMathDelimiters('so $$x + ')).toBe('so \\$\\$x + ')
    expect(normalizeMarkdownMathDelimiters('$$\nx\n\ny\n$$')).toBe('$$\nx\n\ny\n$$')
  })
})
