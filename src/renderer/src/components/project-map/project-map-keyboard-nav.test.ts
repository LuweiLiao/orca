import { describe, expect, it } from 'vitest'
import { PROJECT_MAP_NODE, type ProjectMapNodeBox } from './project-map-layout'
import { projectMapNearestNode, projectMapNodeInView } from './project-map-keyboard-nav'

const box = (id: string, x: number, y: number): ProjectMapNodeBox => ({
  id,
  kind: 'agent',
  x,
  y,
  width: PROJECT_MAP_NODE.agentWidth
})

const nodes = [
  box('a', 0, 0),
  box('b', 300, 0),
  box('c', 0, 100),
  box('d', 300, 100),
  box('far', 600, 400)
]

describe('projectMapNearestNode', () => {
  it('follows the row and the column', () => {
    expect(projectMapNearestNode(nodes, 'a', 'right')).toBe('b')
    expect(projectMapNearestNode(nodes, 'a', 'down')).toBe('c')
    expect(projectMapNearestNode(nodes, 'd', 'left')).toBe('c')
    expect(projectMapNearestNode(nodes, 'd', 'up')).toBe('b')
  })

  it('prefers a node in line over a nearer one off to the side', () => {
    const list = [box('from', 0, 0), box('inline', 0, 300), box('aside', 200, 120)]
    expect(projectMapNearestNode(list, 'from', 'down')).toBe('inline')
  })

  it('stays put at an edge', () => {
    expect(projectMapNearestNode(nodes, 'a', 'left')).toBeNull()
    expect(projectMapNearestNode(nodes, 'a', 'up')).toBeNull()
  })

  it('starts from the top-left node when nothing is focused', () => {
    expect(projectMapNearestNode(nodes, null, 'down')).toBe('a')
    expect(projectMapNearestNode(nodes, 'gone', 'right')).toBe('a')
    expect(projectMapNearestNode([], null, 'down')).toBeNull()
  })
})

describe('projectMapNodeInView', () => {
  const size = { width: 800, height: 600 }
  it('is true inside the viewport and false once panned or zoomed out of it', () => {
    expect(projectMapNodeInView(box('a', 100, 100), { x: 0, y: 0, zoom: 1 }, size)).toBe(true)
    expect(projectMapNodeInView(box('a', 100, 100), { x: -200, y: 0, zoom: 1 }, size)).toBe(false)
    expect(projectMapNodeInView(box('a', 700, 100), { x: 0, y: 0, zoom: 1 }, size)).toBe(false)
  })
})
