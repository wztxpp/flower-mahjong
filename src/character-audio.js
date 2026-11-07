// 声音层入口：App 用游标挑出新事件，再交给队列播放；音频绝不修改游戏状态。
// Audio entry: App selects new events with the cursor, then queues playback; audio never changes game state.
// 详见 docs/FRONTEND-READING-GUIDE.md 的音频章节。 / See the audio section in docs/FRONTEND-READING-GUIDE.md.
import { gameCharacters, SEAT_COUNT } from '../shared/character-assignment.js';
import { tilePresentation } from './mahjong-tile-presentation.js';
import { CHARACTER_PORTRAITS } from './character-portraits.js';
/* 固定绝对座位，不随观察者变化：所有客户端听到相同角色。 / Fixed absolute seats, never viewer-relative: all clients hear the same character. */
// 角色 ID 与资源路径是客户端与服务端共享契约。座位是绝对座位，不随观察者旋转。
// Character IDs and asset paths are shared client/server contracts. Seats are absolute, not viewer-relative.
export const CHARACTERS = Object.freeze([
  { id: 'sweet', name: '小桃', style: '萝莉音', portrait: CHARACTER_PORTRAITS.sweet.base },
  { id: 'elegant', name: '清岚', style: '御姐音', portrait: CHARACTER_PORTRAITS.elegant.base },
  { id: 'sunny', name: '晴禾', style: '阳光少女音', portrait: CHARACTER_PORTRAITS.sunny.base },
  { id: 'landlord', name: '地主', style: '豪爽男声', portrait: CHARACTER_PORTRAITS.landlord.base },
  { id: 'honest', name: '老实人', style: '温厚男声', portrait: CHARACTER_PORTRAITS.honest.base },
  { id: 'wealthy', name: '富婆', style: '雍容女声', portrait: CHARACTER_PORTRAITS.wealthy.base },
  { id: 'star', name: '女明星', style: '明亮女声', portrait: CHARACTER_PORTRAITS.star.base },
]);
// 旧局没有角色分配时按绝对座位兜底；非法下标使用第一个角色。
// For older games without assignments, fall back by absolute seat; invalid indices use the first character.
export function characterForSeat(seat, seatCount = SEAT_COUNT) {
  // 默认只接受三个真实座位；显式四人局才允许第四位的兼容角色。
  // Three seats remain the default; only explicit four-seat games allow a fourth fallback character.
  const fallback = gameCharacters(undefined, seatCount);
  const id = Number.isInteger(seat) && seat >= 0 && seat < seatCount
    ? fallback[seat]
    : fallback[0];
  return CHARACTERS.find((character) => character.id === id);
}
// 声音只接受服务端公开的三/四项映射；七人角色池绝不被误当作七座位。
// Audio accepts only server-projected three/four-entry maps; the seven-character roster never implies seven seats.
function audioSeatCount(characters) {
  return Array.isArray(characters) && characters.length === 4 ? 4 : SEAT_COUNT;
}
// 仅把合法公开动作映射为音频路径；摸牌、隐藏手牌和未确认申请不发声。
// Map valid public actions to audio paths; draws, hidden hands and unconfirmed requests remain silent.
export function clipForEvent(event, characters) {
  const seatCount = audioSeatCount(characters);
  // 先拒绝无效座位，避免构造错误资源路径或播报未知玩家。
  // Reject invalid seats before building asset paths or announcing unknown players.
  if (!Number.isInteger(event?.seat) || event.seat < 0 || event.seat >= seatCount) return null;
  let clip;
  // 仅公开的已提交弃牌查询展示目录；18–26使用万牌语音，隐藏/非法牌不发声。
  // Only committed public discards use media lookup; 18–26 use wan calls, while hidden/invalid tiles stay silent.
  // 资源可用不放宽花麻将0–17的服务端动作白名单，也不开放成都正式开局。
  // Available media neither widens Flower's server action allowlist nor enables Chengdu starts.
  if (event.type === 'discard') clip = tilePresentation(event.tile)?.voiceClip;
  else if (event.type === 'peng') clip = 'peng';
  // 胡牌只按已提交来源选择一条语音，不再额外追加“胡”。
  // A win selects one clip from its committed source, without an extra hu clip.
  else if (event.type === 'hu')
    clip =
      event.source === 'selfDraw'
        ? 'zimo'
        : ['discard', 'kongDiscard'].includes(event.source)
          ? 'fangpao'
          : event.source === 'robKong'
            ? 'qianggang'
            : null;
  else if (['mingGang', 'anGang', 'buGang', 'addGang'].includes(event.type)) clip = 'gang';
  // 优先使用服务端本局角色 ID，缺失或未知 ID 才用兼容映射。
  // Prefer the server game’s character ID; fall back only for missing or unknown IDs.
  return clip
    ? `/voices/${(CHARACTERS.find((character) => character.id === characters?.[event.seat]) || characterForSeat(event.seat, seatCount)).id}/${clip}.mp3`
    : null;
}

