import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSkillProviderDestinations } from './skill-provider-destinations'

const HOME = join('/home', 'tester')

describe('resolveSkillProviderDestinations', () => {
  it('does not link into ~/.gemini/skills, which Gemini CLI aliases to ~/.agents/skills', () => {
    expect(
      resolveSkillProviderDestinations({
        scope: 'global',
        homeDirectory: HOME,
        detectedProviders: ['gemini']
      })
    ).toEqual([
      { provider: 'gemini', readsCanonicalRoot: true, rootPath: join(HOME, '.agents', 'skills') }
    ])
  })
})
