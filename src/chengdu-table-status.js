// 成都两种牌桌共用状态文案：只读已裁剪视图，不判定合法动作、不改变准备或回合。
// Shared Chengdu table status reads the filtered view only, without judging actions or changing preparation/turns.
// 从原ChengduTable逐分支提取，避免真实桌误用App专供成都大厅的“等待开局”提示。
// Extracted branch-for-branch from ChengduTable so realistic play cannot reuse App's Chengdu lobby message.
export function chengduTableStatus(state, blocked = false) {
  const game = state?.game;
  if (!game) return '等待四家落座开局';
  const mySeat = game.mySeat;
  const me = game.players.find((player) => player.seat === mySeat);
  const nameFor = (seat) => game.participantNames?.[seat] ||
    state.seats?.find((player) => player?.seat === seat)?.name || `牌友 ${seat + 1}`;
  const legalActions = mySeat == null ? [] : game.legalActions || [];
  if (blocked) return '正在同步或处理操作，请稍等';
  if (game.phase === 'finished') {
    return game.finishReason === 'wallExhausted' ? '牌墙已尽，本局流局结算完成' : '本局结束';
  }
  // 观众不能看到“轮到你”或私有准备提交状态，只描述公开阶段与当前座位。
  // Spectators receive public phases/current seats, never personal preparation or an own-turn instruction.
  if (mySeat == null) {
    if (game.phase === 'exchange') return '等待四家选择换牌';
    if (game.phase === 'dingque') return '等待四家定缺';
    if (game.phase === 'claim') return '等待牌友回应';
    return `等待${nameFor(game.currentSeat)}出牌`;
  }
  if (game.phase === 'exchange') {
    return game.preparation?.myExchange ? '换牌已提交，等待其他牌友' : '换三张：选择同一花色的三张牌';
  }
  if (game.phase === 'dingque') {
    return me?.dingqueSubmitted ? '定缺已提交，等待其他牌友' : '定缺：选择本局要打缺的花色';
  }
  if (me?.won) return '你已胡牌，本局不再摸打或胡牌';
  if (game.phase === 'claim') {
    if (game.claim?.hasResponded) return '回应已提交，等待其他牌友';
    return legalActions.length ? '这张牌，等你回应' : '等待牌友回应';
  }
  if (game.currentSeat === mySeat) return '轮到你：选择一张合法手牌，再确认出牌';
  return `等待${nameFor(game.currentSeat)}出牌`;
}