/* 仅根据已提交的来源分类胡牌，并使用赢家的角色。 / Only classify a win from the committed source, using the winner's character. */
// 保持数组接口，方便队列统一处理；没有可播动作时返回空数组。
// Keep an array interface for the queue; unsupported events return an empty array.
export function clipsForEvent(event, characters) {
  const clip = clipForEvent(event, characters);
  if (!clip) return [];
  return [clip];
}

/* 只观察服务端已提交历史，不根据按钮点击或待决申请猜测播报。 / Observe committed server history, not speculative button clicks or pending claims. */
// 游标记住已见历史长度与版本，不存游戏规则。首次快照只建立基线，避免重播整局。
// The cursor remembers seen history length and revision, not rules. The first snapshot establishes a baseline without replaying the game.
export class ActionVoiceCursor {
  // 离桌或可见性变化后，清除上一局标识、已读长度与版本。
  // Clear the previous game key, consumed length and revision after departure or visibility changes.
  reset() {
    this.gameKey = null;
    this.count = 0;
    this.revision = -1;
  }
  // 创建游标时采用同一复位路径，避免初始值与重连状态不一致。
  // Use the same reset path for construction so initial and reconnect states agree.
  constructor() {
    this.reset();
  }
  // 每次快照仅返回新追加的已提交事件；silent 仍前移游标，但不产生待播事件。
  // Return only newly appended committed events; silent advances the cursor without emitting events.
  consumeEvents(state, { silent = false } = {}) {
    const history = state?.game?.history || [];
    // 房间 ID 与局 ID 联合区分同桌下一局；旧数据没有局 ID 时使用 legacy。
    // Combine room and game IDs to distinguish successive rounds; use legacy when old data lacks a game ID.
    const key = state?.game ? `${state.id}:${state.game.id || 'legacy'}` : null;
    if (!key) {
      this.reset();
      return [];
    }
    // 拒绝乱序旧版本，不能让游标倒退并再次播报。
    // Reject out-of-order older revisions so the cursor cannot move backward and replay events.
    if (this.gameKey === key && state.revision < this.revision) return [];
    // 换局或历史变短都视为新基线；不能把整段历史当作新现场动作。
    // A new game or shorter history establishes a baseline, not a backlog of new live actions.
    const baseline = key !== this.gameKey || history.length < this.count;
    const events = baseline || silent ? [] : history.slice(this.count);
    this.gameKey = key;
    this.count = history.length;
    this.revision = state.revision;
    // eventKey 使用历史绝对下标，保证同牌、同类型的多次动作仍有独立身份。
    // eventKey uses the absolute history index so repeated tile/action pairs remain distinct.
    return events.map((event, index) => ({
      ...event,
      eventKey: `${key}:${this.count - events.length + index}`,
      urls: clipsForEvent(event, state.game.characters),
    }));
  }
  // 兼容仅需要音频 URL 的调用方；flatMap 将每个事件的 URL 数组合并。
  // Support callers needing only audio URLs; flatMap merges each event’s URL array.
  consume(state, options) {
    return this.consumeEvents(state, options).flatMap((event) => event.urls);
  }
}

