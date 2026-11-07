/**
 * 已确认成都番型、根、自摸及封顶回归；全部使用合成本人牌，不进行转账。
 * Confirmed Chengdu pattern/root/self-draw/cap regressions use synthetic own tiles without payments.
 * 清一色特殊组合固定额外加两番；旧开发参数不能改变已确认规则。
 * Pure-suit combinations always add two fan; legacy development options cannot change the confirmed rule.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateChengduScore, getChengduWaitScores } from '../shared/chengdu-scoring.js';
import { getChengduStructuralWaits } from '../shared/chengdu-hand.js';

const SCORING = Object.freeze({ selfDraw: 'addBase', fanCap: 6 });
const REGULAR = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 17, 17];
const TRIPLETS = [0, 0, 0, 3, 3, 3, 9, 9, 9, 12, 12, 12, 17, 17];
const SEVEN_PAIRS = [0, 0, 2, 2, 4, 4, 6, 6, 9, 9, 11, 11, 13, 13];
const PURE_REGULAR = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8];

// 创建合法同牌碰/杠，避免用手写副露掩盖非法长度或跨花色。
// Build legal identical-tile pengs/kongs so fixtures do not conceal invalid sizes or identities.
function meld(tile, type = 'peng') {
  return { type, tile, tiles: Array(type === 'peng' ? 3 : 4).fill(tile) };
}

// 简洁包装只提供测试明确选择的缺门与计分配置，生产函数本身没有这些默认。
// This fixture supplies explicit dingque/scoring choices; production has no such defaults.
function score(hand, melds = [], context = {}) {
  return calculateChengduScore(hand, melds, 'characters', SCORING, context);
}

for (const [pattern, hand, melds, baseFan] of [
  ['regular', REGULAR, [], 1],
  ['allTriplets', TRIPLETS, [], 2],
  ['sevenPairs', SEVEN_PAIRS, [], 3],
  ['goldenHook', [17, 17], [meld(0), meld(3), meld(9), meld(12)], 3],
  ['pureSuit', PURE_REGULAR, [], 3],
]) {
  test(`${pattern} uses confirmed base fan without inherited Flower bonuses`, () => {
    assert.deepEqual(score(hand, melds), {
      pattern, baseFan, roots: 0, fan: baseFan, points: 2 ** (baseFan - 1), isSelfDraw: false,
    });
  });
}

test('luxury seven pairs adds one fan per physical root, including dual standard shape', () => {
  const luxury = [0, 0, 0, 0, 2, 2, 4, 4, 9, 9, 11, 11, 13, 13];
  assert.deepEqual(score(luxury), {
    pattern: 'sevenPairs', baseFan: 3, roots: 1, fan: 4, points: 8, isSelfDraw: false,
  });
  const dualShape = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 9, 9];
  assert.deepEqual(score(dualShape), {
    pattern: 'sevenPairs', baseFan: 3, roots: 3, fan: 6, points: 32, isSelfDraw: false,
  });
});

test('roots count across hand and melds, and each kind of four-tile kong counts once', () => {
  const hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 17, 17];
  assert.equal(score(hand, [meld(0)]).roots, 1);
  for (const type of ['mingGang', 'anGang', 'buGang']) {
    const result = score([1, 2, 3, 4, 5, 6, 9, 10, 11, 17, 17], [meld(0, type)]);
    assert.equal(result.roots, 1);
    assert.equal(result.fan, 2);
    assert.equal(result.points, 2);
  }
});

const PURE_COMBINATIONS = [
  ['pureSuitAllTriplets', [0, 0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6, 8, 8], [], 4],
  ['pureSuitSevenPairs', [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6], [], 5],
  ['pureSuitGoldenHook', [8, 8], [meld(0), meld(2), meld(4), meld(6)], 5],
];
for (const [pattern, hand, melds, stackedFan] of PURE_COMBINATIONS) {
  test(`${pattern} adds the confirmed two fan with absent or compatible legacy option`, () => {
    for (const context of [{}, { pureSuitStacking: 'addTwo' }]) {
      assert.deepEqual(score(hand, melds, context), {
        pattern, baseFan: stackedFan, roots: 0, fan: stackedFan,
        points: 2 ** (stackedFan - 1), isSelfDraw: false,
      });
    }
    assert.throws(() => score(hand, melds, { pureSuitStacking: 'highestOnly' }), TypeError);
  });
}

test('pure luxury seven pairs adds roots after its confirmed five-fan base', () => {
  const hand = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  assert.deepEqual(score(hand), {
    pattern: 'pureSuitSevenPairs', baseFan: 5, roots: 1, fan: 6, points: 32, isSelfDraw: false,
  });
});

test('invalid shape/copies/melds and uncleared dingque are ineligible', () => {
  for (const [hand, melds] of [
    [null, []], [[], []], [REGULAR.slice(1), []], [[27, ...REGULAR.slice(1)], []],
    [[...Array(5).fill(0), ...REGULAR.slice(5)], []], [REGULAR, null], [REGULAR, undefined],
    [REGULAR, [null]], [REGULAR, [{}]], [REGULAR, [meld(0, 'chi')]],
    [[17, 17], [meld(0), meld(0), meld(9), meld(12)]],
    [[17, 17], [meld(0), meld(3), meld(9), { ...meld(12), tiles: [12, 12, 13] }]],
    [[17, 17], [meld(0), meld(3), meld(9), { ...meld(12), tiles: [12, 12] }]],
  ]) assert.equal(calculateChengduScore(hand, melds, 'characters', SCORING), null);
  assert.equal(calculateChengduScore(REGULAR, [], 'bamboo', SCORING), null);
  assert.equal(score([17, 17], [meld(18), meld(3), meld(9), meld(12)]), null);
});

for (const fanCap of [4, 5, 6]) {
  test(`cap ${fanCap} yields ${2 ** (fanCap - 1)} points, with add-base strictly after cap`, () => {
    const hand = [17, 17];
    const melds = [0, 3, 9, 12].map((tile) => meld(tile, 'anGang'));
    for (const selfDraw of ['addBase', 'addFan']) {
      for (const isSelfDraw of [false, true]) {
        const result = calculateChengduScore(hand, melds, 'characters', { selfDraw, fanCap }, { isSelfDraw });
        assert.equal(result.baseFan, 3);
        assert.equal(result.roots, 4);
        assert.equal(result.fan, 7);
        assert.equal(result.isSelfDraw, isSelfDraw);
        assert.equal(result.points, 2 ** (fanCap - 1) + (isSelfDraw && selfDraw === 'addBase' ? 1 : 0));
      }
    }
  });
}

test('below cap self-draw adjusts points without rewriting the pattern fan', () => {
  for (const [selfDraw, points] of [['addBase', 3], ['addFan', 4]]) {
    const result = calculateChengduScore(TRIPLETS, [], 'characters', { selfDraw, fanCap: 6 }, { isSelfDraw: true });
    assert.equal(result.fan, 2);
    assert.equal(result.points, points);
  }
});

test('configuration rejects omitted, extra, string or unsupported values', () => {
  for (const options of [undefined, {}, { ...SCORING, extra: true }, { selfDraw: 'addFan', fanCap: '4' }]) {
    assert.throws(() => calculateChengduScore(REGULAR, [], 'characters', options), TypeError);
    assert.throws(() => getChengduWaitScores([], [], 'characters', options), TypeError);
  }
  for (const dingque of [undefined, null, 'invalid']) {
    assert.throws(() => calculateChengduScore(REGULAR, [], dingque, SCORING), TypeError);
  }
  for (const context of [{ isSelfDraw: 1 }, { isSelfDraw: null }, { pureSuitStacking: true }, { pureSuitStacking: null }, { pureSuitStacking: 'highestOnly' }]) {
    assert.throws(() => score(REGULAR, [], context), TypeError);
  }
});

test('wait scores match own structural waits and always exclude self-draw adjustments', () => {
  for (const hand of [REGULAR.slice(0, -1), SEVEN_PAIRS.slice(0, -1), [17]]) {
    const melds = hand.length === 1 ? [meld(0), meld(3), meld(9), meld(12)] : [];
    const waits = getChengduWaitScores(hand, melds, 'characters', SCORING);
    assert.deepEqual(waits.map(({ tile }) => tile), getChengduStructuralWaits(hand, melds, {
      dingqueSuit: 'characters', allowSevenPairs: true,
    }));
    for (const { tile, ...breakdown } of waits) {
      assert.equal(breakdown.isSelfDraw, false);
      assert.deepEqual(breakdown, score([...hand, tile], melds));
    }
  }
});

test('waits reject impossible fifth copies, malformed inputs and dingque; confirmed combinations are included', () => {
  assert.deepEqual(getChengduWaitScores([0], [meld(0), meld(3), meld(9), meld(12)], 'characters', SCORING), []);
  for (const [hand, melds] of [[null, []], [[], [null]], [[0], null], [[0], [meld(27)]]]) {
    assert.deepEqual(getChengduWaitScores(hand, melds, 'characters', SCORING), []);
  }
  assert.deepEqual(getChengduWaitScores(REGULAR.slice(0, -1), [], 'bamboo', SCORING), []);
  const hand = PURE_COMBINATIONS[0][1].slice(0, -1);
  const waits = getChengduWaitScores(hand, [], 'characters', SCORING);
  assert.deepEqual(waits, getChengduWaitScores(hand, [], 'characters', SCORING, { pureSuitStacking: 'addTwo' }));
  assert.ok(waits.some(({ pattern, fan }) => pattern === 'pureSuitAllTriplets' && fan === 4));
  assert.throws(() => getChengduWaitScores(hand, [], 'characters', SCORING, { pureSuitStacking: 'highestOnly' }), TypeError);
});

test('scoring and waits never mutate inputs and return detached results', () => {
  const hand = Object.freeze([17]);
  const melds = [meld(0), meld(3), meld(9), meld(12)];
  for (const item of melds) { Object.freeze(item.tiles); Object.freeze(item); }
  Object.freeze(melds);
  const before = structuredClone({ hand, melds });
  const first = getChengduWaitScores(hand, melds, 'characters', SCORING);
  first[0].points = 999;
  first.push({ tile: 0 });
  assert.equal(getChengduWaitScores(hand, melds, 'characters', SCORING)[0].points, 4);
  assert.deepEqual({ hand, melds }, before);
});
