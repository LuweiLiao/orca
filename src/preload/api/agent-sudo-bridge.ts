import { ipcRenderer } from 'electron'
import type { AgentSudoMode, AgentSudoStatus } from '../../shared/agent-sudo-types'

export type AgentSudoApi = {
  getStatus: () => Promise<AgentSudoStatus>
  savePassword: (password: string) => Promise<AgentSudoStatus>
  clearPassword: () => Promise<AgentSudoStatus>
  setMode: (mode: AgentSudoMode) => Promise<AgentSudoStatus>
}

export const agentSudoApi: AgentSudoApi = {
  getStatus: () => ipcRenderer.invoke('agentSudo:getStatus'),
  savePassword: (password) => ipcRenderer.invoke('agentSudo:savePassword', password),
  clearPassword: () => ipcRenderer.invoke('agentSudo:clearPassword'),
  setMode: (mode) => ipcRenderer.invoke('agentSudo:setMode', mode)
}