/* 单个串行 WebAudio 队列，解锁必须直接由用户手势触发。 / A single serial WebAudio queue. Unlock must run directly in a user gesture. */
// 单个 WebAudio 队列串行播放。依赖可注入，测试无需真实浏览器音响。
// One WebAudio queue plays serially. Injectable dependencies allow tests without real browser audio.
export class CharacterAudio {
  // 保存音频上下文工厂、下载函数、时钟和状态回调；generation 是取消代数。
  // Store the context factory, fetcher, clock and status callback; generation is a cancellation counter.
  constructor({
    createContext = () => new (window.AudioContext || window.webkitAudioContext)(),
    fetchAudio = (url, options) => fetch(url, options),
    now = () => Date.now(),
    onStatus = () => {},
  } = {}) {
    this.createContext = createContext;
    this.fetchAudio = fetchAudio;
    this.now = now;
    this.onStatus = onStatus;
    this.queue = [];
    this.buffers = new Map();
    this.loads = new Set();
    this.muted = false;
    this.unlocked = false;
    this.generation = 0;
    this.running = false;
  }
  // 必须由用户手势触发 resume；播放一个无声样本以完成浏览器声音解锁。
  // Resume must follow a user gesture; play one silent sample to complete browser audio unlocking.
  async unlock() {
    try {
      this.context ||= this.createContext();
      // 浏览器暂停音频时立即失去解锁状态并清空旧语音，避免恢复后积压。
      // When the browser suspends audio, mark it locked and clear stale speech rather than backlog on resume.
      this.context.onstatechange = () => {
        if (!this.disposed && this.context.state !== 'running') {
          this.unlocked = false;
          this.clear();
          this.onStatus('locked');
        }
      };
      await this.context.resume();
      if (this.context.state !== 'running') throw new Error('Audio locked');
      const source = this.context.createBufferSource();
      source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      source.connect(this.context.destination);
      source.start();
      this.unlocked = true;
      this.onStatus('ready');
      return true;
    } catch {
      this.unlocked = false;
      this.onStatus('locked');
      return false;
    }
  }
  // 静音不仅阻止新音频，还必须停止正在播放和下载的旧队列。
  // Muting blocks new audio and stops current playback and pending downloads.
  setMuted(value) {
    this.muted = value;
    if (value) this.clear();
  }
  // 递增代数使已经 await 的旧任务失效；同时终止下载和当前音源。
  // Increment the generation to invalidate awaited work, then abort downloads and stop the current source.
  clear() {
    this.generation++;
    // 先停止实际声音，再释放等待者；取消不能依赖浏览器一定发送 onended。
    // Stop audible playback before releasing waiters; cancellation cannot depend on onended delivery.
    this.cancelPlayback?.();
    this.activeItem?.complete?.();
    for (const item of this.queue) item.complete?.();
    this.queue = [];
    // 取消的缓存 Promise 不可继续复用，因此先删对应缓存再 abort。
    // A cancelled cached promise cannot be reused, so delete its entry before aborting.
    for (const controller of this.loads) {
      this.buffers.delete(controller.url);
      controller.abort();
    }
    this.activeItem = null;
    try {
      this.source?.stop();
    } catch {
      /* 已经停止，无需再次处理。 / already stopped */
    }
    this.source = null;
  }
  // 通用队列为每条音频保存入队时间；最多保留十二条，超额丢最旧项。
  // The general queue timestamps each clip and retains at most twelve, dropping the oldest excess items.
  enqueue(urls) {
    if (this.context && this.context.state !== 'running') {
      this.unlocked = false;
      this.onStatus('locked');
    }
    // 未解锁或静音时直接忽略，不能先排队再在未来突然补播。
    // Ignore while muted or locked rather than enqueueing speech that might unexpectedly play later.
    if (this.muted || !this.unlocked || this.context?.state !== 'running') return;
    const at = this.now();
    for (let index = 0; index < urls.length; index++) {
      const url = urls[index],
        group = [url];
      this.queue.push({ urls: group, at });
    }
    let queuedClips = this.queue.reduce((count, item) => count + item.urls.length, 0);
    while (queuedClips > 12) {
      const dropped = this.queue.shift();
      queuedClips -= dropped.urls.length;
      // 通用入口挤出的保序批次也必须结算，不能遗留等待者。
      // An ordered batch evicted by the general entry must also release its waiter.
      dropped.complete?.();
    }
    this.drain();
  }
  /* 现场快照已包含自动回合，不补播积压动作。 / Live snapshots already include automatic turns. Never narrate that backlog. */
  // 现场播报不朗读整个自动回合：有胡优先最多两次，否则只播最新公开动作。
  // Live speech never narrates a whole automatic-turn backlog: prefer up to two wins, otherwise only the latest public action.
  // 返回 Promise<void>：本批所选语音全部结束或被跳过/取消/失败后完成，永不因音频失败拒绝。
  // Return Promise<void>: settle when this selected batch ends or is skipped/cancelled/failed; audio failures do not reject it.
  enqueueLive(events) {
    // 未解锁或静音时直接忽略，不能先排队再在未来突然补播。
    // Ignore while muted or locked rather than enqueueing speech that might unexpectedly play later.
    if (this.disposed || this.muted || !this.unlocked || this.context?.state !== 'running')
      return Promise.resolve();
    const voiced = events.filter((event) => event.urls?.length);
    if (!voiced.length) return Promise.resolve();
    const wins = voiced.filter((event) => event.type === 'hu');
    // 同一次原子服务端更新里胡牌优先；没有胡牌则只保留最新已提交公开动作。
    // A win takes precedence over all ordinary calls in its atomic server update.
    // Without a win, only the latest committed public action is still current.
    const latest = wins.length ? wins.slice(-2) : voiced.slice(-1);
    // 正在播胡时普通动作不打断它；新的胡牌仍可替换旧现场队列。
    // Ordinary actions do not interrupt a live win; a newer win may still replace the live queue.
    if (this.activeItem?.live && this.activeItem.kind === 'hu' && !wins.length)
      return Promise.resolve();
    this.clear();
    let complete;
    const completion = new Promise((resolve) => {
      complete = resolve;
    });
    const at = this.now();
    // 现场声音寿命很短：胡 650ms、普通动作 550ms；这是开始前的时效检查。
    // Live audio has a short start deadline: 650ms for wins and 550ms for ordinary actions.
    this.queue.push({
      complete,
      urls: latest.flatMap((event) => event.urls),
      at,
      live: true,
      kind: wins.length ? 'hu' : latest[0].type,
      maxAge: wins.length ? 650 : 550,
    });
    this.drain();
    return completion;
  }
  // 保序批次保留事件身份；返回 { events: [{ eventKey, status }] }，顺序与输入一致。
  // Ordered batches retain identity and return { events: [{ eventKey, status }] } in input order.
  // success 仅表示该事件全部片段自然结束；失败、取消和未播放不能写入已播记录。
  // success means every clip naturally ended; failed, cancelled and skipped events must not be marked heard.
  enqueueOrdered(events) {
    const entries = events.map((event) => ({
      eventKey: event.eventKey ?? null,
      urls: [...(event.urls || [])],
      status: event.urls?.length ? null : 'skipped',
    }));
    let settled = false;
    let complete;
    const completion = new Promise((resolve) => {
      // 取消只结算未完成项，保留此前成功/失败；复制报告避免旧 await 后续更改返回值。
      // Cancellation settles unfinished entries only; copy the report so stale awaits cannot mutate it.
      complete = (fallback = 'cancelled') => {
        if (settled) return;
        settled = true;
        for (const entry of entries) entry.status ||= fallback;
        resolve({ events: entries.map(({ eventKey, status }) => ({ eventKey, status })) });
      };
    });
    if (this.disposed || this.muted || !this.unlocked || this.context?.state !== 'running') {
      complete('skipped');
      return completion;
    }
    const urls = entries.flatMap((entry) => entry.urls);
    if (!urls.length) {
      complete('skipped');
      return completion;
    }
    this.queue.push({ urls, entries, ordered: true, complete });
    this.drain();
    return completion;
  }
  // 逐事件、逐片段独立播放；任一失败不吞掉其他赢家，单个事件有失败则不算完整已播。
  // Play each event/clip independently; one failure cannot swallow another winner or count as a fully heard event.
  async playOrdered(item, generation) {
    const isCurrent = () =>
      generation === this.generation &&
      !this.disposed && !this.muted && this.unlocked && this.context?.state === 'running';
    for (const entry of item.entries) {
      if (!isCurrent()) break;
      if (!entry.urls.length) continue;
      let failed = false;
      for (const url of entry.urls) {
        if (!isCurrent()) break;
        try {
          const buffer = await this.buffer(url);
          // 冷下载不采用旧现场过期窗口，但 await 后必须重新检查取消代数和音频状态。
          // Cold downloads ignore legacy live expiry, but must recheck cancellation and readiness after await.
          if (!isCurrent()) break;
          const status = await this.playBuffer(buffer);
          if (status !== 'success') failed = true;
          if (status === 'failed' && isCurrent()) this.onStatus('unavailable');
        } catch {
          failed = true;
          if (isCurrent()) this.onStatus('unavailable');
        }
      }
      // clear 已同步结算的事件不能被迟到下载覆盖；暂停且无 statechange 也不算成功。
      // Never overwrite entries settled synchronously by clear; suspension without statechange is not success either.
      if (entry.status === null)
        entry.status = !isCurrent() ? 'cancelled' : failed ? 'failed' : 'success';
    }
  }
  /* 只预热简短公开胡牌语音，并限制为三个并发后台请求。 / Warm only short public win calls, in three bounded background requests. */
  // 只预热公开胡牌短语；三个异步工作循环共享 next 下标，限制并发下载数量。
  // Preload only public win calls; three async worker loops share the next index to bound concurrency.
  async warmWins(characters) {
    // 未解锁或静音时直接忽略，不能先排队再在未来突然补播。
    // Ignore while muted or locked rather than enqueueing speech that might unexpectedly play later.
    if (this.muted || !this.unlocked || this.context?.state !== 'running') return;
    const generation = this.generation;
    const urls = [
      ...new Set(
        Array.from({ length: audioSeatCount(characters) }, (_, seat) => seat).flatMap((seat) =>
          ['selfDraw', 'discard', 'robKong'].flatMap((source) =>
            clipsForEvent({ type: 'hu', seat, source }, characters),
          ),
        ),
      ),
    ];
    let next = 0;
    await Promise.all(
      [0, 1, 2].map(async () => {
        // 每次取下一项前检查代数与静音，清队列后不再启动新的预热。
        // Before each next item, check generation and mute state so clearing stops new warm-up work.
        while (
          next < urls.length &&
          generation === this.generation &&
          !this.muted &&
          this.unlocked
        ) {
          try {
            await this.buffer(urls[next++]);
          } catch {
            /* 可选预热失败不能阻断牌局。 / Optional warming must never block play. */
          }
        }
      }),
    );
  }
  // 缓存的是 Promise，因此同时请求同一 URL 会共用一次下载和解码。
  // Cache promises so concurrent requests for the same URL share one download and decode.
  async buffer(url) {
    if (!this.buffers.has(url)) {
      const controller = new AbortController();
      controller.url = url;
      this.loads.add(controller);
      let timer;
      // 主动取消与四秒超时都拒绝同一个等待 Promise，防止加载无限悬挂。
      // Explicit cancellation and the four-second timeout reject the same waiting promise to prevent indefinite loads.
      const cancelled = new Promise((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Voice load cancelled')),
          { once: true },
        );
        timer = setTimeout(() => controller.abort(), 4000);
      });
      const download = Promise.resolve()
        .then(() => this.fetchAudio(url, { signal: controller.signal }))
        .then((response) => {
          // HTTP 成功且确为音频才解码，避免把错误 HTML 页面交给 WebAudio。
          // Decode only successful audio responses, never an HTML error page.
          if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/'))
            throw new Error('Voice unavailable');
          return response.arrayBuffer();
        })
        .then((bytes) => this.context.decodeAudioData(bytes));
      // 下载或取消谁先完成就决定结果；无论成功失败都清理计时器和在途集合。
      // Whichever finishes first, download or cancellation, decides the result; always clean up the timer and in-flight set.
      const promise = Promise.race([download, cancelled]).finally(() => {
        clearTimeout(timer);
        this.loads.delete(controller);
      });
      this.buffers.set(url, promise);
      // 失败缓存可重试；只有缓存仍指向本 Promise 时才删除，避免误删后来请求。
      // Failed loads may retry; delete only if the cache still holds this promise, not a newer replacement.
      promise.catch(() => {
        if (this.buffers.get(url) === promise) this.buffers.delete(url);
      });
    }
    return this.buffers.get(url);
  }
  // 单消费者循环保证语音不重叠；running 在首次 await 前设置，阻止第二个循环。
  // A single-consumer loop prevents overlap; set running before the first await to block a second drain.
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.muted && this.unlocked) {
        // 记下当前代数；下载完成时可能已经静音、离桌或被新现场动作替换。
        // Capture the generation; by download completion the user may have muted, left or replaced the live action.
        const item = this.queue.shift(),
          generation = this.generation;
        this.activeItem = item;
        const maxAge = item.maxAge ?? 6000;
        try {
          // 保序和旧现场共用一个消费者锁；clear 只使旧代失效，由同一循环接手后来的新批。
          // Ordered and legacy speech share one consumer lock; clear invalidates old work and this same loop takes new batches.
          if (item.ordered) {
            await this.playOrdered(item, generation);
            continue;
          }
          if (this.now() - item.at > maxAge) continue;
          // 整个事件加载完再播；开始后剩余片段不会过期或被普通新事件逐段挤出，但显式清理仍可停止。
          // Load the whole event before speaking. Once started, its remaining clips
          // cannot expire or be evicted by newer events; explicit clearing can stop it.
          // 整组下载完成后才开始，播放中不按过期时间截断同一组剩余片段。
          // Load the entire group before starting; do not expire remaining clips mid-group.
          const buffers = await Promise.all(item.urls.map((url) => this.buffer(url)));
          // await 之后重新验证状态与时效，不能假定下载期间一切未变。
          // Recheck state and freshness after await; conditions may have changed while loading.
          if (
            generation !== this.generation ||
            this.muted ||
            this.now() - item.at > maxAge ||
            this.context.state !== 'running'
          )
            continue;
          for (const buffer of buffers) {
            if (
              generation !== this.generation ||
              this.muted ||
              !this.unlocked ||
              this.context.state !== 'running'
            )
              break;
            // 等待 onended 才播放下一片段；clear 调用 stop 也会结束当前音源。
            // Wait for onended before the next clip; clear also ends the current source by calling stop.
            await this.playBuffer(buffer);
          }
        } catch {
          if (generation === this.generation) this.onStatus('unavailable');
        } finally {
          // 每条退出路径都完成本批；旧批清理不得抹掉新批的状态。
          // Complete every exit path; stale batch cleanup must not erase newer state.
          item.complete?.();
          if (this.activeItem === item) this.activeItem = null;
        }
      }
      // 即使下载或播放失败，也释放串行锁，允许后续新事件继续播放。
      // Release the serial lock even after loading or playback failure so later events can proceed.
    } finally {
      this.source = null;
      this.activeItem = null;
      this.running = false;
    }
  }
  // 播放单片段，正常依赖 onended；兜底先 stop/disconnect 再完成，绝不边响边放行。
  // Play one clip using onended normally; the fallback stops/disconnects before completing, never releasing audible playback.
  playBuffer(buffer) {
    return new Promise((resolve, reject) => {
      const source = this.context.createBufferSource();
      let timer;
      let finished = false;
      const finish = (stop = false, error, status = 'success') => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        source.onended = null;
        if (stop) {
          try {
            source.stop();
          } catch {
            /* 已停止或尚未启动。 / Already stopped or not started. */
          }
        }
        // 即使 stop 抛错，也断开输出，保证取消后不会继续听到旧声音。
        // Disconnect even when stop throws, ensuring cancelled speech cannot remain audible.
        try {
          source.disconnect?.();
        } catch {
          /* 已断开。 / Already disconnected. */
        }
        if (this.source === source) this.source = null;
        if (this.cancelPlayback === cancel) this.cancelPlayback = null;
        if (error) reject(error);
        else resolve(status);
      };
      const cancel = () => finish(true, undefined, 'cancelled');
      this.source = source;
      this.cancelPlayback = cancel;
      try {
        source.buffer = buffer;
        source.connect(this.context.destination);
        source.onended = () => finish();
        // 正常时长加一秒事件宽限，最长十五秒；未知时长也必须有上限。
        // Allow duration plus one second of event grace, capped at fifteen seconds, including unknown durations.
        const duration = Number.isFinite(buffer.duration) && buffer.duration > 0
          ? buffer.duration * 1000 + 1000
          : 15000;
        // 看门狗只释放队列，不冒充自然结束；旧调用方继续忽略此返回状态。
        // A watchdog releases the queue without claiming a natural end; legacy callers ignore the status.
        timer = setTimeout(() => finish(true, undefined, 'failed'), Math.min(duration, 15000));
        source.start();
        this.onStatus('ready');
      } catch (error) {
        // 初始化失败也清理音源与计时器；外层统一把失败视为跳过。
        // Setup failures also clean up the source/timer; the caller uniformly treats failure as skipped.
        finish(true, error);
      }
    });
  }
  // 组件销毁时永久关闭此实例的上下文，并使回调不再报告锁定状态。
  // On component disposal, close this instance’s context and suppress further locked-state reports.
  dispose() {
    this.disposed = true;
    this.clear();
    this.context?.close();
    this.unlocked = false;
  }
}
