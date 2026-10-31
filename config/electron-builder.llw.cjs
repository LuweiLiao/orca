const { resolve } = require('node:path')
const base = require('./electron-builder.config.cjs')
const { publisherName, ...signtoolOptions } = base.win.signtoolOptions
void publisherName

module.exports = {
  ...base,
  electronDist: resolve(__dirname, '../node_modules/electron/dist'),
  files: [...base.files, '!.bench-fixtures{,/**/*}'],
  directories: {
    ...base.directories,
    output: process.env.ORCA_LLW_RELEASE_DIR ?? 'dist/llw'
  },
  extraMetadata: {
    ...base.extraMetadata,
    buildSourceCommit: process.env.ORCA_BUILD_COMMIT,
    buildSourceBranch: 'llw'
  },
  win: { ...base.win, signtoolOptions },
  publish: { provider: 'github', owner: 'LuweiLiao', repo: 'orca', releaseType: 'draft' }
}
