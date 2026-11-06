/**
 * 可读性重构的离线行为对比：从指定 Git 提交临时取出三代规则引擎，逐步重放相同动作。
 * Offline differential replay: extract three engine versions from a Git baseline and replay identical actions.
 * 不访问生产、不写数据库、不推送仓库；临时基线在 finally 中清理。
 * No production requests, database writes, or Git pushes; temporary baseline files are cleaned in finally.
 * 用法 / Usage: node scripts/verify-readability.mjs [baseline-commit]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 默认基线是已独立验证的喜钱/补杠功能提交；纯重构阶段使用原 main 的独立提交验证。
// Default to the independently verified feature candidate; the pure-refactor commit was verified against its original main.
const baseline = process.argv[2] || '4d9641f8ef4dab519eae85292547954c3510d3a0';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'mahjong-readability-'));
const report = { baseline, engines: [], scenarios: 0, actions: 0, finishedGames: 0 };

// 独立于洗牌的固定选择序列，让两份引擎每次收到完全相同的动作，而非各自随机选。
// Use a deterministic action chooser independent of shuffling so both engines receive identical actions.
function createActionRandom(seed) {
  let state = seed + 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

try {
  for (const filename of ['legacy-game.js', 'v2-game.js', 'game.js']) {
    // execFile 的参数不经过 shell；基线只用于读取 Git 中已存在的文件。
    // execFile arguments bypass the shell; the baseline only reads an existing Git object.
    const originalSource = execFileSync('git', ['show', `${baseline}:shared/${filename}`], {
      cwd: root,
      encoding: 'utf8',
    });
    // 新版引擎的共享开局校验依赖也必须来自同一个 Git 基线，不能偷用当前文件。
    // Extract the new engine's shared validator from the same baseline, never the current checkout.
    if (originalSource.includes('./start-options.js')) {
      await writeFile(join(temporaryDirectory, 'package.json'), '{"type":"module"}');
      await writeFile(
        join(temporaryDirectory, 'start-options.js'),
        execFileSync('git', ['show', `${baseline}:shared/start-options.js`], {
          cwd: root,
          encoding: 'utf8',
        }),
      );
    }
    const originalPath = join(temporaryDirectory, filename.replace('.js', '.mjs'));
    await writeFile(originalPath, originalSource);
    const original = await import(pathToFileURL(originalPath).href);
    const current = await import(pathToFileURL(join(root, 'shared', filename)).href);
    assert.deepEqual(
      Object.keys(current),
      Object.keys(original),
      `${filename}: exported API changed`,
    );

    // v3 同时覆盖方向、胡后手动确认和历史规则开关组合；旧版本使用各自原有默认值。
    // Exercise v3 direction/manual-confirmation/legacy-flag combinations; older engines keep their own defaults.
    const ruleVariants =
      filename === 'game.js'
        ? [
            {},
            { autoDiscardAfterHu: false },
            { turnDirection: 'clockwise', allowPungUpgrade: true },
            { specialHuPatterns: false, bigSingleReadyPayment: false },
            { bigSingleReadyPoints: 0 },
            { bigSingleReadyPoints: 100000 },
            { allowPungUpgrade: false },
          ]
        : [{}];
    const engineReport = { filename, scenarios: 0, actions: 0, finishedGames: 0 };
    for (const rules of ruleVariants) {
      for (let seed = 0; seed < 8; seed++) {
        const options = { seed: `readability-${seed}`, rules };
        let before = original.createGame(options);
        let after = current.createGame(options);
        const choose = createActionRandom(seed);
        assert.deepEqual(after, before, `${filename}: initial state`);
        for (let step = 0; step < 600 && before.phase !== 'finished'; step++) {
          const choices = [];
          for (let seat = 0; seat < 3; seat++) {
            const expectedActions = original.getLegalActions(before, seat);
            assert.deepEqual(current.getLegalActions(after, seat), expectedActions);
            // 每步都验证三个座位的隐私视图，避免只对比内部状态漏掉信息泄露。
            // Compare every seat’s private projection on every step, not only internal state.
            assert.deepEqual(
              current.getPlayerView(after, seat),
              original.getPlayerView(before, seat),
            );
            choices.push(...expectedActions.map((action) => ({ seat, action })));
          }
          assert.ok(choices.length, `${filename}: stalled before game end`);
          const interesting = choices.filter(
            ({ action }) => action.type === 'hu' || action.type.endsWith('Gang'),
          );
          const candidates = interesting.length && choose() < 0.8 ? interesting : choices;
          const selected = candidates[Math.floor(choose() * candidates.length)];
          const previousBefore = before;
          const previousAfter = after;
          const beforeSnapshot = structuredClone(before);
          const afterSnapshot = structuredClone(after);
          before = original.applyAction(before, selected.seat, selected.action);
          after = current.applyAction(after, selected.seat, selected.action);
          assert.deepEqual(after, before, `${filename}, seed ${seed}, step ${step}`);
          // 两份引擎都不能改动输入对象，必须把动作应用到各自的新副本。
          // Neither engine may mutate its input; both must apply the action to a new copy.
          assert.deepEqual(previousBefore, beforeSnapshot);
          assert.deepEqual(previousAfter, afterSnapshot);
          engineReport.actions++;
        }
        assert.equal(after.phase, 'finished', `${filename}: replay exceeded 600 actions`);
        current.assertGameInvariants(after);
        assert.deepEqual(after, before);
        engineReport.scenarios++;
        engineReport.finishedGames++;
      }
    }
    report.engines.push(engineReport);
    report.scenarios += engineReport.scenarios;
    report.actions += engineReport.actions;
    report.finishedGames += engineReport.finishedGames;
  }
  // 输出可记录的 JSON 报告，不写入生产或仓库状态。
  // Emit a machine-readable report without writing production or repository state.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
