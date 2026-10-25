export function nativeChatComposerSendDisabled(args: {
  isWorking: boolean
  hasPty: boolean
  canStop: boolean
  pastedTextSaving: boolean
  disabled: boolean
  sendOut: boolean
  imagesHoldSend: boolean
  sendBlocked: boolean
  hasMessage: boolean
}): boolean {
  if (args.isWorking) {
    return !args.hasPty || !args.canStop
  }
  return (
    args.pastedTextSaving ||
    args.disabled ||
    args.sendOut ||
    args.imagesHoldSend ||
    args.sendBlocked ||
    !args.hasMessage
  )
}
