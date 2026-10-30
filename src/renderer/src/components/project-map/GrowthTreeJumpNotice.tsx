import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { GrowthTreeJumpNotice as Notice } from './use-growth-tree-jump'

type Props = { notice: Notice; onUnhide: () => void; onDismiss: () => void }

/** Why a jump from the growth tree did not land on the node; it never fails silently. */
export function GrowthTreeJumpNotice({ notice, onUnhide, onDismiss }: Props): React.JSX.Element {
  return (
    <div
      role="status"
      data-growth-jump-notice={notice.kind}
      className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs shadow-xs"
    >
      <span>
        {notice.kind === 'hidden'
          ? translate('growthTree.jump.hidden', 'This conversation is hidden in the blueprint.')
          : translate('growthTree.jump.missing', 'This conversation is not on the blueprint.')}
      </span>
      {notice.kind === 'hidden' ? (
        <Button type="button" size="xs" variant="outline" onClick={onUnhide}>
          {translate('growthTree.jump.unhide', 'Show it')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate('growthTree.jump.dismiss', 'Dismiss')}
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
