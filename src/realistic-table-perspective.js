import furniture from '../public/furniture/catalog.json' with { type: 'json' };

// 二维桌面投影：把既有1000平方牌区统一投成坐在桌边的梯形，不引入三维引擎或第二套牌区。
// Project existing 1000-square zones into a seated trapezoid without a 3D engine or a second tile layout.
// 模板、可操作手牌锚点、桌腿与纯测试共用参数；牌河、公开手牌和飞牌继承整个桌面的投影。
// Rendering, control anchors, table legs and tests share values; rivers, public racks and flights inherit the table projection.
export const REALISTIC_ROOM_SCENE = Object.freeze({ width: 1360, height: 1700, focusHeight: 950 });
// 角点来自完整AI桌PNG的实测feltQuad加同一整图位移(24,120)，不是另画一张桌。
// Corners are measured from the complete generated table PNG plus its single (24,120) translation.
export const REALISTIC_TABLE_ART = Object.freeze(furniture.table);
const corner = (name) => furniture.table.feltQuad[name].map((value, index) => value + furniture.table.sceneOffset[index]);
const [FAR_LEFT, FAR_Y] = corner('TL');
const [FAR_RIGHT] = corner('TR');
const [NEAR_LEFT, NEAR_Y] = corner('BL');
const [NEAR_RIGHT] = corner('BR');
const depthRatio = (FAR_RIGHT - FAR_LEFT) / (NEAR_RIGHT - NEAR_LEFT);
const projection = Object.freeze({
  a: (FAR_RIGHT - FAR_LEFT) / 1000,
  b: (NEAR_LEFT * depthRatio - FAR_LEFT) / 1000,
  c: FAR_LEFT,
  d: (NEAR_Y * depthRatio - FAR_Y) / 1000,
  e: FAR_Y,
  g: (depthRatio - 1) / 1000,
});

// 输入为桌面局部像素，输出为完整房间像素；单应矩阵只改变显示，不读写游戏状态。
// Map table-local pixels to room pixels; the homography changes presentation only, never game state.
export function projectRealisticTablePoint(point) {
  const denominator = projection.g * point.y + 1;
  return {
    x: (projection.a * point.x + projection.b * point.y + projection.c) / denominator,
    y: (projection.d * point.y + projection.e - (Number.isFinite(point.z) ? point.z : 0)) / denominator,
  };
}

// CSS的matrix3d承载桌面单应与牌壳高度，不旋转人物或引入3D引擎；它与点投影完全一致。
// CSS matrix3d carries the plane homography and tile elevation, without a 3D engine or rotated bodies; it matches the point helper.
export function realisticTableProjectionTransform() {
  const { a, b, c, d, e, g } = projection;
  return `matrix3d(${a},0,0,0,${b},${d},0,${g},0,-1,1,0,${c},${e},0,1)`;
}

// 默认框住桌面与上身，完整场景包含可拖入视窗的桌下层；平移只改相机，不改牌区。
// Default framing fits the table and upper bodies, retaining an under-table layer reachable by panning without moving game zones.
export function realisticSceneCamera(width, height, zoom = 1, pan = { x: 0, y: 0 }) {
  const scale = Math.max(0.01, Math.min(width / REALISTIC_ROOM_SCENE.width, height / REALISTIC_ROOM_SCENE.focusHeight)) * zoom;
  return {
    scale,
    x: (width - REALISTIC_ROOM_SCENE.width * scale) / 2 + pan.x,
    // 窄而高的手机不在牌桌上方堆一大片空白；多出的高度用于真实桌下内容。
    // Tall narrow phones use spare height for the actual under-table room instead of empty space above the table.
    // 放大优先保住近沿手牌，不让固定在屏幕内的手牌压住牌河；它仍随同一个相机移动。
    // Detail zoom retains the near rack instead of clamping it over rivers; all public tiles move with that same camera.
    y: Math.min(32, (height - REALISTIC_ROOM_SCENE.focusHeight * scale) / 2, height - 52 - (NEAR_Y - 20) * scale) + pan.y,
  };
}

// 斜视相机以桌面而不是完整房间居中，因此上下可移动距离不对称；由实际房间边缘计算，确保脚部可达。
// Seated framing centers the table, not the full room, so vertical travel is asymmetric; actual room edges keep feet reachable.
export function clampRealisticScenePan(pan, width, height, zoom = 1) {
  const camera = realisticSceneCamera(width, height, zoom);
  const clampAxis = (value, size, origin, extent) => {
    const minimum = Math.min(-size / 4, size - origin - extent);
    const maximum = Math.max(size / 4, -origin);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
  };
  return {
    x: clampAxis(pan?.x, width, camera.x, REALISTIC_ROOM_SCENE.width * camera.scale),
    y: clampAxis(pan?.y, height, camera.y, REALISTIC_ROOM_SCENE.height * camera.scale),
  };
}

// 私有牌使用同一场景尺度，极窄屏保留18px可读下限；操作按钮不随桌面缩放。
// Private tiles share world scale, with an 18px readability floor on very narrow screens; action buttons remain unscaled.
export function realisticPrivateTileSize(scale) {
  const width = Math.max(18, 50 * scale);
  return { width, height: width / 0.72 };
}
