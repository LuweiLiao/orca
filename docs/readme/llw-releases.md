# LLW Releases

LLW publishes Windows x64 NSIS installers and Linux x64 Debian packages to
`LuweiLiao/orca` GitHub Releases. Both packages must come from the same source
commit and use the same increasing `ORCA_LOCAL_BUILD_VERSION`, for example
`1.4.215-llw.20261031.3`.

Packaged LLW builds check for updates automatically, download a complete newer
release in the background, and wait for the user to choose Restart to Update.
Closing Orca does not install the update. Debian desktop installs use the system
authentication dialog when applying the downloaded package. Headless servers
continue to use their existing service update procedure.

## Build And Publish

1. Set `ORCA_LOCAL_BUILD_VERSION` and `ORCA_BUILD_COMMIT` to the release version
   and the exact source SHA. Build desktop assets and the Orcad template using
   the repository's existing build commands.
2. Package with `config/electron-builder.llw.cjs`: `--win nsis --x64` on Windows
   and `--linux deb --x64` on Ubuntu 20.04. `ORCA_LLW_RELEASE_DIR` selects the
   output directory. `ORCA_ENABLE_AUTO_UPDATE=0` disables checks for a test build.
3. Create a draft release with tag `v<version>` pointing to that source commit.
   Upload `orca-windows-setup.exe`, its `.blockmap`, `latest.yml`, the x64 `.deb`,
   and `latest-linux.yml`. Keep manifests and installers from the same build.
4. Verify package versions, manifest SHA-512 digests, source metadata, hidden
   desktop startup, and the downloaded-update prompt before publishing the
   draft. Publish it as the latest release after both platforms are complete.

The LLW packaging configuration omits the upstream publisher identity because
these Windows builds are unsigned. Do not claim the upstream SignPath signer.
Existing builds that disabled updates need this installer once before they can
discover later releases online.
