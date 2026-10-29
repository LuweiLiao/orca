import { describe, expect, it } from 'vitest'
import { parseSynctex } from './pdf-synctex-parser'
import { synctexForward, synctexIncludesSource, synctexReverse } from './pdf-synctex-lookup'

// Trimmed from a pdflatex -synctex=1 build: line 4 wraps onto two output lines (the second
// line box is tagged with the paragraph's end, line 7), and method.tex is \input on page 1.
const SP = 65781.76
const SYNCTEX = [
  'SyncTeX Version:1',
  'Input:1:/work/paper/./main.tex',
  'Input:5:chapters/method.tex',
  'Output:pdf',
  'Magnification:1000',
  'Unit:1',
  'X Offset:0',
  'Y Offset:0',
  'Content:',
  '!381',
  '{1',
  '[1,10:4736286,46220574:26673152,41484288,0',
  '(1,7:8799518,10300473:22609920,455111,127431',
  'x1,7:10179418,10300473',
  'k1,4:10426427,10300473:247009',
  'x1,4:13342787,10300473',
  'x1,4:20105964,10300473',
  ')',
  '(1,7:8799518,11087721:22609920,455111,127431',
  'x1,5:8799518,11087721',
  'x1,5:15000000,11087721',
  ')',
  '(5,3:8799518,16257220:22609920,455111,127431',
  'x5,3:10000000,16257220',
  'x5,2:11000000,16257220',
  'x5,2:16000000,16257220',
  ')',
  ']',
  '}1',
  '{2',
  '(1,13:8799518,10300473:22609920,455111,127431',
  'x1,13:10891211,10300473',
  'x1,12:12256547,10300473',
  'x1,12:15624374,10300473',
  ')',
  '}2',
  'Postamble:'
].join('\n')

const data = parseSynctex(SYNCTEX, '/work/paper')
const bp = (sp: number): number => sp / SP

describe('SyncTeX', () => {
  it('resolves input paths against the synctex directory', () => {
    expect(synctexIncludesSource(data, '/work/paper/main.tex')).toBe(true)
    expect(synctexIncludesSource(data, '/work/paper/chapters/method.tex')).toBe(true)
    expect(synctexIncludesSource(data, '/work/paper/other.tex')).toBe(false)
  })

  it('finds where a source line landed, by its points rather than the box tags', () => {
    const line4 = synctexForward(data, '/work/paper/main.tex', 4)
    expect(line4?.page).toBe(1)
    expect(line4?.top).toBeCloseTo(bp(10300473 - 455111), 3)
    expect(line4?.height).toBeCloseTo(bp(455111 + 127431), 3)
    expect(synctexForward(data, '/work/paper/main.tex', 5)?.top).toBeCloseTo(
      bp(11087721 - 455111),
      3
    )
    // A blank line falls back to the nearest line that produced text.
    expect(synctexForward(data, '/work/paper/main.tex', 6)?.page).toBe(1)
    expect(synctexForward(data, '/work/paper/chapters/method.tex', 2)?.page).toBe(1)
    expect(synctexForward(data, '/work/paper/main.tex', 12)?.page).toBe(2)
    expect(synctexForward(data, '/work/paper/missing.tex', 1)).toBeNull()
  })

  it('maps a spot on the page back to its source line', () => {
    const y = bp(10300473) - 2
    expect(synctexReverse(data, 1, bp(14000000), y)).toEqual({
      file: '/work/paper/main.tex',
      line: 4
    })
    expect(synctexReverse(data, 1, bp(9000000), bp(11087721) - 2)?.line).toBe(5)
    expect(synctexReverse(data, 1, bp(12000000), bp(16257220) - 2)).toEqual({
      file: '/work/paper/chapters/method.tex',
      line: 2
    })
    // Left of every word: the paragraph's leading point names its end line, so it is skipped.
    expect(synctexReverse(data, 2, bp(9000000), y)?.line).toBe(12)
    // Outside every line box: the nearest point on that page.
    expect(synctexReverse(data, 2, bp(15624374), bp(10300473) + 30)?.line).toBe(12)
  })
})
