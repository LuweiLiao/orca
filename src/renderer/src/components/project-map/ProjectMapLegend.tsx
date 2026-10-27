import { translate } from '@/i18n/i18n'

type CssVariables = React.CSSProperties & Record<`--${string}`, string | number>

const WORKSPACE_SWATCH: CssVariables = { '--pm-kind': 'var(--pm-kind-workspace)' }
const AGENT_SWATCH: CssVariables = { '--pm-kind': 'var(--pm-kind-agent)' }
const HISTORY_SWATCH: CssVariables = { '--pm-kind': 'var(--pm-kind-history)' }

export function ProjectMapLegend(): React.JSX.Element {
  const item = 'inline-flex items-center gap-1.5 whitespace-nowrap'
  return (
    <div
      aria-label={translate('projectMap.legendLabel', 'Legend')}
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute bottom-3 left-3 z-10 flex h-8 items-center gap-3.5 rounded-md border border-border bg-card px-3 text-[11px] text-muted-foreground shadow-xs"
    >
      <span className={item}>
        <span
          className="project-map-legend-swatch size-3 rounded-[3px] border border-border"
          style={WORKSPACE_SWATCH}
        />
        {translate('projectMap.legend.workspace', 'Workspace')}
      </span>
      <span className={item}>
        <span
          className="project-map-legend-swatch size-3 rounded-[3px] border border-border"
          style={AGENT_SWATCH}
        />
        {translate('projectMap.legend.conversation', 'Conversation')}
      </span>
      <span className={item}>
        <span
          className="project-map-legend-swatch size-3 rounded-[3px] border border-dashed border-border"
          style={HISTORY_SWATCH}
        />
        {translate('projectMap.legend.history', 'Closed')}
      </span>
      <span className={item}>
        <span className="project-map-pin" data-legend data-wire="derive" />
        {translate('projectMap.legend.derive', 'Derived')}
      </span>
      <span className={item}>
        <span className="project-map-pin" data-legend data-wire="delegate" />
        {translate('projectMap.legend.delegate', 'Delegated')}
      </span>
      <span className={item}>
        <span className="project-map-fork-pin" data-legend data-wire="fork" />
        {translate('projectMap.legend.fork', 'Forked')}
      </span>
      <span className={item}>
        <span className="project-map-fork-pin" data-legend data-wire="handoff" />
        {translate('projectMap.legend.handoff', 'Handed off')}
      </span>
      <span className={item}>
        <span className="project-map-reference-pin" data-legend />
        {translate('projectMap.legend.reference', 'Referenced')}
      </span>
      <span className={item}>
        <span className="project-map-pin" data-legend data-wire="unresolved" />
        {translate('projectMap.legend.unresolved', 'Source not loaded')}
      </span>
    </div>
  )
}
