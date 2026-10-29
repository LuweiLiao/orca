import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'

/** An icon-only toolbar button with its name, and shortcut if any, in a tooltip. */
export function ViewerToolbarButton({
  label,
  disabled = false,
  disabledReason,
  shortcut,
  pressed,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  /** Shown instead of the label while disabled, so the user learns why. */
  disabledReason?: string
  shortcut?: ShortcutKeyComboDetails
  /** Present on a toggle: whether it is on. */
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  const reason = disabled ? disabledReason : undefined
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Why the span: a disabled button gets no pointer or focus events, so its tooltip never opens. */}
        {reason ? (
          <span tabIndex={0} aria-label={reason} className="inline-flex">
            {button}
          </span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <span className="flex items-center gap-2">
          <span>{reason ?? label}</span>
          {shortcut && shortcut.keys.length > 0 ? (
            <ShortcutKeyCombo keys={shortcut.keys} doubleTap={shortcut.doubleTap} />
          ) : null}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
