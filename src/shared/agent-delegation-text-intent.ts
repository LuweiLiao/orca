// Whether the words around a count ask for agents now, or talk about them.

const NOT_NEGATION =
  /不过|不管|不论|不仅|不但|不错|不久|没问题|没事|别的|别人|分别|特别|区别|级别|类别|个别|告别|未来/g
const NEGATION = /[不别勿莫甭没未]|禁止|无需|无须|\bdon'?t\b|\bdo not\b|\bnever\b|\bno need\b/i
const HYPOTHETICAL =
  /如果|假如|假设|要是|万一|比如|例如|譬如|举例|是否|要不要|需不需要|用不用|能不能|可不可以|可以不|该不该|会不会|为何|为什么|怎么|如何|\b(?:if|whether|when|unless|suppose)\b/i
const PAST_OR_HABIT =
  /已经|之前|以前|刚才|刚刚|上次|上回|曾经|昨天|当时|那次|那时|正在|目前|平时|一般|通常|经常|总是|一直|每次|每天|往往/
const OPINION_TAIL =
  /怎么样|好不好|行不行|对不对|是不是|可不可以|可以吗|行吗|好吗|你觉得|你认为|你看呢|觉得呢|what do you think|is that ok|sound good/i
const CONDITION_AFTER = /^\s*(?:的话|的时候)/
const QUESTION_PARTICLE_END = /[吗呢嘛][\s\p{P}]*$/u
// "分析下为什么崩溃？" asks a task question, not whether to make the agents.
const WH_TASK = /为什么|什么|怎么|哪|谁|多少|\b(?:why|what|how|which|where|who)\b/i

/** "先别开2个claude" declines; "如果需要再加2个codex" leaves the request open. */
export function agentDelegationAdmission(before: string): 'admitted' | 'declined' | 'doubtful' {
  const text = before.replace(NOT_NEGATION, ' ')
  if (NEGATION.test(text) || PAST_OR_HABIT.test(text)) {
    return 'declined'
  }
  return HYPOTHETICAL.test(text) ? 'doubtful' : 'admitted'
}

/** Whether the words after the last request ask the agent back ("…分析下，可以吗？"). */
export function agentDelegationAsksBack(
  after: string,
  clauseIsQuestion: boolean,
  politeEnglish: boolean
): boolean {
  return (
    OPINION_TAIL.test(after) ||
    CONDITION_AFTER.test(after) ||
    QUESTION_PARTICLE_END.test(after) ||
    (clauseIsQuestion && !politeEnglish && !WH_TASK.test(after))
  )
}
