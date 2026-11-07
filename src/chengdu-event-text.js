// 成都公开事件文案：只读取已过滤字段和该局参与者名册，不读取当前房间、不计算积分。
// Chengdu public event prose: read filtered fields and that game's names only, never current room state or scoring rules.
// 共用于即时牌桌与个人历史；hidden/null牌不补回，任意message/text也不进入此格式器。
// Shared by live tables and personal history; never restore hidden/null identities or trust arbitrary message/text fields.
import { tilePresentation } from './mahjong-tile-presentation.js';

const ACTION_LABELS = { peng: '碰', mingGang: '明杠', anGang: '暗杠', buGang: '补杠' };
const PAYMENT_LABELS = { flowerPig: '查花猪', notReady: '查叫', kongRefund: '退杠', anGang: '暗杠', mingGang: '明杠', buGang: '补杠', hu: '胡牌' };
const DIRECTION_LABELS = { clockwise: '顺时针', opposite: '对家', counterclockwise: '逆时针' };

// 显示单条服务器事件，返回纯文本；名字按绝对座位查同局快照，缺名仅显示座位。
// Return plain text for one server event; absolute seats resolve within the same round, falling back only to seat labels.
export function chengduEventText(event, participantNames = []) {
  const nameFor = (seat) => participantNames[seat] || `牌友 ${seat + 1}`;
  const tile = !event.hidden && tilePresentation(event.tile);
  const tileText = tile ? ` ${tile.label}` : '';
  const payments = (event.payments || []).map((payment) =>
    `${nameFor(payment.from)} → ${nameFor(payment.to)} ${payment.points}分${PAYMENT_LABELS[payment.reason] ? `（${PAYMENT_LABELS[payment.reason]}）` : ''}`,
  ).join('；');
  const ledger = payments ? `；${payments}` : '';
  if (event.type === 'exchangeCompleted') return `换三张完成 · ${DIRECTION_LABELS[event.direction] || '已完成'}`;
  if (event.type === 'dingqueCompleted') return '四家定缺完成';
  if (event.type === 'drawSettlement') return `流局查花猪、查叫与退杠已结算${ledger}`;
  const who = nameFor(event.seat);
  if (event.type === 'draw') return `${who}${event.source === 'replacement' ? '补摸' : '摸牌'}${tileText}`;
  if (event.type === 'discard') return `${who}打出${tileText}`;
  if (event.type === 'hu') return `${who}${event.source === 'selfDraw' ? '自摸' : event.source === 'robKong' ? '抢杠胡' : '胡牌'}${tileText} · ${event.points}分/付款方${ledger}`;
  if (Object.hasOwn(ACTION_LABELS, event.type)) return `${who}${ACTION_LABELS[event.type]}${tileText}${ledger}`;
  return '牌局动态';
}
