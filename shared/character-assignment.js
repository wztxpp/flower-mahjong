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
// 仅开局时一起处理本桌偏好，返回不重复角色；第二参数仍保留旧测试的随机选择注入。
// Resolve table preferences at start with unique roles; the second parameter preserves existing RNG injection.
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
