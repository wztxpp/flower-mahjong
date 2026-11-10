<script>
// 尺寸以牌高为单位；此纯几何目录只建立一次，不读取牌值、座位或网络。
// Geometry uses tile-height units and is built once, without tile values, seats or network access.
// 维护入口：docs/REALISTIC-ROUNDED-TILES.md。 / Maintenance: docs/REALISTIC-ROUNDED-TILES.md.
const CORNER_RADIUS = 0.09;
const BEVEL_RADIUS = 0.035;
const TILE_DEPTH = 0.42;
const CORNER_STEPS = 3;

// 上下倒角同时收拢轮廓；18–56px牌高只需各一段斜面，限制手机长牌河节点数。
// Both bevels narrow the outline. At 18–56px tile heights, one slope per end bounds mobile long-river node count.
const profile = [
  { z: 0, inset: BEVEL_RADIUS },
  { z: BEVEL_RADIUS, inset: 0 },
  { z: TILE_DEPTH - BEVEL_RADIUS, inset: 0 },
  { z: TILE_DEPTH, inset: BEVEL_RADIUS },
];
const length = (value) => `calc(var(--realistic-tile-height, 50px) * ${value.toFixed(7)})`;

// 每片用真实三维基向量连接相邻截面，轻微扩边只覆盖光栅化接缝。
// Each panel joins adjacent profiles with real 3D basis vectors; a tiny overlap covers raster seams only.
function panelStyle({ x, y, z, tangent, radial, run, rise, width, clip }) {
  const span = Math.hypot(run, rise);
  const vertical = [radial[0] * run / span, radial[1] * run / span, rise / span];
  const normal = [tangent[1] * vertical[2], -tangent[0] * vertical[2], tangent[0] * vertical[1] - tangent[1] * vertical[0]];
  return {
    width,
    height: length(span),
    // left/top百分比相对父牌；translate的百分比却相对小分片自身，会让远端角错位。
    // left/top percentages reference the parent tile; translate percentages reference the tiny facet and misplace far corners.
    left: x,
    top: y,
    transform: `translate3d(0px, 0px, ${length(z)}) matrix3d(${[...tangent, 0, 0, ...vertical, 0, ...normal, 0, 0, 0, 0, 1].join(',')})`,
    clipPath: clip,
    // 上下倒角用不同暖白明度；中段保留背部琥珀色材料带，不能染色原图。
    // Different warm bevel tones model lighting; the middle retains an amber backing band without tinting atlas art.
    background: z === BEVEL_RADIUS
      ? 'linear-gradient(#b88a35 0%, #d7ad56 24%, #eee1bb 25%, #fff6df 100%)'
      : `rgb(${Math.round(227 + z * 54)} ${Math.round(215 + z * 70)} ${Math.round(184 + z * 115)})`,
  };
}

// 四个角各分三片，再连接三个高度区间；总共48个静态表面，无逐帧计算。
// Three facets per corner connect three height bands: 48 static surfaces, with no per-frame calculation.
const shellPanels = [];
const corners = [
  { left: false, top: false, angle: 0 },
  { left: true, top: false, angle: 90 },
  { left: true, top: true, angle: 180 },
  { left: false, top: true, angle: 270 },
];
for (let band = 0; band < profile.length - 1; band += 1) {
  const lower = profile[band];
  const upper = profile[band + 1];
  for (const corner of corners) {
    for (let step = 0; step < CORNER_STEPS; step += 1) {
      const halfAngle = Math.PI / (4 * CORNER_STEPS);
      const angle = (corner.angle + (step + 0.5) * 90 / CORNER_STEPS) * Math.PI / 180;
      const radial = [Math.cos(angle), Math.sin(angle)];
      const tangent = [-radial[1], radial[0]];
      const lowerRadius = CORNER_RADIUS - lower.inset;
      const upperRadius = CORNER_RADIUS - upper.inset;
      const lowerWidth = 2 * lowerRadius * Math.sin(halfAngle);
      const upperWidth = 2 * upperRadius * Math.sin(halfAngle);
      const width = Math.max(lowerWidth, upperWidth);
      const offset = (axis) => radial[axis] * lowerRadius * Math.cos(halfAngle) - tangent[axis] * width / 2;
      const edge = (start, value) => `calc(${start ? '0px' : '100%'} + ${length((start ? CORNER_RADIUS : -CORNER_RADIUS) + value)})`;
      const lowerInset = (1 - lowerWidth / width) * 50;
      const upperInset = (1 - upperWidth / width) * 50;
      shellPanels.push(panelStyle({
        x: edge(corner.left, offset(0)), y: edge(corner.top, offset(1)), z: lower.z,
        tangent, radial, run: (upperRadius - lowerRadius) * Math.cos(halfAngle), rise: upper.z - lower.z,
        width: length(width),
        clip: `polygon(${lowerInset}% 0, ${100 - lowerInset}% 0, ${100 - upperInset}% 100%, ${upperInset}% 100%)`,
      }));
    }
  }
  // 直边在同一倒角截面衔接圆角；宽高独立来自父级变量，窄牌河也不会出现断缝。
  // Straight edges join those same corner profiles; independent parent dimensions keep narrow rivers connected.
  const straightEdges = [
    { x: length(CORNER_RADIUS), y: length(lower.inset), tangent: [1, 0], radial: [0, -1], dimension: 'width' },
    { x: `calc(100% - ${length(lower.inset)})`, y: length(CORNER_RADIUS), tangent: [0, 1], radial: [1, 0], dimension: 'height' },
    { x: `calc(100% - ${length(CORNER_RADIUS)})`, y: `calc(100% - ${length(lower.inset)})`, tangent: [-1, 0], radial: [0, 1], dimension: 'width' },
    { x: length(lower.inset), y: `calc(100% - ${length(CORNER_RADIUS)})`, tangent: [0, -1], radial: [-1, 0], dimension: 'height' },
  ];
  for (const edge of straightEdges) {
    shellPanels.push(panelStyle({
      ...edge, z: lower.z, run: lower.inset - upper.inset, rise: upper.z - lower.z,
      width: `calc(var(--realistic-tile-${edge.dimension}, ${edge.dimension === 'width' ? '36px' : '50px'}) - ${length(2 * CORNER_RADIUS)})`,
    }));
  }
}
</script>

