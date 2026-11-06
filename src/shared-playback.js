// 同浏览器同座位的语音前缀协调；App 仍独立拥有每页画面和入队时的能力判断。
// Same-browser, same-seat voice-prefix coordination; App retains each page's visuals and receipt-time eligibility.
// 只投影公开事件，不保存快照、暗牌或凭证。完整协议见 docs/PRESENTATION-PACING.md。
// Persist only public event projections, never snapshots, concealed tiles or credentials. See the pacing guide.
import { clipsForEvent } from './character-audio.js';

export class SharedPlaybackCoordinator {
  // play 必须返回逐事件结果；cancelAudio 必须同步停止本页声音，canPlay 是播放前的动态复核。
  // play must return per-event outcomes; cancelAudio synchronously stops this page, and canPlay rechecks readiness.
  constructor({ play, cancelAudio = () => {}, canPlay = () => true,
    storage, locks = globalThis.navigator?.locks, pageId = globalThis.crypto?.randomUUID?.() || `${Math.random()}`,
    now = () => Date.now(), retryWindowMs = 1200, onDegraded = () => {}, onPendingPrefix = () => {} } = {}) {
    this.play = play;
    this.cancelAudio = cancelAudio;
    this.canPlay = canPlay;
    this.locks = locks;
    this.pageId = pageId;
    this.now = now;
    this.retryWindowMs = retryWindowMs;
    this.onDegraded = onDegraded;
    this.onPendingPrefix = onPendingPrefix;
    this.pendingPrefixOwner = null;
    this.generation = 0;
    this.localRecords = new Map();
    this.localTails = new Map();
    this.denied = new Map();
    this.deniedDeadlines = new Map();
    this.progress = new Map();
    try { this.storage = storage === undefined ? globalThis.localStorage : storage; } catch { this.storage = null; }
    this.shared = Boolean(this.storage && this.locks?.request);
    if (!this.shared) this.degrade();
  }

  // 缺少任一共享设施时明确降级为页内顺序；不能声称跨标签恰好一次。
  // Missing either facility explicitly degrades to page-local ordering, without claiming cross-tab exactly-once.
  degrade() {
    this.shared = false;
    this.onDegraded('page-local');
  }

  // 锁只覆盖本座位的声音及小记录；不接触服务端，也不构成全桌屏障。
  // The lock covers only this seat's audio and small ledger, never the server or a table-wide barrier.
  async withLock(key, work) {
    if (!this.shared) return this.withLocalLock(key, work);
    let entered = false;
    try {
      return await this.locks.request(key, async () => { entered = true; return work(); });
    } catch (error) {
      if (entered) throw error;
      this.degrade();
      return this.withLocalLock(key, work);
    }
  }

  // 降级也维持页内FIFO，避免两次异步调用重叠播放。
  // Even degraded operation keeps a page-local FIFO so asynchronous calls cannot overlap audio.
  withLocalLock(key, work) {
    const pending = (this.localTails.get(key) || Promise.resolve()).then(work);
    this.localTails.set(key, pending.catch(() => {}));
    return pending;
  }

  // 存储失败后保留最近读到的页内记录，避免本页再次播放；跨页去重不再保证。
  // On storage failure retain the last local ledger to avoid same-page replay; cross-page deduplication is degraded.
  read(key) {
    if (this.shared) {
      try {
        const raw = this.storage.getItem(key);
        if (raw) this.localRecords.set(key, JSON.parse(raw));
      } catch { this.degrade(); }
    }
    return this.localRecords.get(key);
  }
  write(key, record) {
    // 每个有界媒体片段结束都刷新目录时间；该时间不表示播放成功或允许丢弃积压。
    // Refresh directory timestamps after each bounded clip; timestamps imply neither success nor permission to discard backlog.
    record.pages[this.pageId] = this.now();
    this.localRecords.set(key, record);
    if (this.shared) {
      try { this.storage.setItem(key, JSON.stringify(record)); } catch { this.degrade(); }
    }
  }

