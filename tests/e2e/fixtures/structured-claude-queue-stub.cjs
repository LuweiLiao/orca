const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const log = process.env.ORCA_E2E_QUEUE_LOG
fs.appendFileSync(log, `${JSON.stringify({ args: process.argv })}\n`)
if (process.argv.includes('--version')) {
  process.stdout.write('2.1.280 (Claude Code)\n')
  process.exit(0)
}
const args = process.argv
const sessionId =
  args.find((arg) => arg.startsWith('--session-id='))?.slice('--session-id='.length) ||
  (args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : randomUUID())
const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
let timer
function finish() {
  write({
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: randomUUID(),
      role: 'assistant',
      model: 'stub',
      content: [{ type: 'text', text: 'Stub reply.' }]
    }
  })
  write({
    type: 'result',
    subtype: 'success',
    uuid: randomUUID(),
    session_id: sessionId,
    is_error: false,
    result: 'Stub reply.'
  })
}
require('node:readline')
  .createInterface({ input: process.stdin })
  .on('line', (line) => {
    const frame = JSON.parse(line)
    if (frame.type === 'user') {
      fs.appendFileSync(log, `${JSON.stringify({ prompt: frame.message })}\n`)
      write({ ...frame, isReplay: true })
      clearTimeout(timer)
      timer = setTimeout(finish, JSON.stringify(frame.message).includes('slow') ? 60000 : 500)
    } else if (frame.type === 'control_request') {
      if (frame.request.subtype === 'interrupt') {
        clearTimeout(timer)
        write({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          session_id: sessionId,
          parent_tool_use_id: null
        })
      }
      write({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: frame.request_id,
          response: {
            commands: [],
            models: [{ value: 'default', displayName: 'Default' }],
            account: {},
            output_style: 'default',
            available_output_styles: ['default']
          }
        }
      })
      if (frame.request.subtype === 'initialize') {
        write({
          type: 'system',
          subtype: 'init',
          session_id: sessionId,
          uuid: randomUUID(),
          model: 'stub',
          cwd: process.cwd(),
          tools: [],
          mcp_servers: [],
          permissionMode: 'default',
          slash_commands: [],
          apiKeySource: 'none',
          output_style: 'default'
        })
      }
    }
  })
