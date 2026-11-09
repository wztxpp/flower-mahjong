// 新整身来源与旧拼接是不同协议，禁止把旧下半身或旧眼发坐标混入新整图。
// Whole-source figures use a distinct schema; old lower bodies and motion coordinates never enter the new image.
import furniture from '../public/furniture/catalog.json' with { type: 'json' };
const validPoint = (value, size) => Array.isArray(value) && value.length === 2
  && value.every((number, index) => Number.isFinite(number) && number >= 0 && number <= size[index]);
const validRect = (value, size) => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
  && value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0
  && value[0] + value[2] <= size[0] && value[1] + value[3] <= size[1];

export function realisticFigureModel(view) {
  const figure = view?.figure;
  if (figure?.approved !== true || figure.schemaVersion !== 2 || figure.sourceMode !== 'singleFullBody'
    || !Array.isArray(figure.sourceSize) || figure.sourceSize.length !== 2 || !figure.sourceSize.every((value) => Number.isFinite(value) && value > 0)
    || !/^\/characters\/realistic\/[a-zA-Z0-9/_-]+\.png$/.test(figure.url || '')
    || !/^[a-f0-9]{64}$/.test(figure.sourceSha256 || '')) return null;
  const size = figure.sourceSize;
  if (!validRect(figure.contentBounds, size) || !validRect(figure.footBounds, size)
    || !validPoint(figure.seatAnchor, size) || !validPoint(figure.handContacts?.left, size) || !validPoint(figure.handContacts?.right, size)
    || ['lowerBodyUrl', 'upperRect', 'lowerRect', 'sleevePatches'].some((key) => Object.hasOwn(figure, key))) return null;
  const polygons = figure.frontOfTablePolygons;
  if (!Array.isArray(polygons) || polygons.some((polygon) => !Array.isArray(polygon)
    || polygon.length < 3 || !polygon.every((point) => validPoint(point, size)))) return null;
  return { ...figure, sourceSize: [...size], contentBounds: [...figure.contentBounds], footBounds: [...figure.footBounds],
    seatAnchor: [...figure.seatAnchor], handContacts: { left: [...figure.handContacts.left], right: [...figure.handContacts.right] },
    frontOfTablePolygons: polygons.map((polygon) => polygon.map((point) => [...point])), clipPolygons: polygons.map((polygon) => polygon.map(([x, y]) => `${x / size[0]},${y / size[1]}`).join(' ')) };
}

// 一份矩阵定位整个人物：以手的中点贴桌边，头到手高度一致；前景mask和背层不允许分别移动。
// One transform locates the whole actor: contact midpoint meets the rim at a consistent head-to-hand scale. Foreground and body cannot move separately.
export function realisticFigurePlacement(figure, position) {
  if (!figure) return null;
  const targets = { left: [285, 515, 385], right: [1075, 515, 385], north: [680, 281, 270] };
  const target = targets[position] || targets.north;
  const hands = [figure.handContacts.left, figure.handContacts.right];
  const contact = hands.reduce((sum, point) => [sum[0] + point[0] / hands.length, sum[1] + point[1] / hands.length], [0, 0]);
  const scale = target[2] / Math.max(1, contact[1] - figure.contentBounds[1]);
  const x = target[0] - contact[0] * scale;
  const y = target[1] - contact[1] * scale;
  return { x, y, scale, style: { left: `${x}px`, top: `${y}px`, right: 'auto', width: `${figure.sourceSize[0] * scale}px`, height: `${figure.sourceSize[1] * scale}px` } };
}

// 椅座贴合整图臀部，椅脚与人物脚共用地面高度；只缩放整张椅子，不拉长椅腿。
// Match the cushion to the pelvis and chair feet to the actor's ground line using one uniform chair scale.
export function realisticChairPlacement(figure, orientation) {
  const chair = furniture.chairs[orientation];
  if (!figure || chair?.approved !== true) return null;
  const [cx, cy] = chair.seatAnchor;
  const ground = Math.max(...Object.values(chair.footAnchors).map((point) => point[1]));
  const scale = (figure.footBounds[1] + figure.footBounds[3] - figure.seatAnchor[1]) / (ground - cy);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return { url: chair.url, style: {
    left: `${(figure.seatAnchor[0] - cx * scale) / figure.sourceSize[0] * 100}%`,
    top: `${(figure.seatAnchor[1] - cy * scale) / figure.sourceSize[1] * 100}%`,
    width: `${chair.sourceSize[0] * scale / figure.sourceSize[0] * 100}%`,
    height: `${chair.sourceSize[1] * scale / figure.sourceSize[1] * 100}%`,
  } };
}
