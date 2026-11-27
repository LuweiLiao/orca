// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MessageRow } from '../messages/rows/NativeChatMessageRow'

afterEach(cleanup)

const SENT = [
  'Please fix these',
  '<orca-review-notes count="2">',
  'File: paper/main.pdf',
  'Source: pdf',
  'Page: 2',
  'Excerpt:',
  '> 统一模',
  'User comment: "统一模型感觉写的过了"',
  '',
  'File: paper/method.tex',
  'Source: text',
  'Line: 12',
  'User comment: "Cite this"',
  '</orca-review-notes>'
].join('\n')

describe('review notes in a sent message', () => {
  it('fold into one pill that opens to each note', () => {
    render(
      <TooltipProvider>
        <MessageRow
          message={{
            id: 'sent',
            role: 'user',
            timestamp: 0,
            source: 'transcript',
            blocks: [{ type: 'text', text: SENT }]
          }}
          expandSignal={false}
          onScrollMessageToTop={() => {}}
        />
      </TooltipProvider>
    )
    expect(screen.getByText('Please fix these')).toBeInTheDocument()
    expect(screen.queryByText(/File: paper/)).toBeNull()
    expect(screen.queryByText(/orca-review-notes/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '2 annotations' }))
    const list = screen.getByRole('region', { name: 'Annotations' })
    expect(list).toHaveTextContent('main.pdf · page 2')
    expect(list).toHaveTextContent('统一模型感觉写的过了')
    expect(list).toHaveTextContent('method.tex · line 12')
    expect(list).toHaveTextContent('Cite this')
    // Sent notes are read, never deleted.
    expect(screen.queryByRole('button', { name: 'Delete annotation' })).toBeNull()
  })
})
