import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { RenderedMermaidDiagram } from './MermaidBlock'

export function useMermaidDiagramExpand(): (diagram: RenderedMermaidDiagram) => void {
  const openModal = useAppStore((state) => state.openModal)
  return useCallback((diagram) => openModal('diagram-viewer', diagram), [openModal])
}
