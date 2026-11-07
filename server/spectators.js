// 观战是独立只读能力，不是座位。签名凭证只验证本房间，不链接个人成绩或参与播放屏障。
// Spectating is an independent read-only capability, never a seat, profile record or presentation participant.
// 房间仅保存一个服务端签名秘密，人数不增加存储；每次入场产生独立随机凭证，绝不进入公开投影。
// One private signing secret per room keeps storage bounded; each admission gets a fresh random credential, never exposed in projections.
// 保留原导出名供旧调用者/测试使用；API 的实际分发由模式适配器负责。
// Preserve the original export for existing callers/tests; actual API dispatch belongs to the mode adapter.
export { flowerSpectatorGameView as spectatorGameView } from './flower-visibility.js';

const encoder = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
const bytesFromHex = (value) => Uint8Array.from(value.match(/../g), (byte) => parseInt(byte, 16));

// 用 Web Crypto HMAC 验签，不把座位凭证、昵称或房间号当作观战身份。
// Web Crypto verifies HMAC signatures; seat credentials, nicknames and room codes are not spectator identities.
async function signingKey(room) {
  return crypto.subtle.importKey('raw', encoder.encode(room.spectatorKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// 为本次入场签发独立随机能力；调用者已通过房间入场检查，返回值只交给该观众。
// Issue a fresh random capability after room admission; return it only to that viewer.
export async function issueSpectatorToken(room) {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(room), encoder.encode(`${room.id}:${nonce}`));
  return `watch.${nonce}.${hex(new Uint8Array(signature))}`;
}

// 区分格式与授权：任何伪造、跨房间或缺少签名秘密的 token 都失败，不回退到玩家身份。
// Distinguish syntax from authorization: forged/cross-room tokens and missing keys fail without player fallback.
export async function authenticatesSpectator(room, token) {
  const match = typeof token === 'string' && token.match(/^watch\.([a-f0-9]{64})\.([a-f0-9]{64})$/);
  if (!match || !room.spectatorKey) return false;
  return crypto.subtle.verify('HMAC', await signingKey(room), bytesFromHex(match[2]), encoder.encode(`${room.id}:${match[1]}`));
}
