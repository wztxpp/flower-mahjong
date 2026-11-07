// 只读事件文案：按事件所属单局的参与者快照替换座位引用，不改变权威事件或计分。
// Read-only event prose: resolve seat references from that game's participant snapshot, never mutate events or scores.
// 使用单次替换回调，昵称里的“1号位”、美元符号与 HTML 均作为普通文本，不再解释。
// A single replacement callback treats seat-like text, dollar signs and HTML in names as literal text.
export function nameEvent(event, participantNames) {
  if (typeof event.message !== 'string') return { ...event };
  return {
    ...event,
    message: event.message.replace(/([1-9]\d*)号位/g, (reference, number) =>
      participantNames[Number(number) - 1] || reference,
    ),
  };
}
