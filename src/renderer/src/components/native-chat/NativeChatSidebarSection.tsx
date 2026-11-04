import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** A folding group of the conversation sidebar; its heading stays in view while it scrolls. */
export function NativeChatSidebarSection({
  title,
  count,
  defaultOpen = true,
  children
}: {
  title: string
  count: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b last:border-b-0">
      <CollapsibleTrigger className="group/section sticky -top-px z-10 flex h-8 w-full items-center gap-1.5 bg-background px-3 pt-px text-2xs font-semibold tracking-wider text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]/section:rotate-90" />
        <span>{title}</span>
        <span className="ml-auto font-normal tabular-nums tracking-normal">{count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
