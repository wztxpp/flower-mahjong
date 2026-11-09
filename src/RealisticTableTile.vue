<script setup>
// 原牌面仍由唯一的麻将图集绘制；这里只添加连贯的实体侧面，不能生成或猜测牌值。
// The canonical atlas still owns every face; this wrapper adds connected solid sides, never generated or guessed tile values.
import MahjongTile from './MahjongTile.vue';
defineProps({ tile: { type: Number, default: null }, back: Boolean, small: Boolean });
</script>
<template>
  <span class="realistic-solid-tile">
    <i class="realistic-tile-contact" aria-hidden="true"></i>
    <i class="realistic-tile-side side-north" aria-hidden="true"></i>
    <i class="realistic-tile-side side-east" aria-hidden="true"></i>
    <i class="realistic-tile-side side-south" aria-hidden="true"></i>
    <i class="realistic-tile-side side-west" aria-hidden="true"></i>
    <MahjongTile class="realistic-tile-top" :tile="tile" :back="back" :small="small" />
  </span>
</template>
<style scoped>
/* 四个侧面连接桌面z=0与牌面z=9；座位仅绕z轴旋转，厚度始终朝屏幕下方。
   Four sides join table z=0 to face z=9. Seats rotate only around z, so thickness remains screen-down. */
.realistic-solid-tile { --tile-depth: calc(var(--realistic-tile-height,50px) * .18); position: relative; display: inline-block; width: var(--realistic-tile-width,36px); height: var(--realistic-tile-height,50px); transform-style: preserve-3d; }
.realistic-tile-contact { position: absolute; inset: 0; border-radius: 4px; background: #0007; box-shadow: 1px 2px 4px #0009; transform: translateZ(.1px); }
.realistic-tile-side { position: absolute; display: block; background: linear-gradient(#977024,#c18e29 32%,#fff5cd 34%); border: .6px solid #73551d; box-sizing: border-box; }
.side-north, .side-south { left: 0; width: 100%; height: var(--tile-depth); transform-origin: top center; transform: rotateX(90deg); }
.side-north { top: 0; }.side-south { top: 100%; }
.side-east, .side-west { top: 0; height: 100%; width: var(--tile-depth); transform-origin: left center; transform: rotateY(-90deg); background: linear-gradient(90deg,#977024,#c18e29 32%,#fff5cd 34%); }
.side-west { left: 0; }.side-east { left: 100%; }
.realistic-solid-tile :deep(.realistic-tile-top) { position: absolute; inset: 0; transform: translateZ(var(--tile-depth)); border: 1px solid #d2c092; box-shadow: inset 0 0 0 1px #fffbed; border-radius: 3px; }
</style>
