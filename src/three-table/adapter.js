// 三维展示只消费既有隐私投影，不拥有牌局；所有坐标均来自已显示的权威状态。
// The Three scene consumes the existing privacy projection, never owns a game, and places only authoritative displayed tiles.
import { buildRealisticTableModel, fitRealisticTileGrid } from '../realistic-table-layout.js';

// 沿用固定物理座位与空位旋转，不能随人数把对家换成邻家。
// Preserve physical seats and rotating vacancies instead of moving opponents when the count changes.
export function buildThreeTableModel(state) {
  const projected = buildRealisticTableModel(state);
  return {
    roomId: state?.id,
    gameId: state?.game?.id,
    wallCount: projected.wallCount,
    radishMode: projected.radishMode,
    radishes: projected.radishes,
    pendingRadishes: projected.pendingRadishes,
    seats: projected.seats.map((seat) => ({
      seat: seat.seat, position: seat.position, rotation: seat.rotation, isSelf: seat.isSelf,
      hand: seat.hand, handCount: seat.handCount, melds: seat.melds, wins: seat.wins,
      huCount: seat.huCount, personalRadishes: seat.personalRadishes, discards: seat.discards,
      score: state.game.players.find((player) => player.seat === seat.seat)?.score ?? 0,
      name: state.game.participantNames?.[seat.seat] || state.seats?.find((player) => player?.seat === seat.seat)?.name || `牌友 ${seat.seat + 1}`,
    })),
  };
}

// 固定区域按数量缩小所有牌，长牌河/多副牌萝卜不截断。返回局部桌面坐标与比例。
// Fit every tile into its fixed region, without truncating long rivers or multi-deck radishes.
export function tileGrid(count, { x, z, width, depth }, maxHeight = 0.69) {
  const fitted = fitRealisticTileGrid(count, width, depth, 0.48 / 0.69, 0.04);
  const height = Math.min(maxHeight, fitted.tileHeight);
  const widthPerTile = height * 0.48 / 0.69;
  return Array.from({ length: count }, (_, index) => ({
    x: x - width / 2 + widthPerTile / 2 + (index % fitted.columns) * (widthPerTile + fitted.gap),
    z: z - depth / 2 + height / 2 + Math.floor(index / fitted.columns) * (height + fitted.gap),
    scale: height / 0.69,
  }));
}

export const TABLE_ZONES = Object.freeze({
  hand: { x: 0, z: 8, width: 8, depth: 0.75 },
  discards: { x: 0, z: 4.1, width: 4.3, depth: 3.2 },
  melds: { x: -4.7, z: 7, width: 4, depth: 1.1 },
  wins: { x: 4.7, z: 6.8, width: 4, depth: 1.4 },
  personalRadishes: { x: 4.7, z: 8, width: 4, depth: 0.7 },
  radishes: { x: 0, z: 0, width: 4.2, depth: 3.2 },
});
