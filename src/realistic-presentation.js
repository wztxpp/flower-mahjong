// 真实桌视觉批次附着于既有声音FIFO，不自行重读整份历史，也不改变原有声音分组。
// Attach realistic visual batches to the existing audio FIFO, without rereading history or changing audio grouping.
// 输入已经由App游标裁剪为新增公开事件；本模块只复制展示白名单，摸牌和hidden永远抹去牌种。
// Inputs are fresh public cursor events; copy only display fields and always erase drawn/hidden identities.
const VISUAL_TYPES = new Set(['draw', 'discard', 'peng', 'mingGang', 'anGang', 'buGang', 'addGang', 'hu']);
export const REALISTIC_FLIGHT_DURATION_MS = 650;
export const REALISTIC_FLIGHT_STAGGER_MS = 120;

// 返回独立事件对象，保留稳定事件键与公开来源，不把语音URL或未来私有扩展传给新场景。
// Return independent events with stable keys/public sources, never forwarding audio URLs or future private extensions.
export function realisticVisualEvents(events) {
  return (events || []).flatMap((event) => {
    if (!VISUAL_TYPES.has(event?.type) || typeof event.eventKey !== 'string') return [];
    const hidden = event.type === 'draw' || event.hidden === true || !Number.isInteger(event.tile);
    return [{ type: event.type, eventKey: event.eventKey, seat: event.seat, fromSeat: event.fromSeat,
      source: event.source, tile: hidden ? null : event.tile, hidden }];
  });
}

// 原音频组的最后事件是视觉边界：前缀随该组启动，最后的无声尾部须等该组两条媒体完成。
// The last event in each existing audio group defines its visual boundary; trailing silent events wait for both media paths.
// 没有声音组时仍返回纯视觉批次，调用方不会为它增加350ms字幕等待或语音积压计数。
// With no audio group, retain a visual-only batch without a 350ms caption wait or audio-backlog count.
export function attachRealisticVisualBatches(events, groups) {
  let offset = 0;
  const batches = groups.map((group) => {
    const lastKey = group.at(-1)?.eventKey;
    const end = events.findIndex((event, index) => index >= offset && event.eventKey === lastKey);
    const visualEvents = end < offset ? [] : realisticVisualEvents(events.slice(offset, end + 1));
    if (end >= offset) offset = end + 1;
    return { events: group, visualEvents, trailingVisualEvents: [] };
  });
  const trailing = realisticVisualEvents(events.slice(offset));
  if (batches.length) batches.at(-1).trailingVisualEvents = trailing;
  else if (trailing.length) batches.push({ events: [], visualEvents: trailing, trailingVisualEvents: [] });
  return batches;
}