<script setup>
// 原图组件仍是唯一牌面来源。back时连传给子组件的牌值都清空；立起绝不恢复隐藏牌。
// The canonical component remains the only face source. Back tiles pass no identity, and standing never reveals hidden faces.
import MahjongTile from './MahjongTile.vue';
defineProps({
  tile: { type: Number, default: null },
  back: Boolean,
  small: Boolean,
  upright: Boolean,
});
</script>

<template>
  <span class="realistic-solid-tile" :class="{ 'is-upright': upright }">
    <i class="realistic-tile-contact" aria-hidden="true"></i>
    <span class="realistic-tile-body">
      <i v-for="(panel, index) in shellPanels" :key="index" class="realistic-tile-shell-panel" :style="panel" aria-hidden="true"></i>
      <!-- 底盖封住实体；对手向内的面只画无字象牙面，不猜牌也不重复读屏标签。
           The bottom closes the solid. An opponent's inward face is blank ivory, never guessed or announced twice. -->
      <span class="realistic-tile-bottom" :aria-hidden="back && upright ? undefined : true">
        <MahjongTile class="realistic-tile-cap" :back="!back || upright" :small="small" />
      </span>
      <span class="realistic-tile-face" :aria-hidden="back && upright ? true : undefined">
        <MahjongTile class="realistic-tile-cap realistic-tile-top" :tile="back ? null : tile" :back="back && !upright" :small="small" />
      </span>
    </span>
  </span>
</template>

<style scoped>
/* 牌厚为牌高的42%，倒角上下各3.5%；所有中间节点保留3D，不能用overflow/filter裁平。
   Depth is 42% of height with 3.5% upper/lower bevels. Every intermediate node preserves 3D; never flatten with overflow/filter. */
.realistic-solid-tile {
  --tile-depth: calc(var(--realistic-tile-height, 50px) * .42);
  --tile-bevel: calc(var(--realistic-tile-height, 50px) * .035);
  position: relative;
  display: inline-block;
  width: var(--realistic-tile-width, 36px);
  height: var(--realistic-tile-height, 50px);
  transform-style: preserve-3d;
}
.realistic-tile-body {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transform-origin: center bottom;
}
.realistic-tile-contact {
  position: absolute;
  inset: 0;
  border-radius: calc(var(--realistic-tile-height, 50px) * .09);
  background: #0005;
  box-shadow: 1px 2px 3px #0007;
  transform: translateZ(.05px);
}
.realistic-tile-shell-panel {
  position: absolute;
  display: block;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  /* 亚像素接缝用同色细边缘覆盖，不能用一张平面阴影冒充侧壁。
     A matching hairline covers subpixel seams, rather than pretending a flat shadow is a side wall. */
  outline: .15px solid #e8dbb8;
}
.realistic-tile-face,
.realistic-tile-bottom {
  position: absolute;
  inset: var(--tile-bevel);
  transform-style: preserve-3d;
}
.realistic-tile-face { transform: translateZ(var(--tile-depth)); }
.realistic-tile-bottom { transform: rotateY(180deg); }
.realistic-solid-tile :deep(.mahjong-tile.realistic-tile-cap) {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  min-width: 0;
  border: 0;
  border-radius: calc(var(--realistic-tile-height, 50px) * .055);
  box-shadow: inset 0 0 0 .6px #fffbed;
  backface-visibility: hidden;
}
/* 绕桌面底边立起，整块牌一起转；局部+Y面向玩家，底盖的背面朝-Y桌心，父级只负责座位平面旋转。
   Stand the whole solid around its table-contact edge. Local +Y faces the player; the underside back faces table center (-Y). The parent owns seat rotation. */
.is-upright .realistic-tile-body { transform: rotateX(-90deg); }
.is-upright .realistic-tile-contact {
  top: auto;
  height: var(--tile-depth);
  transform: translateY(100%) translateZ(.05px);
}
</style>
