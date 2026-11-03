import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export type ImageViewerNavigation = {
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
}

export function ImageViewerNavigationButtons({
  navigation
}: {
  navigation: ImageViewerNavigation
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="pointer-events-auto shrink-0"
        aria-label={translate('imageViewerNavigation.previousImage', 'Previous image')}
        disabled={!navigation.hasPrevious}
        onClick={(event) => {
          navigation.onPrevious()
          event.currentTarget
            .closest<HTMLElement>('[role="dialog"]')
            ?.focus({ preventScroll: true })
        }}
      >
        <ChevronLeft />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="pointer-events-auto shrink-0"
        aria-label={translate('imageViewerNavigation.nextImage', 'Next image')}
        disabled={!navigation.hasNext}
        onClick={(event) => {
          navigation.onNext()
          event.currentTarget
            .closest<HTMLElement>('[role="dialog"]')
            ?.focus({ preventScroll: true })
        }}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}
