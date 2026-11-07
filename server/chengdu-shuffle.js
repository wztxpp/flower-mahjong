/**
 * 成都生产洗牌边界：构造108张实体牌，用 Web Crypto 无偏抽样进行 Fisher–Yates 洗牌。
 * Chengdu production shuffle: build 108 physical tiles and use unbiased Web Crypto Fisher–Yates sampling.
 * 引擎只接收完整牌墙；随机来源不进入规则快照，也不接受客户端种子或 Math.random 回退。
 * The engine receives a complete wall; randomness is not a rule or client seed, with no Math.random fallback.
 */

// 舍弃不能均匀分桶的32位尾部，避免取模偏差；注入来源只供独立单元测试。
// Reject the uneven 32-bit tail before taking a remainder; source injection supports isolated unit tests only.
export function secureIndex(bound, source = globalThis.crypto) {
  if (!Number.isInteger(bound) || bound < 1 || bound > 108) throw new TypeError('洗牌范围无效');
  const limit = Math.floor(0x100000000 / bound) * bound;
  const sample = new Uint32Array(1);
  do {
    source.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % bound;
}

// 返回新数组，不修改共享牌种目录；所有27种牌恰好各四张。
// Return a fresh array without mutating the identity catalog; each of 27 identities appears exactly four times.
export function shuffledChengduWall(source = globalThis.crypto) {
  const wall = Array.from({ length: 108 }, (_, index) => Math.floor(index / 4));
  for (let index = wall.length - 1; index > 0; index--) {
    const other = secureIndex(index + 1, source);
    [wall[index], wall[other]] = [wall[other], wall[index]];
  }
  return wall;
}
