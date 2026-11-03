<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import MahjongTile from './MahjongTile.vue'
import Icon from './Icon.vue'

const STORAGE_KEY = 'huajian-mahjong-session-v1'
const name = ref('')
const roomCode = ref(new URLSearchParams(window.location.search).get('room') || '')
const entryMode = ref(roomCode.value ? 'join' : 'create')
const session = ref(null)
const state = ref(null)
const busy = ref(false)
const restoring = ref(false)
const offline = ref(false)
const syncing = ref(false)
const error = ref('')
const notice = ref('')
const showRules = ref(false)
const showInvite = ref(false)
const selectedTile = ref(null)
const selectedHandIndex = ref(null)
const copyDone = ref(false)
const modalRef = ref(null)
const inviteInput = ref(null)
let pollTimer
let noticeTimer
let copyTimer
let pollController
let epoch = 0
let previousFocus = null

const inRoom = computed(() => !!state.value && !!session.value)
const game = computed(() => state.value?.game || null)
const mySeat = computed(() => state.value?.you ?? game.value?.mySeat ?? 0)
const isLegacy = computed(() => !!game.value && (game.value.schemaVersion ?? 1) < 2)
const postHu = computed(() => !isLegacy.value && (me.value?.huCount || 0) > 0)
const huDiagnostic = computed(() => !isLegacy.value ? game.value?.huDiagnostic : null)
const phase = computed(() => state.value?.phase || 'lobby')
const seats = computed(() => [0, 1, 2].map(seat => ({
  seat, name: '', score: 0, handCount: 0, huCount: 0, melds: [], radishes: [], winPile: [],
  ...(state.value?.seats?.find(player => player?.seat === seat) || {}),
  ...(game.value?.players?.find(player => player.seat === seat) || {}),
})))
const me = computed(() => seats.value[mySeat.value])
const opponents = computed(() => [seats.value[(mySeat.value + 1) % 3], seats.value[(mySeat.value + 2) % 3]])
const filledSeats = computed(() => seats.value.filter(seat => seat.name).length)
const isHost = computed(() => mySeat.value === (state.value?.hostSeat ?? 0))
const legalActions = computed(() => game.value?.legalActions || [])
const hand = computed(() => {
  const sorted = [...(me.value?.hand || [])].sort((a, b) => a - b)
  const drawn = game.value?.drawnTile
  if (drawn != null) { const index = sorted.lastIndexOf(drawn); if (index >= 0) { sorted.splice(index, 1); sorted.push(drawn) } }
  return sorted
})
const discardOptions = computed(() => legalActions.value.filter(action => action.type === 'discard'))
const canDiscard = computed(() => discardOptions.value.some(action => action.tile === selectedTile.value))
const primaryActions = computed(() => legalActions.value.filter(action => !['discard', 'anGang', 'buGang', 'addGang'].includes(action.type) && (isLegacy.value || action.type !== 'draw')))
const gangActions = computed(() => legalActions.value.filter(action => ['anGang', 'buGang', 'addGang'].includes(action.type)))
const isMyTurn = computed(() => game.value?.currentSeat === mySeat.value && game.value?.phase === 'turn' && phase.value === 'playing')
const currentPlayer = computed(() => seats.value[game.value?.currentSeat])
const history = computed(() => [...(game.value?.history || [])].reverse())
const lastOwnScore = computed(() => game.value?.scoreBreakdown || me.value?.lastScoreBreakdown)
const canHu = computed(() => legalActions.value.some(action => action.type === 'hu'))
const freshTableUrl = computed(() => `${window.location.origin}${window.location.pathname}`)
const shareUrl = computed(() => { const url = new URL(window.location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', state.value?.id || session.value?.roomId || ''); return url.toString() })
const statusTitle = computed(() => {
  if (phase.value === 'finished') return ['allPlayersHu', 'allThreeHu', 'all_players_hu'].includes(game.value?.finishReason) ? '三家都胡了，本局结束' : '本局圆满结束'
  if (phase.value === 'lobby') return filledSeats.value === 3 ? '牌友已到齐' : '等牌友，一起开局'
  if (game.value?.phase === 'claim') return legalActions.value.length ? '这张牌，等你回应' : '等待牌友回应'
  if (isMyTurn.value && postHu.value) return canHu.value ? '这张可以胡，请你决定' : '手牌已固定，选择杠或过'
  if (isMyTurn.value) return game.value?.turnStep === 'draw' ? (isLegacy.value ? '轮到你摸牌' : '正在自动摸牌') : '牌已摸好，选一张出手'
  return `等待${currentPlayer.value?.name || '牌友'}${game.value?.turnStep === 'draw' ? '摸牌' : '出牌'}`
})
const statusDetail = computed(() => {
  if (syncing.value) return '正在确认刚才的操作结果，请稍等。'
  if (offline.value) return '连接暂时中断，正在尝试重新连接'
  if (phase.value === 'finished') return finishText.value
  if (game.value?.phase === 'claim') return legalActions.value.length ? (canHu.value ? '这张可以胡。胡牌优先于碰、杠。' : '请选择可用操作；胡牌优先，明杠其次，再到碰。') : '所有需要回应的牌友选择后，继续下一轮。'
  if (phase.value === 'lobby') return filledSeats.value === 3 ? (isHost.value ? '你是房主，随时可以开始。' : '请等待房主开始牌局。') : `还差 ${3 - filledSeats.value} 位牌友，把邀请链接发给他们吧。`
  if (isMyTurn.value && game.value?.turnStep === 'draw') return isLegacy.value ? '本桌沿用旧规则，点击“摸一张”继续。' : '自动发牌，无需点击摸牌。'
  if (isMyTurn.value && postHu.value) return canHu.value ? '原手牌不能换打；不胡就打出刚摸到的这一张。' : '原手牌不能换打；点“过”打出新牌。'
  if (isMyTurn.value) return '先点击手牌，再点击“打出”。'
  return '看看牌河，下一手慢慢想。'
})
const finishText = computed(() => ({ allPlayersHu: '三家均已胡牌，本局结束，积分已结算。', allThreeHu: '三家均已胡牌，本局结束，积分已结算。', all_players_hu: '三家均已胡牌，本局结束，积分已结算。', wallExhausted: '牌墙已空，积分已结算。可以相约再来一桌。', wall_exhausted: '牌墙已空，积分已结算。可以相约再来一桌。' })[game.value?.finishReason] || '积分已结算，可以相约再来一桌。')
const statusLabel = computed(() => phase.value === 'lobby' ? '等待开局' : phase.value === 'finished' ? '本局结束' : '正在牌局中')

function selectHand(tile, index) { if (selectedHandIndex.value === index) { selectedTile.value = null; selectedHandIndex.value = null } else { selectedTile.value = tile; selectedHandIndex.value = index } }
function tileLabel(tile) { return tile == null ? '暗牌' : `${tile % 9 + 1}${tile < 9 ? '条' : '筒'}` }
function seatLabel(seat) { return seats.value[seat]?.name || `牌友 ${seat + 1}` }
function initials(player) { return [...(player?.name || '待')][0] }
function scoreLabel(score) { return score > 0 ? `+${score}` : `${score || 0}` }
function discardsFor(seat) { return game.value?.discards?.filter(discard => discard.seat === seat) || [] }
function actionLabel(action) {
  return ({ draw: '摸一张', hu: '胡牌', pass: postHu.value && isMyTurn.value ? '不胡 / 过 · 打出新牌' : '过', peng: '碰', mingGang: '明杠', anGang: `暗杠 · ${tileLabel(action.tile)}`, buGang: `补杠 · ${tileLabel(action.tile)}`, addGang: `加第 5 张 · ${tileLabel(action.tile)}` })[action.type] || action.type
}
function meldLabel(meld) { const base = ({ peng: '碰', mingGang: '明杠', anGang: '暗杠', buGang: '补杠', addGang: '加杠' })[meld.type] || '副露'; return `${base}${meld.tiles?.length === 5 ? ' · 5 张' : ''}` }
function winLabel(win) { return `${tileLabel(win.tile)} · ${win.source === 'selfDraw' ? '自摸' : win.source === 'kongDiscard' ? '杠后接胡' : '接炮'}${win.virtual ? ' · 共胡记牌，不另算实物牌' : ''}` }
function scoreSummary(score) {
  if (!score) return ''
  if (score.fan == null) return `基础 ${score.base} + 萝卜 ${score.radishBonus} + 神龙 ${score.dragonBonus} = ${score.total} 分 / 家`
  if (score.bigSingle && score.overlapPolicy === 'exclusive') return `大单钓：另外两家各付 ${score.total} 分（不叠加番分、萝卜、神龙）`
  return `${score.fan} 番 ${score.fanPoints} 分 + 萝卜 ${score.radishBonus} + 神龙 ${score.dragonBonus}${score.bigSingle ? ` + 大单钓 ${score.bigSinglePoints}` : ''} = ${score.total} 分 / 付款方`
}
function latestRadishes(seat) { return history.value.find(entry => entry.seat === seat && (entry.newRadishes?.length || entry.radish != null)) }
function radishIncrement(seat) { const entry = latestRadishes(seat); return entry ? (entry.newRadishes?.length || (entry.radish != null ? 1 : 0)) : 0 }
function radishIncrementLabel(seat) { const entry = latestRadishes(seat); return entry ? `${entry.type === 'hu' ? '首胡' : '上次杠'} +${radishIncrement(seat)}` : '' }
function paymentSummary(entry) { return entry.payments?.filter(payment => payment.delta < 0).map(payment => `${seatLabel(payment.seat)}付${-payment.delta}分`).join(' · ') || '' }
function isTurn(player) { return game.value?.currentSeat === player.seat && phase.value === 'playing' && game.value?.phase !== 'claim' }
function flash(text) { notice.value = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = '' }, 4200) }
function saveSession(value) {
  session.value = value
  try { if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); else sessionStorage.removeItem(STORAGE_KEY) } catch { flash('浏览器未允许保存会话，请保持此页面打开。') }
}
function applyState(next) {
  if (!next) return
  if (state.value && next.id === state.value.id && next.revision < state.value.revision) return
  state.value = next
  if (!discardOptions.value.some(action => action.tile === selectedTile.value)) { selectedTile.value = null; selectedHandIndex.value = null }
}
async function api(path, options = {}) {
  const controller = options.controller || new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(path, { method: options.method || 'GET', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(session.value?.token ? { Authorization: `Bearer ${session.value.token}` } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { const failure = new Error(data.error || '这次操作没有完成，请稍后再试。'); failure.status = response.status; failure.code = data.code; throw failure }
    return data
  } finally { clearTimeout(timer) }
}
function pollInterval() { return document.hidden ? 3000 : phase.value === 'playing' ? 350 : 1000 }
function schedulePoll(started = performance.now(), immediate = false) {
  clearTimeout(pollTimer)
  if (session.value) pollTimer = setTimeout(refresh, immediate ? 0 : Math.max(80, pollInterval() - (performance.now() - started)))
}
async function refresh() {
  if (!session.value) return
  if (pollController || busy.value) { schedulePoll(); return }
  clearTimeout(pollTimer)
  const started = performance.now()
  const currentEpoch = epoch
  const roomId = session.value.roomId
  const controller = new AbortController()
  pollController = controller
  try {
    const since = state.value?.id === roomId ? `?since=${encodeURIComponent(state.value.revision)}` : ''
    const data = await api(`/api/rooms/${encodeURIComponent(roomId)}${since}`, { controller })
    if (currentEpoch !== epoch) return
    if (data.unchanged && state.value) {
      if (Array.isArray(data.connections)) state.value.seats?.forEach(player => {
        if (!player) return
        const connected = data.connections[player.seat]
        if (typeof connected === 'boolean' && player.connected !== connected) player.connected = connected
      })
    } else applyState(data.state)
    if (offline.value) flash('已重新连接，牌局已同步。')
    offline.value = false
    syncing.value = false
    restoring.value = false
    if (error.value.startsWith('暂时无法连接')) error.value = ''
    else if (error.value.startsWith('牌局刚刚有更新')) error.value = '牌局已同步，请重新选择操作。'
    else if (error.value.startsWith('连接中断，操作结果')) error.value = '牌局已同步，请查看最新牌面后继续。'
  } catch (failure) {
    if (currentEpoch !== epoch) return
    if ([401, 403, 404, 410].includes(failure.status)) {
      error.value = [404, 410].includes(failure.status) ? '这个房间已过期或不存在。可以重新开桌，或输入新的房间号。' : '此座位的会话已失效，请重新加入房间。'
      epoch++
      state.value = null
      syncing.value = false
      saveSession(null)
    } else {
      offline.value = true
      if (!state.value) error.value = '暂时无法连接牌桌，正在自动重试。'
    }
    restoring.value = false
  } finally {
    if (pollController === controller) pollController = null
    if (currentEpoch === epoch) schedulePoll(started)
  }
}
function visibilityChanged() { if (!pollController && !busy.value) schedulePoll(performance.now(), !document.hidden) }
async function enterRoom() {
  if (busy.value) return
  const cleanName = name.value.trim()
  const code = roomCode.value.trim().toUpperCase()
  if (!cleanName) { error.value = '先给自己取个落座名吧。'; return }
  if (entryMode.value === 'join' && !code) { error.value = '请输入朋友发来的房间号。'; return }
  busy.value = true; error.value = ''; offline.value = false
  epoch++; clearTimeout(pollTimer); pollController?.abort(); pollController = null
  try {
    const path = entryMode.value === 'create' ? '/api/rooms' : `/api/rooms/${encodeURIComponent(code)}/join`
    const data = await api(path, { method: 'POST', body: { name: cleanName } })
    saveSession({ roomId: data.roomId, token: data.token, name: cleanName })
    state.value = data.state
    selectedTile.value = null
    const url = new URL(window.location.href); url.searchParams.set('room', data.roomId); window.history.replaceState({}, '', url)
    flash(entryMode.value === 'create' ? '牌桌已准备好，邀请两位朋友来坐。' : '落座成功，欢迎来到牌桌。')
  } catch (failure) { error.value = failure.name === 'AbortError' ? '连接超时，请稍后再试。' : failure.message }
  finally { busy.value = false; schedulePoll() }
}
async function mutate(action, start = false) {
  if (busy.value || offline.value || syncing.value || !state.value) return
  busy.value = true; error.value = ''
  clearTimeout(pollTimer)
  epoch++; pollController?.abort(); pollController = null
  let needsSync = false
  try {
    const data = await api(`/api/rooms/${encodeURIComponent(session.value.roomId)}/${start ? 'start' : 'action'}`, { method: 'POST', body: { revision: state.value.revision, ...(start ? {} : { action }) } })
    applyState(data.state)
    selectedTile.value = null
    selectedHandIndex.value = null
  } catch (failure) {
    if (failure.status === 409) { error.value = '牌局刚刚有更新，正在同步。请稍后重新选择。'; needsSync = true }
    else if (!failure.status) { offline.value = true; error.value = '连接中断，操作结果需要同步确认。请稍等片刻。'; needsSync = true }
    else error.value = failure.message
  } finally {
    syncing.value = needsSync
    busy.value = false
    if (needsSync) await refresh()
    else schedulePoll()
  }
}
async function copyInvite() {
  try { await navigator.clipboard.writeText(shareUrl.value); copyDone.value = true; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copyDone.value = false }, 2500) }
  catch { showInvite.value = true; await nextTick(); inviteInput.value?.focus(); inviteInput.value?.select() }
}
function newTable() {
  epoch++; clearTimeout(pollTimer); pollController?.abort(); pollController = null
  saveSession(null); state.value = null; roomCode.value = ''; entryMode.value = 'create'; offline.value = false; syncing.value = false; error.value = ''
  const url = new URL(window.location.href); url.search = ''; window.history.replaceState({}, '', url)
}
function onKey(event) {
  if (event.key === 'Escape') { showRules.value = false; showInvite.value = false }
  if (event.key === 'Tab' && (showRules.value || showInvite.value)) {
    const elements = modalRef.value?.querySelectorAll('button, input, [tabindex="0"]')
    if (!elements?.length) return
    const first = elements[0], last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
}
watch(() => showRules.value || showInvite.value, async (open) => {
  if (open) { previousFocus = document.activeElement; document.body.style.overflow = 'hidden'; await nextTick(); modalRef.value?.querySelector('button')?.focus() }
  else { document.body.style.overflow = ''; previousFocus?.focus?.() }
})
onMounted(() => {
  document.addEventListener('keydown', onKey)
  window.addEventListener('online', refresh)
  document.addEventListener('visibilitychange', visibilityChanged)
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.roomId && saved?.token && (!roomCode.value || saved.roomId.toUpperCase() === roomCode.value.toUpperCase())) { session.value = saved; name.value = saved.name || ''; restoring.value = true; refresh() }
    else if (saved?.name) name.value = saved.name
  } catch { sessionStorage.removeItem(STORAGE_KEY) }
})
onUnmounted(() => { epoch++; clearTimeout(pollTimer); clearTimeout(noticeTimer); clearTimeout(copyTimer); pollController?.abort(); document.removeEventListener('keydown', onKey); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', visibilityChanged); document.body.style.overflow = '' })
</script>

<template>
  <div class="app-shell" :class="{ 'in-game': inRoom && phase !== 'lobby', 'in-room': inRoom }">
    <header class="site-header">
      <div class="brand" aria-label="花间，自贡花麻将">
        <svg class="brand-mark" viewBox="0 0 42 42" aria-hidden="true"><path d="M21 5c8-1 7 10 7 10s11-1 10 7-10 6-10 6 1 11-7 10-6-10-6-10-11 1-10-7 10-6 10-6-1-11 6-10Z"/><circle cx="21.5" cy="21.5" r="3.5"/></svg>
        <div class="brand-name">花间 <span>自贡花麻将</span></div>
      </div>
      <div class="header-actions">
        <span class="prototype-pill"><span></span> 朋友内测版</span>
        <button class="text-button rules-trigger" @click="showRules = true"><Icon name="book" :size="17"/><span>玩法说明</span></button>
      </div>
    </header>

    <div v-if="notice" class="toast" role="status"><Icon name="check" :size="17"/>{{ notice }}</div>

    <main v-if="!inRoom" class="welcome-layout">
      <section class="welcome-story">
        <p class="eyebrow"><span></span> 三人一桌 · 自贡味道</p>
        <h1>花开一桌，<br/>好牌<span class="gold-text">慢慢来。</span></h1>
        <p class="welcome-description">只有条筒，也有花样。<br/>叫上两位牌友，把熟悉的热闹搬到线上。</p>
        <div class="hero-illustration" aria-label="三张条筒麻将牌的装饰插图" role="img">
          <div class="illustration-ring ring-one"></div><div class="illustration-ring ring-two"></div>
          <span class="art-flower flower-one">✦</span><span class="art-flower flower-two">✧</span>
          <div class="hero-tile hero-tile-left"><MahjongTile :tile="11"/></div>
          <div class="hero-tile hero-tile-center"><MahjongTile :tile="0"/></div>
          <div class="hero-tile hero-tile-right"><MahjongTile :tile="13"/></div>
          <div class="illustration-caption"><span></span> 条筒之间，自有乐趣 <span></span></div>
        </div>
        <div class="welcome-features"><span><Icon name="users" :size="17"/>三人实时同桌</span><span><Icon name="soundoff" :size="17"/>全程安静，无音效</span><span><Icon name="shield" :size="17"/>仅虚拟积分</span></div>
      </section>

      <section class="entry-card" aria-labelledby="entry-title">
        <div class="card-topline"><span class="small-flower">✳</span><span>留一个位置，给好朋友</span></div>
        <h2 id="entry-title">{{ entryMode === 'create' ? '先坐下来吧' : '朋友在等你' }}</h2>
        <p class="card-description">{{ entryMode === 'create' ? '新开一桌，邀请两位朋友一起玩。' : '输入房间号，就能找到熟悉的牌桌。' }}</p>
        <div class="entry-tabs" role="tablist" aria-label="进入牌桌方式">
          <button role="tab" :aria-selected="entryMode === 'create'" :class="{ active: entryMode === 'create' }" :disabled="busy || restoring" @click="entryMode = 'create'; error = ''"><Icon name="plus" :size="17"/>创建牌桌</button>
          <button role="tab" :aria-selected="entryMode === 'join'" :class="{ active: entryMode === 'join' }" :disabled="busy || restoring" @click="entryMode = 'join'; error = ''"><Icon name="users" :size="17"/>加入牌桌</button>
        </div>
        <form @submit.prevent="enterRoom">
          <label class="field-label" for="player-name">你的落座名 <span>让朋友一眼认出你</span></label>
          <input id="player-name" v-model="name" maxlength="16" autocomplete="nickname" placeholder="比如：自贡小雀神" :disabled="busy || restoring" required />
          <template v-if="entryMode === 'join'">
            <label class="field-label room-code-label" for="room-code">房间号</label>
            <input id="room-code" v-model="roomCode" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" class="room-code-input" placeholder="输入朋友分享的房间号" :disabled="busy || restoring" required />
          </template>
          <div v-if="error" class="inline-error" role="alert"><Icon name="info" :size="17"/><span>{{ error }}</span></div>
          <button class="button primary entry-submit" type="submit" :disabled="busy || restoring"><span v-if="busy || restoring" class="spinner"></span><template v-else><span>{{ entryMode === 'create' ? '创建一张牌桌' : '加入这张牌桌' }}</span><Icon name="arrow" :size="20"/></template><span v-if="busy || restoring">{{ restoring ? '正在回到牌桌…' : '正在为你落座…' }}</span></button>
        </form>
        <div class="entry-note"><Icon name="info" :size="16"/><p>三人到齐，由房主开始。每位牌友使用自己的浏览器加入，不设机器人。</p></div>
        <div class="card-bottom"><span>条筒双副</span><i>·</i><span>三家胡完收桌</span><i>·</i><span>萝卜加分</span></div>
      </section>
      <footer class="welcome-footer"><span>一桌好朋友，一局好时光。</span><span>规则原型 · 不含充值、支付或现金输赢</span></footer>
    </main>

    <main v-else class="room-layout">
      <div class="room-heading">
        <div class="room-title"><span class="eyebrow">{{ phase === 'lobby' ? '牌桌准备中' : '三人花麻将' }}</span><h1>{{ phase === 'lobby' ? '朋友来齐，就开桌。' : phase === 'finished' ? '好牌好聚，下桌再续。' : '此刻，正好一桌。' }}</h1></div>
        <div class="room-tools"><div class="room-code-badge"><span>房间号</span><strong>{{ state.id }}</strong></div><button class="button invite-button" @click="copyInvite"><Icon :name="copyDone ? 'check' : 'copy'" :size="16"/><span>{{ copyDone ? '已复制' : '复制邀请' }}</span></button></div>
      </div>
      <div v-if="isLegacy" class="legacy-banner"><Icon name="info" :size="15"/><span>本桌已开局，继续使用旧规则。新版自动摸牌等改动从新桌生效。</span><a :href="freshTableUrl" target="_blank" rel="noopener">另开新桌体验新版<Icon name="arrow" :size="13"/></a></div>
      <div v-if="offline" class="connection-banner" role="status"><span class="spinner"></span><span>连接暂时中断，正在自动重连。牌局同步前暂不能操作。</span><button @click="refresh">立即重连</button></div>
      <div v-if="error" class="room-error" role="alert"><Icon name="info" :size="17"/><span>{{ error }}</span><button class="icon-button" aria-label="关闭提示" @click="error = ''"><Icon name="close" :size="16"/></button></div>

      <div class="play-layout">
        <section class="table-column" aria-label="三人麻将牌桌">
          <div class="table-surface" :class="{ 'lobby-table': phase === 'lobby' }">
            <div class="table-topline"><span><i :class="{ disconnected: offline }"></i>{{ offline ? '重新连接中' : '实时牌桌' }}</span><span>{{ filledSeats }}/3 位落座 <span class="table-top-divider">·</span> {{ statusLabel }}</span></div>
            <div class="opponent-row">
              <div v-for="player in opponents" :key="player.seat" class="opponent-seat" :class="{ 'seat-current': isTurn(player), 'seat-empty': !player.name }">
                <div class="player-topline"><div class="avatar" :class="`avatar-${player.seat}`"><span v-if="player.name">{{ initials(player) }}</span><Icon v-else name="plus" :size="20"/></div><div class="player-identity"><div class="player-name">{{ player.name || '虚位以待' }}<span v-if="player.name && player.seat === state.hostSeat" class="host-tag">房主</span><span v-if="player.name && player.connected === false" class="connection-tag">离线</span></div><span class="player-caption">{{ !player.name ? '等待朋友加入' : phase === 'lobby' ? '已落座，等开局' : `${player.handCount} 张手牌 · 已胡 ${player.huCount} 次` }}</span></div><span v-if="game" class="player-score" :class="{ negative: player.score < 0 }">{{ scoreLabel(player.score) }}</span><span v-else-if="player.name" class="ready-dot"><Icon name="check" :size="14"/></span></div>
                <div v-if="game" class="opponent-hand" :aria-label="`${player.name}的手牌，共${player.handCount}张，仅显示背面`"><MahjongTile v-for="n in Math.min(player.handCount, 20)" :key="n" back small/></div>
                <div v-else class="lobby-seat-decoration"><span v-if="player.name">已经准备好，把好牌留给你。</span><span v-else>发一个邀请，留一份热闹。</span></div>
                <div v-if="game && player.melds.length" class="meld-list opponent-melds"><div v-for="(meld, mi) in player.melds" :key="mi" class="meld"><div class="meld-tiles"><MahjongTile v-for="(tile, ti) in meld.tiles" :key="ti" :tile="tile" :back="tile == null" small/></div><small>{{ meldLabel(meld) }}</small></div></div>
                <div v-if="game && !isLegacy" class="win-pile" :aria-label="`${player.name}的胡牌区`">
                  <span class="public-zone-label">胡牌区 <b>{{ player.winPile.length }} 次</b></span>
                  <div class="win-pile-tiles"><span v-for="(win, wi) in player.winPile" :key="wi" class="win-pile-tile" :class="{ 'virtual-win': win.virtual }" :title="winLabel(win)"><MahjongTile :tile="win.tile" small/><span v-if="win.virtual" class="virtual-badge" aria-label="共胡记牌，不另算实物牌">共胡</span></span><span v-if="!player.winPile.length" class="public-zone-empty">还未胡牌</span></div>
                </div>
                <div v-if="game && player.radishes.length" class="radish-row"><span class="radish-label">萝卜 <b>共 {{ player.radishes.length }} 张</b><small v-if="!isLegacy && radishIncrement(player.seat)" class="radish-increment">{{ radishIncrementLabel(player.seat) }}</small></span><div class="radish-tiles"><MahjongTile v-for="(tile, ti) in player.radishes" :key="ti" :tile="tile" small/></div></div>
              </div>
            </div>

            <div v-if="phase === 'lobby'" class="lobby-center">
              <div class="table-emblem"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6c9-1 8 11 8 11s12-1 11 8-11 7-11 7 1 12-8 11-7-11-7-11S5 33 6 24s11-7 11-7S16 5 24 6Z"/><circle cx="24.5" cy="24.5" r="4"/></svg></div>
              <h2>{{ statusTitle }}</h2><p>{{ statusDetail }}</p>
              <button v-if="isHost" class="button gold start-button" :disabled="filledSeats < 3 || busy || offline || syncing" @click="mutate(null, true)"><span v-if="busy" class="spinner"></span><Icon v-else name="sparkle" :size="18"/>{{ filledSeats < 3 ? `等待另外 ${3 - filledSeats} 位牌友` : '人齐了，开始牌局' }}</button>
              <div v-else class="waiting-host"><span class="pulse-dot"></span>等待房主开始</div>
              <button v-if="filledSeats < 3" class="table-link" @click="copyInvite"><Icon :name="copyDone ? 'check' : 'link'" :size="15"/>{{ copyDone ? '邀请链接已复制' : '复制链接，邀请朋友' }}</button>
            </div>
            <div v-else class="playing-center">
              <div class="game-status" aria-live="polite"><div><span class="turn-indicator" :class="{ 'your-turn': isMyTurn || legalActions.length }"></span><strong>{{ statusTitle }}</strong></div><div class="wall-counter"><span>余牌</span><b>{{ game.wallCount }}</b><span>张</span></div></div>
              <div v-if="game.phase === 'claim' && game.claim" class="claim-strip"><MahjongTile :tile="game.claim.tile" small/><span><b>{{ seatLabel(game.claim.discardSeat) }}</b> 打出了 {{ tileLabel(game.claim.tile) }}</span></div>
              <div class="discard-area"><div v-for="player in seats" :key="player.seat" class="discard-group"><div class="discard-label"><span>{{ player.seat === mySeat ? '我的牌河' : `${player.name}的牌河` }}</span><small>{{ discardsFor(player.seat).length }} 条记录</small></div><div class="discard-tiles"><template v-if="discardsFor(player.seat).length"><span v-for="(discard, di) in discardsFor(player.seat)" :key="di" class="discard-tile" :class="{ 'latest-discard': discard === game.discards[game.discards.length - 1], 'claimed-discard': discard.huSeats?.length, 'taken-discard': discard.claimedBy != null || discard.huSeats?.length }"><MahjongTile :tile="discard.tile" small/><span v-if="discard.huSeats?.length" class="hu-mark" title="胡牌记录，和胡牌区对应同一张实体牌">胡</span><span v-else-if="discard.claimedBy != null" class="hu-mark" title="已移入碰杠区，牌河仅保留记录">{{ discard.claimedAs === 'peng' ? '碰' : '杠' }}</span></span></template><span v-else class="empty-discard">尚未出牌</span></div></div></div>
              <div v-if="phase === 'finished'" class="finished-banner"><Icon name="trophy" :size="21"/><span>{{ finishText }}</span><button v-if="isHost" class="button gold" :disabled="busy || offline || syncing" @click="mutate(null, true)">同桌再来一局<Icon name="arrow" :size="16"/></button><span v-else>等待房主再开一局</span><button class="button" :disabled="busy || syncing" @click="newTable">换一张新桌</button></div>
              <div v-else class="table-watermark">花间 <span>自贡花麻将</span></div>
            </div>

            <div class="own-seat-summary"><div class="avatar" :class="`avatar-${mySeat}`">{{ initials(me) }}</div><div class="player-identity"><div class="player-name">{{ me.name }}<span class="you-tag">我</span><span v-if="isHost" class="host-tag">房主</span></div><span class="player-caption">{{ phase === 'lobby' ? '你的专属位置已留好' : `已胡 ${me.huCount} 次 · ${me.handCount} 张手牌` }}</span></div><span class="own-seat-status" v-if="phase === 'lobby'"><Icon name="check" :size="16"/>已落座</span><span v-else class="player-score own-score" :class="{ negative: me.score < 0 }">{{ scoreLabel(me.score) }}<small>分</small></span></div>
          </div>

          <section v-if="game" class="hand-panel" aria-label="我的手牌与操作">
            <div class="hand-info-row"><div><span class="section-kicker">手牌区</span><span v-if="postHu" class="frozen-hand-pill">胡后固定</span><span v-if="isMyTurn" class="my-turn-pill">轮到你了</span></div><span class="hand-hint">{{ statusDetail }}</span></div>
            <div v-if="!isLegacy || me.melds.length || me.radishes.length" class="own-public-cards">
              <div v-if="!isLegacy" class="own-win-pile win-pile" aria-label="我的胡牌区"><span class="public-zone-label">胡牌区 <b>{{ me.winPile.length }} 次</b></span><div class="win-pile-tiles"><span v-for="(win, wi) in me.winPile" :key="wi" class="win-pile-tile" :class="{ 'virtual-win': win.virtual }" :title="winLabel(win)"><MahjongTile :tile="win.tile" small/><span v-if="win.virtual" class="virtual-badge" aria-label="共胡记牌，不另算实物牌">共胡</span></span><span v-if="!me.winPile.length" class="public-zone-empty">胡牌后放在这里</span></div></div>
              <div class="own-meld-zone"><span v-if="!isLegacy" class="public-zone-label">碰杠区</span><span v-if="!isLegacy && !me.melds.length" class="public-zone-empty">还未碰杠</span><div v-if="me.melds.length" class="meld-list"><div v-for="(meld, mi) in me.melds" :key="mi" class="meld"><div class="meld-tiles"><MahjongTile v-for="(tile, ti) in meld.tiles" :key="ti" :tile="tile" :back="tile == null" small/></div><small>{{ meldLabel(meld) }}</small></div></div></div><div v-if="me.radishes.length" class="radish-row"><span class="radish-label">我的萝卜 <b>共 {{ me.radishes.length }} 张</b><small v-if="!isLegacy && radishIncrement(mySeat)" class="radish-increment">{{ radishIncrementLabel(mySeat) }}</small></span><div class="radish-tiles"><MahjongTile v-for="(tile, ti) in me.radishes" :key="ti" :tile="tile" small/></div></div></div>
            <div class="hand-scroll"><div class="my-hand"><MahjongTile v-for="(tile, ti) in hand" :key="`${ti}-${tile}`" :tile="tile" interactive :selected="selectedHandIndex === ti && selectedTile === tile" :class="{ 'drawn-tile': game.drawnTile != null && ti === hand.length - 1 }" :disabled="postHu || busy || offline || syncing || !discardOptions.some(action => action.tile === tile)" @click="selectHand(tile, ti)"/></div></div>
            <div class="hand-bottom-row"><div class="waits-info"><template v-if="game.waitTiles?.length"><span class="wait-label">听牌</span><span>{{ game.waitTiles.map(tileLabel).join('、') }}</span></template><span v-else class="muted-hand-caption">条筒之间，下一张也许正好。</span><span v-if="me.huLockActive || game.huLockActive" class="locked-waits" :title="`原听口：${(game.lockedWaits || []).map(tileLabel).join('、')}`">本轮再胡需换尽原听口</span></div><div class="action-row"><button v-for="(action, ai) in gangActions" :key="`gang-${ai}`" class="button action-button secondary" :disabled="busy || offline || syncing" @click="mutate(action)">{{ actionLabel(action) }}</button><button v-for="(action, ai) in primaryActions" :key="`${action.type}-${ai}`" class="button action-button" :class="{ 'hu-button': action.type === 'hu', primary: ['draw', 'peng', 'mingGang'].includes(action.type), secondary: action.type === 'pass' }" :disabled="busy || offline || syncing" @click="mutate(action)"><Icon v-if="action.type === 'draw'" name="plus" :size="17"/><Icon v-if="action.type === 'hu'" name="sparkle" :size="17"/>{{ actionLabel(action) }}</button><button v-if="discardOptions.length && !postHu" class="button action-button primary discard-button" :disabled="!canDiscard || busy || offline || syncing" @click="mutate({ type: 'discard', tile: selectedTile })">{{ canDiscard ? `打出 ${tileLabel(selectedTile)}` : '选牌后打出' }}<Icon name="arrow" :size="17"/></button><span v-if="busy" class="action-working"><span class="spinner"></span>同步中</span><span v-else-if="!legalActions.length && phase !== 'finished'" class="waiting-action"><Icon name="clock" :size="15"/>等待牌友</span></div></div>
            <details v-if="huDiagnostic" class="hu-diagnostic"><summary><Icon name="info" :size="13"/>{{ huDiagnostic.canHu ? '当前可以胡牌' : '查看当前胡牌判断' }}<span>仅自己可见</span></summary><p>{{ huDiagnostic.message }}</p><small v-if="huDiagnostic.tile != null">判断牌：{{ tileLabel(huDiagnostic.tile) }}<template v-if="huDiagnostic.waitTiles?.length"> · 当前听口：{{ huDiagnostic.waitTiles.map(tileLabel).join('、') }}</template></small></details>
            <div v-if="!isLegacy && lastOwnScore" class="own-score-detail"><span>上次胡牌结算</span><strong>{{ scoreSummary(lastOwnScore) }}</strong><small v-if="lastOwnScore.copyFanBonus">其中三牌区同牌加 {{ lastOwnScore.copyFanBonus }} 番</small></div>
          </section>
          <p class="table-footnote"><Icon name="shield" :size="13"/>只与朋友切磋牌技，所有得分均为虚拟积分。<button @click="showRules = true">查看原型规则</button></p>
        </section>

        <aside class="room-sidebar">
          <section v-if="phase === 'lobby'" class="sidebar-card invite-card"><div class="sidebar-title"><span class="sidebar-icon"><Icon name="users" :size="19"/></span><h2>好朋友，坐一桌</h2></div><p>把链接发给两位朋友，<br/>他们输入名字就能落座。</p><div class="invite-code"><span>本桌房间号</span><strong>{{ state.id }}</strong></div><button class="button primary" @click="copyInvite"><Icon :name="copyDone ? 'check' : 'copy'" :size="16"/>{{ copyDone ? '邀请链接已复制' : '复制邀请链接' }}</button><span class="quiet-note">每位朋友使用独立浏览器或标签页</span></section>
          <section v-else class="sidebar-card score-card"><div class="sidebar-title"><Icon name="trophy" :size="18"/><h2>本桌积分</h2><span class="subtle-label">虚拟分</span></div><div class="score-list"><div v-for="player in seats" :key="player.seat" class="score-line" :class="{ 'score-line-me': player.seat === mySeat }"><span class="score-avatar" :class="`avatar-${player.seat}`">{{ initials(player) }}</span><span>{{ player.name }}<small v-if="player.seat === mySeat">我</small></span><strong :class="{ 'positive-score': player.score > 0, 'negative-score': player.score < 0 }">{{ scoreLabel(player.score) }}</strong></div></div><div class="score-footnote">每次结算自动同步 · 分数总和为 0</div></section>
          <section v-if="game" class="sidebar-card history-card"><div class="sidebar-title"><Icon name="clock" :size="18"/><h2>牌局动态</h2><span class="live-dot"></span></div><ol class="history-list" aria-label="牌局操作记录"><li v-for="(entry, hi) in history" :key="`${entry.revision}-${hi}`" :class="{ 'history-hu': entry.type === 'hu' }"><span class="history-dot"></span><div><span v-if="entry.type === 'hu'" class="history-badge">好牌 · 胡了</span><p>{{ entry.message }}</p><small v-if="entry.type === 'hu' && entry.score">{{ scoreSummary(entry.score) }}</small><small v-if="entry.payments?.length && entry.type !== 'hu'" class="kong-payment">即时杠分：{{ paymentSummary(entry) }}</small><small v-if="entry.newRadishes?.length" class="history-radishes">本次新增 {{ entry.newRadishes.length }} 张萝卜</small><small v-else-if="entry.radish != null" class="history-radishes">本次新增 1 张萝卜 · {{ tileLabel(entry.radish) }}</small></div></li><li v-if="!history.length" class="history-empty">牌局的第一笔，等你来写。</li></ol></section>
          <section class="sidebar-card rules-card"><div class="sidebar-title"><Icon name="book" :size="18"/><h2>自贡的花样</h2><span class="version-tag">原型</span></div><div class="rule-snippets"><div><span class="rule-number">01</span><div><strong>条筒双副，三人同桌</strong><p>没有万字，每种条筒各八张。</p></div></div><div><span class="rule-number">02</span><div><strong>{{ isLegacy ? '胡不离桌，好牌继续' : '自动摸牌，胡后固定' }}</strong><p>{{ isLegacy ? '本桌沿用开局时的旧规则。' : '胡后不换手牌，三家都胡即结束。' }}</p></div></div><div><span class="rule-number">03</span><div><strong>翻个萝卜，添点花样</strong><p>每杠立即翻一张，首胡另加六张。</p></div></div></div><button class="rules-more" @click="showRules = true">完整玩法与待核对规则<Icon name="arrow" :size="16"/></button></section>
        </aside>
      </div>
    </main>

    <div v-if="showRules || showInvite" class="modal-backdrop" @click.self="showRules = false; showInvite = false">
      <section ref="modalRef" class="modal" role="dialog" aria-modal="true" :aria-labelledby="showRules ? 'rules-title' : 'invite-title'">
        <button class="icon-button modal-close" aria-label="关闭弹窗" @click="showRules = false; showInvite = false"><Icon name="close" :size="21"/></button>
        <template v-if="showRules"><span class="eyebrow">先玩一局，再把细节磨好</span><h2 id="rules-title">自贡花麻将 · 玩法说明</h2><div class="rules-provisional"><Icon name="info" :size="19"/><p>{{ isLegacy ? '本桌保留开局时的旧规则，原局不会因更新被改写。' : '已按这桌的反馈调整。以下标明的特殊计分仍待核对，不代表自贡各地统一打法。' }}</p></div><div v-if="isLegacy" class="rules-modal-body"><section class="legacy-rule-note"><h3>本桌旧规则</h3><p>这张桌已按旧规则开局，仍需手动摸牌，且不套用新版胡后固定与三家胡完结束。另开新桌即可使用新版。</p></section><section><h3><span>一</span>一张桌，三位牌友</h3><p>只用 1–9 条、1–9 筒，每种牌八张，共 144 张。三人落座后由房主开局。自己的手牌只有自己可见；牌河、萝卜、已亮副露和积分公开。</p></section><section><h3><span>二</span>胡了不停，继续下一手</h3><p>首次胡牌可自摸或接炮。胡过后不离桌，胡牌后由自己继续摸牌。当前这轮的连续摸牌与杠后补牌，若仍有原听口未变，不能再次胡牌；原听口全部改变可以提前再胡。轮转一圈后，下次正常摸牌会解除这个限制。</p><p>已经胡过的玩家，打出的普通弃牌不能被别人胡；但他杠后打出的那一张牌，其他人可以胡，按自摸方式结算。</p></section><section><h3><span>三</span>萝卜与神龙</h3><p>第一次胡牌翻六张萝卜，明杠、暗杠与补杠各从牌墙尾部再翻一张。萝卜与手牌同牌加分；例如手里两张二筒，萝卜也有两张二筒，加四分。</p><p>手牌连同萝卜，同一种牌有六张为神龙，加 10 分；七张加 20 分；八张及以上当前按 40 分计算。</p></section><section class="pending-rules"><h3><span>!</span>当前原型的暂定处理</h3><p>基础胡牌 1 分；自摸由另外两家分别支付，普通接炮由放炮者支付。基础胡型采用四组顺子或刻子加一对，也支持七对。神龙计入已亮副露，同牌最多按 40 分计算。具体细节以牌局服务端校验为准，下一轮一起核对。</p><p>没有倒计时、自动托管或机器人。刷新页面会恢复当前标签页的座位；房间连续七天没有操作后会过期。关闭当前标签页会丢失该标签页的座位凭证，请保留页面直至牌局结束。</p></section></div><div v-else class="rules-modal-body">
          <section><h3><span>一</span>自动摸牌，胡后固定手牌</h3><p>三人，只用条、筒各 1–9，每种八张，共 144 张。轮到你自动发牌；未胡时选牌打出。胡过后不再换打原手牌，只能胡新牌、合法杠，或过并打出新牌。没有胡、杠可选时自动摸打。</p><p>可胡时先选择胡或过，不同时开放杠。别人出牌时，胡优先于明杠，明杠优先于碰。三家都至少胡过一次，或牌墙摸完，本局结束。</p></section>
          <section><h3><span>二</span>三个牌区，每次胡都重算番</h3><p>自己的手牌区、碰杠区、胡牌区合计：同种牌恰好四张加 1 番，恰好五张加 2 番。没有加番时为 1 番。胡牌区每胡一次添一张；一炮多响的共胡牌带“共胡”标记，是记牌，不增加实体牌总量。</p><p class="fan-scale">1 番 1 分 · 2 番 2 分 · 3 番 4 分 · 4 番 8 分<br/>5 番 10 分 · 6 番 12 分 · 7 番 14 分，之后每番加 2 分。</p></section>
          <section><h3><span>三</span>萝卜累计，杠分即时结算</h3><p>每次合法杠立即翻 1 张自己的萝卜；第一次胡牌再加 6 张，之前的萝卜保留。每次胡牌都重新算番分与自己的萝卜匹配分；萝卜默认匹配本次成胡手牌和碰杠牌，不把此前胡牌重复加入。同牌数量相乘，例如自己的计分牌有两张二筒、萝卜有两张二筒，加 4 分。</p><p>明杠由出牌者付 2 分；暗杠另两家各付 2 分；碰后补杠另两家各付 1 分；四张杠再加第五张，另两家各付 1 分。杠分立即结算，独立于之后的胡牌分。胡后杠必须保持原听口。</p></section>
          <section><h3><span>四</span>胡牌、听口与付款方</h3><p>基础胡型为四组顺子或刻子加一对，也支持七对。普通自摸由另两家各付，普通接炮由出牌方付。胡后连续补摸及杠后补摸，原听口还有重合时不能再胡；全部换口可提前再胡，正常轮转后解除限制。</p><p>胡过的人普通出牌不能被接胡；杠后打出的那张仍可接胡，按自摸付款。当前是否可胡及原因，在自己的手牌区可查看，不会公开给牌友。</p></section>
          <section class="pending-rules"><h3><span>!</span>仍需一起核对的细节</h3><p>大单钓：胡牌前手里只剩一张牌，当前按另两家各付 50 分，暂不叠加番分、萝卜和神龙。三牌区同种牌六张及以上如何加番尚未确认，当前不额外加同牌番。</p><p>沿用的神龙暂定：本次成胡手牌、碰杠牌连同自己的萝卜（不含此前胡牌），同牌六张加 10 分、七张加 20 分、八张及以上加 40 分，普通胡牌时另计。以上未定细节不是自贡统一标准，以本桌服务端显示的结算为准。</p><p>全程无音效、无机器人、无倒计时。正常选牌不会自动代打。刷新可恢复当前标签页座位，请保留此页面；连续七天无操作的房间会过期。只使用虚拟积分。</p></section>
        </div><button class="button primary modal-confirm" @click="showRules = false">明白了，坐下玩一局</button></template>
        <template v-else><span class="eyebrow">好朋友，坐一桌</span><h2 id="invite-title">复制牌桌邀请</h2><p class="invite-modal-note">浏览器未允许自动复制，请选中下方链接并复制，发给两位朋友。</p><label class="field-label" for="invite-link">房间 {{ state.id }}</label><input id="invite-link" ref="inviteInput" :value="shareUrl" readonly @focus="$event.target.select()"/><button class="button primary modal-confirm" @click="showInvite = false">完成</button></template>
      </section>
    </div>
  </div>
</template>
