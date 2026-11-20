// CI release builds substitute telemetry credentials; contributor builds use null and console-mirror only.
// No runtime env fallback: shell exports must not enable telemetry transmission.
declare const ORCA_BUILD_IDENTITY: 'stable' | 'rc' | null
declare const ORCA_POSTHOG_WRITE_KEY: string | null

// CI supplies the diagnostics token endpoint; null disables upload in contributor builds.
// ORCA_DIAGNOSTICS_TOKEN_URL overrides it for developers testing packaged builds against staging.
declare const ORCA_DIAGNOSTICS_TOKEN_URL: string | null

// Full commit the build was made from (`git rev-parse HEAD`); official skill installs pin to it.
declare const ORCA_BUILD_COMMIT: string

// True when ORCA_ENABLE_AUTO_UPDATE=0 at build time; read only in src/main/updater/lifecycle/updater-build-switch.ts.
declare const ORCA_AUTO_UPDATE_DISABLED: boolean

// ORCA_LAYOUT_OWNER is declared and read in one place: src/shared/workspace-layout/layout-owner-switch.ts.
