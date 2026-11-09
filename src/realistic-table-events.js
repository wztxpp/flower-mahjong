// 真实桌飞牌只跟随已经展示的公开历史，不能从点击、候选动作或暗牌推测动作。
// Realistic tile flights follow displayed public history only, never clicks, candidate moves or concealed identities.
import { realisticZoneCenter } from './realistic-table-layout.js';

export const REALISTIC_ACTION_LABELS = Object.freeze({
  draw: '摸牌', discard: '出牌', peng: '碰', mingGang: '明杠', anGang: '暗杠', buGang: '补杠', addGang: '加杠', hu: '胡',
});

// 只为白名单中已成立的事件提供起终点；未知来源不伪造炮家，以中央公开区作为接牌来源。
// Supply anchors only for committed allowlisted events; an unknown source uses the public center rather than inventing a discarder.
// 摸牌与隐藏事件始终使用背面；即使历史意外附带牌种也不向对手展示。
// Draws and hidden events always use backs, even if an unexpected identity accompanies the event.
export function realisticFlightForEvent(event, eventKey, model) {
  if (!Object.hasOwn(REALISTIC_ACTION_LABELS, event?.type)) return null;
  const actor = model.seats.find((seat) => seat.seat === event.seat);
  if (!actor) return null;
  const sourceSeat = model.seats.find((seat) => seat.seat === event.fromSeat);
  const hand = realisticZoneCenter(actor, 'hand');
  // 公开数量可重建当前摸牌端；信息不足时保留该玩家墙区的明确示意回退。
  // Public counts may reconstruct the draw endpoint; incomplete views retain an explicit local-wall illustration fallback.
  const wall = model.drawAnchor || realisticZoneCenter(actor, 'wall');
  const river = realisticZoneCenter(actor, 'river');
  let from = hand;
  let to = river;
  if (event.type === 'draw') { from = wall; to = hand; }
  else if (event.type === 'peng' || event.type === 'mingGang') {
    from = sourceSeat ? realisticZoneCenter(sourceSeat, 'river') : { x: 500, y: 500 };
    to = realisticZoneCenter(actor, 'melds');
  } else if (['anGang', 'buGang', 'addGang'].includes(event.type)) to = realisticZoneCenter(actor, 'melds');
  else if (event.type === 'hu') {
    from = event.source === 'selfDraw' ? hand : sourceSeat ? realisticZoneCenter(sourceSeat, 'river') : { x: 500, y: 500 };
    to = realisticZoneCenter(actor, 'wins');
  }
  const hidden = event.type === 'draw' || event.hidden === true || !Number.isInteger(event.tile);
  return {
    eventKey, seat: actor.seat, type: event.type, label: REALISTIC_ACTION_LABELS[event.type],
    tile: hidden ? null : event.tile, hidden, from, to,
  };
}
