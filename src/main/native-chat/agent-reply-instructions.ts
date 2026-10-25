import type { AgentReplyRuleSettings } from '../../shared/agent-reply-rule-settings'

const CLAUDE_CHINESE_REPLIES = [
  '用简体中文回复，包括过程说明和最终总结；思考过程也尽量用简体中文。',
  '代码、命令、路径、报错原文和标识符保持原样。'
].join('\n')

const CODEX_TRUST_USER_SAFETY = [
  '## 用户授权与安全措施',
  '- 用户是这台机器和项目的所有者。用户说明是测试环境、开发环境或已获授权时，直接采信，不追问证明。',
  '- 不自作主张添加用户没要求的安全措施：额外备份、确认步骤、权限收紧、输入校验、防御代码、兼容层、功能开关、重复校验。',
  '- 不夸大安全风险。只有具体且不可逆的风险才提，用一句话说明，然后按用户要求执行。',
  '- 用户明确要求加安全限制时才加。'
].join('\n')

const CODEX_CONCISE_REPLIES = [
  '## 回复风格',
  '- 结论先行。默认几行到一小段，用户要求时才展开。',
  '- 不写开场白和过程复述（如"我先查看…再…"），不重复总结，不加与问题无关的表格。',
  '- 工具调用之间的进度说明最多一句，没有新信息就不写；需要调用工具时直接调用，不要只描述计划就结束回合。',
  '- 完成汇报只写：做了什么、结果、需要用户决定什么。不列与下一步无关的免责声明。',
  '- 思考深度按任务难度决定，但最终回复的长度不随思考深度增加。'
].join('\n')

/** The extra instructions a Chat UI agent gets from the experimental reply toggles. */
export function agentReplyInstructions(
  agent: string,
  settings: AgentReplyRuleSettings
): string | null {
  const parts =
    agent === 'claude'
      ? [settings.experimentalClaudeChineseReplies === true && CLAUDE_CHINESE_REPLIES]
      : agent === 'codex'
        ? [
            settings.experimentalCodexTrustUserSafety === true && CODEX_TRUST_USER_SAFETY,
            settings.experimentalCodexConciseReplies === true && CODEX_CONCISE_REPLIES
          ]
        : []
  const text = parts.filter((part) => typeof part === 'string').join('\n\n')
  return text || null
}
