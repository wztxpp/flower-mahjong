/** Stable IDs shared by the lobby and server; array indexes are absolute seats. */
export const CHARACTER_IDS = Object.freeze(['sweet', 'elegant', 'sunny']);

export function isCharacterId(value) {
  return typeof value === 'string' && CHARACTER_IDS.includes(value);
}

export function preferredCharacter(value) {
  if (value === undefined || value === null) return null;
  if (!isCharacterId(value)) throw new TypeError('Unknown preferred character');
  return value;
}

// Rejection sampling avoids modulo bias when selecting among three players.
function randomIndex(size) {
  if (size === 1) return 0;
  const limit = 0x100000000 - (0x100000000 % size);
  const sample = new Uint32Array(1);
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % size;
}

/** Resolve all preferences together, once, when the server starts the game. */
export function assignCharacters(preferences, chooseIndex = randomIndex) {
  if (!Array.isArray(preferences) || preferences.length !== CHARACTER_IDS.length) {
    throw new TypeError('Exactly three character preferences are required');
  }
  const requested = preferences.map(preferredCharacter);
  const assigned = Array(CHARACTER_IDS.length).fill(null);
  const choose = size => {
    const index = size === 1 ? 0 : chooseIndex(size);
    if (!Number.isInteger(index) || index < 0 || index >= size) throw new RangeError('Invalid random index');
    return index;
  };

  // Each person requests at most one role, so winners for different roles can
  // never overlap. In particular, random players cannot take a requested role.
  for (const character of CHARACTER_IDS) {
    const candidates = requested.flatMap((preference, seat) => preference === character ? [seat] : []);
    if (candidates.length) assigned[candidates[choose(candidates.length)]] = character;
  }
  const remaining = CHARACTER_IDS.filter(character => !assigned.includes(character));
  for (let seat = 0; seat < assigned.length; seat++) {
    if (assigned[seat] === null) assigned[seat] = remaining.splice(choose(remaining.length), 1)[0];
  }
  return assigned;
}

/** Read-only compatibility: never rewrite an existing game's rules or hands. */
export function gameCharacters(mapping) {
  const valid = Array.isArray(mapping) && mapping.length === CHARACTER_IDS.length
    && mapping.every(isCharacterId) && new Set(mapping).size === CHARACTER_IDS.length;
  return valid ? [...mapping] : [...CHARACTER_IDS];
}
