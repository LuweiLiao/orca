import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { growthDateTimeSeconds } from './growth-tree-labels'
import {
  GROWTH_REPLAY_SLIDER_MAX,
  GROWTH_REPLAY_SPEEDS,
  type GrowthReplaySpeed
} from './growth-tree-replay'

type Props = {
  at: number
  position: number
  playing: boolean
  speed: GrowthReplaySpeed
  loading: boolean
  hasEvents: boolean
  missingHosts: number
  partialHosts: number
  onPlay: () => void
  onPause: () => void
  onSeek: (position: number) => void
  onSpeed: (speed: GrowthReplaySpeed) => void
}

/** The replay controls under the tree: play, a slider over the history, and how fast. */
export function GrowthTreeReplayBar({
  at,
  position,
  playing,
  speed,
  loading,
  hasEvents,
  missingHosts,
  partialHosts,
  onPlay,
  onPause,
  onSeek,
  onSpeed
}: Props): React.JSX.Element {
  const note = loading
    ? translate('growthTree.replay.loading', 'Reading history…')
    : missingHosts > 0
      ? translate('growthTree.replay.missingHosts', 'Hosts with no history: {{count}}', {
          count: missingHosts
        })
      : partialHosts > 0
        ? translate('growthTree.replay.partialHosts', 'Hosts with partial history: {{count}}', {
            count: partialHosts
          })
        : !hasEvents
          ? translate('growthTree.replay.noEvents', 'No recorded events to fly yet')
          : null
  return (
    <div
      data-growth-replay=""
      className="flex shrink-0 items-center gap-3 border-t border-border bg-background px-3 py-2"
    >
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        data-growth-replay-play=""
        aria-label={
          playing
            ? translate('growthTree.replay.pause', 'Pause')
            : translate('growthTree.replay.play', 'Play')
        }
        onClick={playing ? onPause : onPlay}
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <Slider
        className="max-w-xl min-w-40 flex-1"
        min={0}
        max={GROWTH_REPLAY_SLIDER_MAX}
        step={1}
        value={[position]}
        onValueChange={([next]) => onSeek(next ?? 0)}
        thumbLabels={[translate('growthTree.replay.slider', 'Replay time')]}
        thumbValueLabels={[growthDateTimeSeconds(at)]}
        data-growth-replay-slider=""
      />
      <span
        data-growth-replay-time=""
        className="w-36 shrink-0 text-xs text-muted-foreground tabular-nums"
      >
        {growthDateTimeSeconds(at)}
      </span>
      <ToggleGroup
        type="single"
        value={String(speed)}
        variant="segmented"
        size="xs"
        aria-label={translate('growthTree.replay.speed', 'Replay speed')}
        onValueChange={(value) => {
          const next = GROWTH_REPLAY_SPEEDS.find((candidate) => String(candidate) === value)
          if (next) {
            onSpeed(next)
          }
        }}
      >
        {GROWTH_REPLAY_SPEEDS.map((candidate) => (
          <ToggleGroupItem key={candidate} value={String(candidate)}>
            {`${candidate}x`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {note ? (
        <span data-growth-replay-note="" className="min-w-0 truncate text-xs text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  )
}