  // 每次快照先调用（包括无事件的基线）。ticket 固化本次资格；静音期间的下标永久拒绝本页补播。
  // Call for every snapshot, including empty baselines. Tickets freeze eligibility; muted indices never revive on this page.
  async registerSnapshot(snapshot, { baseline = false, eligible = false, legacy = false, skip = false } = {}) {
    if (!snapshot?.game) return null;
    const key = `huajian-ordered-voice-v2:${snapshot.id}:${snapshot.you}`;
    const gameId = snapshot.game.id || 'legacy';
    const gameKey = `${snapshot.id}:${gameId}`;
    const history = snapshot.game.history || [];
    const generation = this.generation;
    const previous = this.progress.get(gameKey);
    if (previous && snapshot.revision < previous.revision) return null;
    const denied = this.denied.get(gameKey) || new Set();
    const deadlines = this.deniedDeadlines.get(gameKey) || new Map();
    // 首次基线不是本页新入队事件，即使浏览器尚未解锁也不能永久否决整段共享历史。
    // An initial baseline is not newly queued history: a browser that starts locked must not permanently deny the shared prefix.
    // 基线票据仍静默；解锁后新实时事件才可代另一页补齐旧前缀。其后静音新增后缀仍永久拒绝。
    // The baseline ticket stays silent; a later unlocked live event may recover a sibling's prefix. Later muted suffixes remain denied.
    const initialBaseline = baseline && !previous;
    if (skip || (!eligible && !initialBaseline)) {
      const start = skip ? 0 : (previous?.count || 0);
      const deadline = this.now() + this.retryWindowMs;
      for (let index = start; index < history.length; index++) {
        denied.add(index);
        if (!deadlines.has(index)) deadlines.set(index, deadline);
      }
    }
    this.denied.set(gameKey, denied);
    this.deniedDeadlines.set(gameKey, deadlines);
    this.progress.set(gameKey, { count: Math.max(previous?.count || 0, history.length), revision: snapshot.revision });
    const events = history.map((event, index) => ({
      index, eventKey: `${gameKey}:${index}`, type: event.type,
      urls: clipsForEvent(event, snapshot.game.characters),
    }));
    const ticket = { key, gameId, gameKey, events, eligible: Boolean(eligible) && !skip, generation, baseline };
    await this.withLock(key, () => {
      if (generation !== this.generation) return;
      let record = this.read(key);
      if (record && snapshot.revision < record.revision && record.gameId !== gameId) return;
      // 过期租约只能清理页面目录，不能证明积压已播放或页面已关闭。
      // An expired lease only permits pruning the page directory; it proves neither playback completion nor departure.
      // 同局新页基线必须保留旧共享前缀，否则前台断网超过30秒的页面恢复后会丢失已收队列。
      // A new baseline in the same game preserves the shared prefix, including queues held by foreground pages offline over 30 seconds.
      if (!record || record.gameId !== gameId) {
        // 基线登记可能排队时被生命周期取消；本页已经同步保存的 previous.count 仍界定新后缀。
        // A lifecycle change can cancel queued baseline registration; synchronous previous.count still identifies the new suffix.
        // 真正首次基线保持静默；非基线收到的新事件不能因为共享记录尚未建立而被吞掉。
        // A genuine initial baseline stays silent; a later live suffix must not disappear merely because its ledger is missing.
        const floor = baseline || legacy ? history.length : Math.min(previous?.count ?? history.length, history.length);
        record = { gameId, revision: snapshot.revision, floor, outcomes: {}, pages: {} };
      }
      // 旧服务端展示已消费自己的历史，只显式旧模式边界可以前移共享起点。
      // Legacy server presentation owns its history; only an explicit legacy boundary may advance the shared floor.
      if (legacy && snapshot.revision >= record.revision) record.floor = Math.max(record.floor, history.length);
      record.revision = Math.max(record.revision, snapshot.revision);
      // 页面时间只限制目录大小；只有逐事件终态、新局或明确legacy边界能终结旧前缀。
      // Page timestamps only bound directory size; only event outcomes, a new game or an explicit legacy boundary retire the old prefix.
      record.pages = Object.fromEntries(Object.entries(record.pages).filter(([, time]) => this.now() - time < 30000));
      record.pages[this.pageId] = this.now();
      this.write(key, record);
    });
    return ticket;
  }

