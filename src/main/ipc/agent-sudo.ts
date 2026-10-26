import { ipcMain } from 'electron'
import { isAgentSudoMode, isValidAgentSudoPassword } from '../../shared/agent-sudo-types'
import { agentSudoService } from '../agent-sudo/agent-sudo-service'

// Desktop IPC only: runtime RPC (mobile, paired web) must never read or enable a root credential.
export function registerAgentSudoHandlers(): void {
  ipcMain.handle('agentSudo:getStatus', () => agentSudoService.getStatus())
  ipcMain.handle('agentSudo:savePassword', (_event, password: unknown) => {
    if (!isValidAgentSudoPassword(password)) {
      throw new Error('Invalid sudo password')
    }
    return agentSudoService.savePassword(password)
  })
  ipcMain.handle('agentSudo:clearPassword', () => agentSudoService.clearPassword())
  ipcMain.handle('agentSudo:setMode', (_event, mode: unknown) => {
    if (!isAgentSudoMode(mode)) {
      throw new Error('Invalid sudo mode')
    }
    return agentSudoService.setMode(mode)
  })
}
