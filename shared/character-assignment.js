// 大厅与服务端共享的角色约定：稳定 ID，不把显示名当身份。
// Character contract shared by lobby/server: stable IDs, not display names as identity.
// 默认座位数与角色池分开：扩充角色不增加玩家；旧局兜底顺序不可随角色池改变。
// Separate the default seat count from the roster: more characters never add players or change legacy order.
export const SEAT_COUNT = 3;
export const LEGACY_CHARACTER_IDS = Object.freeze(['sweet', 'elegant', 'sunny']);
// 稳定 ID 同时用于偏好、已保存映射和资产路径；下标不是角色的座位。
// Stable IDs identify preferences, saved mappings and assets; roster indexes are not seats.
export const CHARACTER_IDS = Object.freeze([
  ...LEGACY_CHARACTER_IDS,
  'landlord',
  'honest',
  'wealthy',
  'star',
]);
// 四人桌必须由调用方显式指定；旧调用缺参数仍只有三人，不根据角色数猜测。
// Four-seat tables require an explicit caller setting; omitted arguments keep three, never infer from roster size.
function validateSeatCount(seatCount) {
  if (seatCount !== 3 && seatCount !== 4) throw new TypeError('Expected three or four seats');
  return seatCount;
}
// 类型和白名单同时检查，拒绝未知角色 ID。
// Check both type and allowlist to reject unknown character IDs.
export function isCharacterId(value) {
  return typeof value === 'string' && CHARACTER_IDS.includes(value);
}
// 未填或 null 都表示随机；其他非法输入抛错，不默默换角色。
// Missing/null means random; reject other invalid values instead of silently replacing them.
export function preferredCharacter(value) {
  if (value === undefined || value === null) return null;
  if (!isCharacterId(value)) throw new TypeError('Unknown preferred character');
  return value;
}
// 拒绝采样消除取模偏差：只接受能均分为 size 组的随机整数范围。
// Rejection sampling avoids modulo bias by accepting only an evenly divisible integer range.
function randomIndex(size) {
  if (size === 1) return 0;
  // 2^32 是 Uint32 随机数范围大小；丢弃不能整除 size 的尾部。
  // 2^32 is the Uint32 range size; discard the remainder tail not divisible by size.
  const limit = 0x100000000 - (0x100000000 % size);
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % size;
}
// 保留旧批量分配接口及公平性合同；实际房间现在落座即分配，不在开局重新调用。
// Preserve the legacy batch assignment API/fairness contract; live rooms now assign on seating, never again at start.
export function assignCharacters(preferences, chooseIndex = randomIndex, seatCount = SEAT_COUNT) {
  validateSeatCount(seatCount);
  if (!Array.isArray(preferences) || preferences.length !== seatCount) {
    throw new TypeError(`Exactly ${seatCount} character preferences are required`);
  }
  // Array.from 把稀疏输入的缺项视为未选择，避免跳过某个真实座位。
  // Array.from treats sparse entries as no preference instead of skipping a real seat.
  const requested = Array.from(preferences, preferredCharacter);
  const assigned = Array(seatCount).fill(null);
  // 随机结果必须为范围内整数；只有一项时直接选中，避免不必要的随机调用。
  // Require an in-range integer; a single candidate needs no random call.
  const choose = (size) => {
    const index = size === 1 ? 0 : chooseIndex(size);
    if (!Number.isInteger(index) || index < 0 || index >= size)
      throw new RangeError('Invalid random index');
    return index;
  };
  // 先在明确选择该角色的人中抽一人；随机玩家不能抢走无人竞争的明确偏好。
  // First choose among explicit claimants for each role; random players cannot take an uncontested preference.
  for (const character of CHARACTER_IDS) {
    const candidates = requested.flatMap((preference, seat) =>
      preference === character ? [seat] : [],
    );
    if (candidates.length) assigned[candidates[choose(candidates.length)]] = character;
  }
  // 剩余角色分给未中选或选择随机的座位；splice 取走后就不会重复分配。
  // Assign remaining roles to unmatched/random seats; splice removes each chosen role to prevent duplicates.
  const remaining = CHARACTER_IDS.filter((character) => !assigned.includes(character));
  for (let seat = 0; seat < assigned.length; seat++) {
    if (assigned[seat] === null) assigned[seat] = remaining.splice(choose(remaining.length), 1)[0];
  }
  return assigned;
}
// 为一位新落座者选角色：先满足仍可用的偏好，否则从剩余角色均匀抽取，不抢旧人的角色。
// Assign one new occupant: honor an available preference, otherwise draw uniformly from unused roles without displacing anyone.
// 输入已占用角色来自服务器；返回 ID，不修改输入，随机注入仅供确定性测试。
// Occupied IDs come from the server; return an ID without mutation, with RNG injection for deterministic tests only.
export function assignSeatCharacter(preference, occupiedCharacters, chooseIndex = randomIndex) {
  const requested = preferredCharacter(preference);
  const available = CHARACTER_IDS.filter((character) => !occupiedCharacters.includes(character));
  if (!available.length) throw new RangeError('No characters available');
  if (available.includes(requested)) return requested;
  const index = available.length === 1 ? 0 : chooseIndex(available.length);
  if (!Number.isInteger(index) || index < 0 || index >= available.length)
    throw new RangeError('Invalid random index');
  return available[index];
}
// 只读恢复占座映射：先保留合法且不重复的已分配角色，再补旧偏好，最后按旧座位顺序兜底。
// Read-only occupancy recovery: reserve valid unique assignments, then legacy preferences, then stable seat-order fallbacks.
// 空座始终为 null；不抽签、不写回，所以旧房轮询和重连也不会换人。损坏的重复 ID 只保留第一份。
// Vacancies stay null; no randomness or writes means legacy polls/reconnects stay stable. Keep only the first duplicate saved ID.
export function seatCharacters(seats) {
  validateSeatCount(seats.length);
  const assigned = Array(seats.length).fill(null);
  const reserve = (seat, character) => {
    if (isCharacterId(character) && !assigned.includes(character)) assigned[seat] = character;
  };
  // 分三轮预留，避免早座位的兜底抢走后座位已保存的角色或可用偏好。
  // Three passes keep an earlier fallback from stealing a later persisted role or available preference.
  seats.forEach((person, seat) => { if (person) reserve(seat, person.characterId); });
  seats.forEach((person, seat) => {
    if (person && assigned[seat] === null) reserve(seat, person.preferredCharacter);
  });
  const fallback = gameCharacters(undefined, seats.length);
  seats.forEach((person, seat) => {
    if (!person || assigned[seat] !== null) return;
    reserve(seat, fallback[seat]);
    if (assigned[seat] === null) assigned[seat] = CHARACTER_IDS.find((character) => !assigned.includes(character));
  });
  return assigned;
}
// 已有合法映射只复制不修改；旧局没有映射时返回稳定兼容顺序。
// Copy valid saved mappings without mutation; legacy games use a stable compatibility order.
export function gameCharacters(mapping, seatCount = SEAT_COUNT) {
  validateSeatCount(seatCount);
  // 必须数量正确、每项合法且无重复，才可信任整个映射。
  // Trust the mapping only with the correct length, valid IDs, and no duplicates.
  const valid =
    Array.isArray(mapping) &&
    mapping.length === seatCount &&
    Array.from(mapping).every(isCharacterId) &&
    new Set(mapping).size === seatCount;
  // 第四个兜底只服务显式四人桌；前三项不变，绝不把旧三人局补成四人。
  // The fourth fallback serves only explicit four-seat tables; the original three never gain a seat implicitly.
  const fallback = [...LEGACY_CHARACTER_IDS, 'landlord'].slice(0, seatCount);
  return valid ? [...mapping] : fallback;
}
