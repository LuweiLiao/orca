/** Experimental instructions Orca adds to Chat UI agents. */
export type AgentReplyRuleSettings = {
  /** Claude: append a reply-in-Simplified-Chinese instruction to the system prompt. */
  experimentalClaudeChineseReplies?: boolean
  /** Codex: trust the user's environment claims and add no unrequested safety measures. */
  experimentalCodexTrustUserSafety?: boolean
  /** Codex: lead with the conclusion and drop filler, at any reasoning effort. */
  experimentalCodexConciseReplies?: boolean
  /** Claude and Codex: embed mentioned images and spell out full file paths. On unless set false. */
  experimentalShowImagesAndFilePaths?: boolean
  /** Claude and Codex: talk in the Doubao persona's voice; wording only, never the substance. */
  experimentalDoubaoPersona?: boolean
}