  // 请求某批末端之前的完整公开前缀。每次仅播放一个事件，失败头部不能被后续声音越过。
  // Request the public prefix through a batch's last index. Play one event at a time so failures cannot be overtaken.
  async playThrough(receipt, batchEvents) {
    const ticket = await receipt;
    if (!ticket || !ticket.eligible || ticket.generation !== this.generation) return;
    const requested = new Set(batchEvents.map((event) => event.eventKey));
    const end = ticket.events.findLastIndex((event) => requested.has(event.eventKey));
    if (end < 0) return;
    // 此计数仅向App暴露“本地批之外”的共享补播，避免双胡/本地队列重复计数。
    // Expose only shared recovery outside this local batch, avoiding double-counting local queues or paired wins.
    const owner = Symbol('pending-prefix');
    this.pendingPrefixOwner = owner;
    const reportPendingPrefix = (record) => {
      if (this.pendingPrefixOwner !== owner || ticket.generation !== this.generation) return;
      const count = record?.gameId === ticket.gameId ? ticket.events.slice(record.floor, end + 1)
        .filter((event) => event.urls.length && !requested.has(event.eventKey) && !record.outcomes[event.index]?.terminal).length : 0;
      this.onPendingPrefix(count);
    };
    try {
      reportPendingPrefix(this.read(ticket.key));
      while (ticket.generation === this.generation && this.canPlay()) {
        const waiting = await this.withLock(ticket.key, async () => {
          if (ticket.generation !== this.generation || !this.canPlay()) return false;
          const record = this.read(ticket.key);
          if (!record || record.gameId !== ticket.gameId) return false;
          record.pages[this.pageId] = this.now();
          this.write(ticket.key, record);
          reportPendingPrefix(record);
          for (let index = record.floor; index <= end; index++) {
            const event = ticket.events[index];
            let outcome = record.outcomes[index];
            if (!event?.urls.length || outcome?.terminal) continue;
            if (outcome && this.now() >= outcome.deadline) {
              // 超时是明确失败终态，不冒充成功；终态后禁止迟到页面重试而造成 2→1 倒序。
              // Expiry is explicit terminal failure, never success; late retry is forbidden to prevent 2→1 inversion.
              outcome.terminal = true;
              outcome.status = outcome.failureStatus || 'failed';
              this.write(ticket.key, record);
              reportPendingPrefix(record);
              continue;
            }
            if (this.denied.get(ticket.gameKey)?.has(index) || outcome?.attempted.includes(this.pageId)) {
              // 本页无资格也不能越过共享头部；给健康副页有限机会，然后记录失败终态。
              // An ineligible page cannot overtake the head; allow a bounded sibling opportunity, then fail explicitly.
              // 同一次静音/略过共享一个截止时间，不能逐条累计 1.2 秒而拖慢解除静音后的新声音。
              // One mute/skip receipt shares one deadline; do not accumulate 1.2 seconds per suppressed event.
              outcome ||= { status: 'pending', attempted: [], failureStatus: 'skipped',
                deadline: this.deniedDeadlines.get(ticket.gameKey)?.get(index) ?? this.now() + this.retryWindowMs };
              record.outcomes[index] = outcome;
              if (this.now() >= outcome.deadline) {
                outcome.status = outcome.failureStatus || 'failed';
                outcome.terminal = true;
                this.write(ticket.key, record);
                reportPendingPrefix(record);
                continue;
              }
              this.write(ticket.key, record);
              reportPendingPrefix(record);
              return true;
            }
            let result;
            try { result = await this.play([event]); } catch { result = null; }
            const status = result?.events?.find((item) => item.eventKey === event.eventKey)?.status;
            if (status === 'success') {
              record.outcomes[index] = { status: 'success', terminal: true };
            } else {
              outcome ||= { status: 'pending', attempted: [], deadline: this.now() + this.retryWindowMs };
              outcome.attempted.push(this.pageId);
              record.outcomes[index] = outcome;
            }
            this.write(ticket.key, record);
            reportPendingPrefix(record);
            if (ticket.generation !== this.generation || !this.canPlay()) return false;
            if (status !== 'success') return true;
          }
          return false;
        });
        if (!waiting) return;
        // 必须在锁外等候，健康副页才能接管失败头部；等待有截止，不依赖失联页回执。
        // Wait outside the lock so healthy siblings can retry the head; the deadline does not depend on vanished peers.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      // cancel后的旧Promise即使迟到完成，也无权清掉新一批的计数。
      // A late promise from before cancel cannot clear a newer batch's count.
      if (this.pendingPrefixOwner === owner && ticket.generation === this.generation) {
        this.pendingPrefixOwner = null;
        this.onPendingPrefix(0);
      }
    }
  }

  // 隐藏、离桌、换局撤销本页票据和声音，不删除共享成功记录，也不停止其他页。
  // Hide/leave/game changes revoke this page's tickets and sound, without deleting success or stopping siblings.
  cancel() {
    this.generation++;
    this.pendingPrefixOwner = null;
    this.onPendingPrefix(0);
    for (const [gameKey, progress] of this.progress) {
      const denied = this.denied.get(gameKey) || new Set();
      const deadlines = this.deniedDeadlines.get(gameKey) || new Map();
      const deadline = this.now() + this.retryWindowMs;
      for (let index = 0; index < progress.count; index++) {
        denied.add(index);
        if (!deadlines.has(index)) deadlines.set(index, deadline);
      }
      this.denied.set(gameKey, denied);
      this.deniedDeadlines.set(gameKey, deadlines);
    }
    this.cancelAudio();
  }
}
