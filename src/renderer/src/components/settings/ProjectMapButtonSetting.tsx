import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import { getProjectMapButtonEntry } from './appearance-sidebar-search'

export function ProjectMapButtonSetting({
  shown,
  onToggle
}: {
  shown: boolean
  onToggle: (shown: boolean) => void
}): React.JSX.Element {
  const entry = getProjectMapButtonEntry()
  return (
    <SearchableSetting
      title={entry.title}
      description={entry.description}
      keywords={entry.keywords}
    >
      <SettingsSwitchRow
        label={entry.title}
        description={entry.description}
        checked={shown}
        onChange={() => onToggle(!shown)}
      />
    </SearchableSetting>
  )
}
