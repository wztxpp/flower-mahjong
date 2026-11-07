// 角色立绘展示层：只接收播放器已展示的公开胡牌事件，不读取手牌、待决回应或账本。
// Portrait presentation accepts only public wins already shown by playback, never hands, pending claims or payments.
// 每个绝对座位独立到期；不会改游戏、共享声音、按钮节拍或服务器协议。
// Absolute seats expire independently without changing games, shared audio, action pacing or server protocols.
export const PORTRAIT_REACTION_MS = 3000;

// 用户提供的原始 PNG 原样保留；新路径避免浏览器继续缓存旧基础图。未提供三态者使用原图。
// Preserve user PNG bytes; new paths avoid stale base-image caches. Characters without a supplied set keep existing art.
export const CHARACTER_PORTRAITS = Object.freeze({
  sweet: Object.freeze({
    base: '/characters/sweet-base.png',
    win: '/characters/sweet-win.png',
    discardLoss: '/characters/sweet-discard-loss.png',
  }),
  sunny: Object.freeze({
    base: '/characters/sunny-base.png',
    win: '/characters/sunny-win.png',
    discardLoss: '/characters/sunny-discard-loss.png',
  }),
  landlord: Object.freeze({
    base: '/characters/landlord-base.png',
    win: '/characters/landlord-win.png',
    discardLoss: '/characters/landlord-discard-loss.png',
  }),
  honest: Object.freeze({
    base: '/characters/honest-base.png',
    win: '/characters/honest-win.png',
    discardLoss: '/characters/honest-discard-loss.png',
  }),
  wealthy: Object.freeze({
    base: '/characters/wealthy-base.png',
    win: '/characters/wealthy-win.png',
    discardLoss: '/characters/wealthy-discard-loss.png',
  }),
  star: Object.freeze({
    base: '/characters/star-base.png',
    win: '/characters/star-win.png',
    discardLoss: '/characters/star-discard-loss.png',
  }),
  elegant: Object.freeze({
    base: '/characters/elegant-base.png',
    win: '/characters/elegant-win.png',
    discardLoss: '/characters/elegant-discard-loss.png',
  }),
});

// 仅按角色ID和公开表情选静态路径；缺素材/无效表情回基础图，绝不猜测或访问牌面。
// Select static paths by character ID and public reaction; missing art/invalid reactions fall back without consulting tiles.
export function portraitForCharacter(character, reaction) {
  const portraits = CHARACTER_PORTRAITS[character.id];
  if (reaction === 'win' || reaction === 'discardLoss') {
    return portraits?.[reaction] || portraits?.base || character.portrait;
  }
  return portraits?.base || character.portrait;
}

// 首次拿到本局角色后预热其两张反应图，减少首次切换时空白；不请求未分配角色或私人数据。
// Warm the assigned characters' two reactions at first game receipt to reduce first-switch blanks; fetch no private data.
export function warmCharacterPortraits(characters, cache, createImage = () => new Image()) {
  for (const id of new Set(characters || [])) {
    const portraits = CHARACTER_PORTRAITS[id];
    if (!portraits) continue;
    for (const path of [portraits.win, portraits.discardLoss]) {
      if (cache.has(path)) continue;
      // 预热只是缓存优化；浏览器拒绝/资源失败不能让权威快照应用失败。
      // Warming only optimizes caching; browser/resource failures must never reject an authoritative snapshot.
      try {
        const image = createImage();
        cache.set(path, image);
        image.onerror = () => { if (cache.get(path) === image) cache.delete(path); };
        image.src = path;
      } catch {
        cache.delete(path);
      }
    }
  }
}

// 输入是已提交事件，而不是点击意图；自摸只标赢家，弃牌胡才标真实炮家，抢杠不冒充放炮。
// Inputs are committed events, not click intents: self-draw marks only its winner; only discard wins mark a discarder.
// 不限制赢家数量，因此四人一炮三响也全部显示；严格座位检查保留零号且拒绝角色池下标。
// Every winner is retained, including triple wins; strict seat checks preserve zero and reject roster indexes as seats.
export function portraitReactionsForEvents(events, playerCount = 3) {
  const reactions = {};
  if (playerCount !== 3 && playerCount !== 4) return reactions;
  const validSeat = (seat) => Number.isInteger(seat) && seat >= 0 && seat < playerCount;
  for (const event of events) {
    if (event?.type !== 'hu' || !validSeat(event.seat) ||
      !['selfDraw', 'discard', 'kongDiscard', 'robKong'].includes(event.source)) continue;
    reactions[event.seat] = 'win';
    if (['discard', 'kongDiscard'].includes(event.source) &&
      validSeat(event.fromSeat) && event.fromSeat !== event.seat) {
      reactions[event.fromSeat] = 'discardLoss';
    }
  }
  return reactions;
}

// 页内短暂反馈：同座新反馈替换旧反馈，其他座位各自继续。定时器不阻挡下一步游戏。
// Page-local feedback replaces a seat's prior reaction while other seats continue; timers never block gameplay.
export class CharacterPortraitReactions {
  // 时钟可注入以精确测试到期/过期回调；onChange只发布新对象，避免Vue漏掉原地修改。
  // Injectable clocks test expiry/stale callbacks; onChange publishes fresh objects for Vue reactivity.
  constructor({ onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.onChange = onChange;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.active = new Map();
    this.reactions = {};
  }

  // 只更新本批涉及的座位；每座位独立身份防止旧超时清除后来的胡/放炮表情。
  // Update only seats touched by this batch; per-seat identities stop old timeouts from clearing newer reactions.
  present(events, playerCount) {
    const incoming = portraitReactionsForEvents(events, playerCount);
    if (!Object.keys(incoming).length) return;
    for (const [seat, reaction] of Object.entries(incoming)) {
      this.clearTimer(this.active.get(seat)?.timer);
      const entry = {};
      this.active.set(seat, entry);
      this.reactions[seat] = reaction;
      entry.timer = this.setTimer(() => {
        if (this.active.get(seat) !== entry) return;
        this.active.delete(seat);
        delete this.reactions[seat];
        this.onChange({ ...this.reactions });
      }, PORTRAIT_REACTION_MS);
    }
    this.onChange({ ...this.reactions });
  }

  // 后台、换局/换桌、略过、卸载都清理；普通轮询、别人的动作和飞牌结束不调用此方法。
  // Clear on visibility/game/room/skip/unmount boundaries, not polling, other actions or flight completion.
  reset() {
    for (const entry of this.active.values()) this.clearTimer(entry.timer);
    this.active.clear();
    this.reactions = {};
    this.onChange({});
  }
}
