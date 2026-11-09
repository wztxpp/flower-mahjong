// 全身坐姿只接纳已审查的透明下半身及显式坐标；缺资料保持半身，不补画、不拉伸原图。
// Accept only reviewed transparent lower-body art with explicit coordinates; missing data stays half-body without inventing or stretching pixels.
// 上身框维持原图尺寸比例，使既有眼发画布继续在原坐标中工作，外层再整体等比缩放。
// Preserve the original upper-art aspect so existing eye/hair canvases retain coordinates before uniform outer fitting.
const validSize = (value) => Array.isArray(value) && value.length === 2 && value.every((dimension) => Number.isFinite(dimension) && dimension > 0);
const validRect = (value, size) => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
  && value[0] >= 0 && value[1] >= 0 && value[2] > 0 && value[3] > 0
  && value[0] + value[2] <= size[0] && value[1] + value[3] <= size[1];
const percentRect = (rect, size) => ({
  left: `${rect[0] / size[0] * 100}%`, top: `${rect[1] / size[1] * 100}%`,
  width: `${rect[2] / size[0] * 100}%`, height: `${rect[3] / size[1] * 100}%`,
});

// 返回纯展示副本；不改变角色目录或批准状态，非法素材路径/裁切拒绝整个下层。
// Return a presentation copy without changing catalog approval; invalid asset paths/crops reject the whole lower layer.
export function realisticBodyModel(view) {
  const body = view?.body;
  if (body?.approved !== true || !validSize(body.canvasSize) || !validSize(body.lowerSourceSize)) return null;
  if (!validRect(body.upperRect, body.canvasSize) || !validRect(body.lowerRect, body.canvasSize)
    || !validRect(body.lowerSourceRect, body.lowerSourceSize)) return null;
  if ((Number.isFinite(view.width) && body.upperRect[2] !== view.width)
    || (Number.isFinite(view.height) && body.upperRect[3] !== view.height)) return null;
  // 像素整数取整最多允许一像素误差；不允许把宽裙/双腿横纵分别缩放。
  // Allow at most one rounded output pixel, never independently stretching dress or legs on each axis.
  if (Math.abs(body.lowerRect[2] * body.lowerSourceRect[3] - body.lowerRect[3] * body.lowerSourceRect[2])
    > Math.max(body.lowerSourceRect[2], body.lowerSourceRect[3])) return null;
  if (typeof body.lowerBodyUrl !== 'string' || !/^\/characters\/realistic\/[a-zA-Z0-9/_-]+\.png$/.test(body.lowerBodyUrl)) return null;
  // 椅子从审查后的臀/脚锚点定位，不用固定比例把所有角色悬在同一高度。
  // Chair placement follows reviewed seat/foot anchors instead of floating every role at a guessed fixed height.
  const validPoint = (point) => Array.isArray(point) && point.length === 2
    && point.every((value, index) => Number.isFinite(value) && value >= 0 && value <= body.canvasSize[index]);
  const hasChairAnchors = validPoint(body.seatAnchor) && Array.isArray(body.footAnchors) && body.footAnchors.length > 0
    && body.footAnchors.every(validPoint) && Math.max(...body.footAnchors.map((point) => point[1])) > body.seatAnchor[1];
  const chairStyle = hasChairAnchors ? {
    left: `${(body.seatAnchor[0] / body.canvasSize[0] - 0.24) * 100}%`,
    top: `${body.seatAnchor[1] / body.canvasSize[1] * 100}%`,
    width: '48%',
    height: `${(Math.max(...body.footAnchors.map((point) => point[1])) - body.seatAnchor[1]) / body.canvasSize[1] * 100}%`,
  } : null;
  // 旧上身偶有错误裤/膝，审查后的联合多边形只裁该部分；坐标仍是原上身，不改变脸与眼发。
  // Reviewed union polygons may hide old incorrect trousers/knees while preserving original face and motion coordinates.
  const polygons = body.upperClipPolygons;
  const validUpperPoint = (point) => Array.isArray(point) && point.length === 2
    && point.every((value, index) => Number.isFinite(value) && value >= 0 && value <= body.upperRect[index + 2]);
  if (polygons != null && (!Array.isArray(polygons) || !polygons.length || polygons.some((polygon) => !Array.isArray(polygon)
    || polygon.length < 3 || !polygon.every(validUpperPoint)))) return null;
  // 原半身袖底的局部补片只接受审查后的有限裁区；位于原上身后，不能拿供体脸替换身份。
  // Reviewed sleeve-bottom patches use bounded crops behind the original upper art, never donor faces replacing identity.
  const sleeves = body.sleevePatches;
  if (sleeves != null && (!validSize(sleeves.sourceSize)
    || !/^\/characters\/realistic\/[a-zA-Z0-9/_-]+\.png$/.test(sleeves.sourceUrl || '')
    || !Array.isArray(sleeves.patches) || !sleeves.patches.length || sleeves.patches.some((patch) => !validRect(patch.sourceRect, sleeves.sourceSize)
      || !validRect(patch.targetRect, body.upperRect.slice(2))
      || Math.abs(patch.targetRect[2] * patch.sourceRect[3] - patch.targetRect[3] * patch.sourceRect[2]) > Math.max(...patch.sourceRect.slice(2))))) return null;
  return {
    canvasSize: [...body.canvasSize],
    lowerSourceSize: [...body.lowerSourceSize],
    lowerBodyUrl: body.lowerBodyUrl,
    lowerViewBox: body.lowerSourceRect.join(' '),
    upperStyle: percentRect(body.upperRect, body.canvasSize),
    lowerStyle: percentRect(body.lowerRect, body.canvasSize),
    aspectRatio: `${body.canvasSize[0]} / ${body.canvasSize[1]}`,
    // 宽裙画布可向左右扩展；上身仍占外部角色框的同一宽度，不能因透明边界而缩脸。
    // Wider dress canvases extend sideways while the upper art retains the actor frame width instead of shrinking its face.
    canvasStyle: { width: `${body.canvasSize[0] / body.upperRect[2] * 100}%`,
      marginLeft: `${-body.upperRect[0] / body.upperRect[2] * 100}%`, aspectRatio: `${body.canvasSize[0]} / ${body.canvasSize[1]}`,
      '--body-width-per-upper-height': body.canvasSize[0] / body.upperRect[3],
      '--upper-width-per-upper-height': body.upperRect[2] / body.upperRect[3],
      '--upper-left-per-upper-height': body.upperRect[0] / body.upperRect[3] },
    upperClipPolygons: polygons?.map((polygon) => polygon.map((point) => `${point[0] / body.upperRect[2]},${point[1] / body.upperRect[3]}`).join(' ')) || null,
    sleevePatches: sleeves?.patches.map((patch) => ({ url: sleeves.sourceUrl, sourceSize: [...sleeves.sourceSize],
      viewBox: patch.sourceRect.join(' '), style: percentRect([patch.targetRect[0] + body.upperRect[0],
        patch.targetRect[1] + body.upperRect[1], patch.targetRect[2], patch.targetRect[3]], body.canvasSize) })) || [],
    chairStyle,
  };
}

// 第一人称腿是按角色单独批准的素材，不能把正面坐姿倒转，或把某人的裤鞋套给其他角色。
// First-person legs require identity-specific approval, never a rotated front pose or another character's clothes.
export function realisticPovModel(view) {
  const pov = view?.pov;
  if (pov?.approved !== true || !validSize(pov.sourceSize) || !validRect(pov.contentRect, pov.sourceSize)
    || typeof pov.url !== 'string' || !/^\/characters\/realistic\/[a-zA-Z0-9/_-]+\.png$/.test(pov.url)) return null;
  return { url: pov.url, sourceSize: [...pov.sourceSize], viewBox: pov.contentRect.join(' '),
    aspectRatio: `${pov.contentRect[2]} / ${pov.contentRect[3]}`,
    coverage: pov.coverage === 'lower-shins-and-worn-footwear-only' ? pov.coverage : 'seated-lap-and-footwear',
    displayWidth: pov.coverage === 'lower-shins-and-worn-footwear-only' ? 400 : 820 };
}
