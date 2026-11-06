// 大厅与服务端共享的角色约定：稳定 ID，不把显示名当身份。
// Character contract shared by lobby/server: stable IDs, not display names as identity.
// 冻结可选 ID 列表；角色映射数组的下标始终是服务端绝对座位号。
// Freeze the allowed IDs; mapping-array indexes are always absolute server seats.
export const CHARACTER_IDS = Object.freeze(['sweet', 'elegant', 'sunny']);
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
// 仅开局时一起处理三人的偏好，返回三个不重复角色；可注入随机选择供测试。
// Resolve three preferences together only at start, with unique roles and injectable selection for tests.
export function assignCharacters(preferences, chooseIndex = randomIndex) {
  if (!Array.isArray(preferences) || preferences.length !== CHARACTER_IDS.length) {
    throw new TypeError('Exactly three character preferences are required');
  }
  const requested = preferences.map(preferredCharacter);
  const assigned = Array(CHARACTER_IDS.length).fill(null);
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
export function gameCharacters(mapping) {
  // 必须数量正确、每项合法且无重复，才可信任整个映射。
  // Trust the mapping only with the correct length, valid IDs, and no duplicates.
  const valid =
    Array.isArray(mapping) &&
    mapping.length === CHARACTER_IDS.length &&
    mapping.every(isCharacterId) &&
    new Set(mapping).size === CHARACTER_IDS.length;
  return valid ? [...mapping] : [...CHARACTER_IDS];
}
