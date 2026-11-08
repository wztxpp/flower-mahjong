// 浏览器原生 Canvas2D 像素验收。只由可见诊断按钮运行，不进入正式游戏构建。
// Native browser Canvas2D pixel audit, invoked only by a visible diagnostic button and excluded from game builds.
// 参数包含生产 renderer/descriptor 与独立的源图、允许区域，不能用 overlay 自己定义保护区。
// Inputs supply the production renderer/descriptor plus independent source and allowed regions, never inferred from the overlay.
function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Ordinary Canvas2D unavailable');
  return { canvas, context };
}

function makeAllowedMask(width, height, polygons) {
  const { context } = makeCanvas(width, height);
  context.fillStyle = '#fff';
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length < 3) throw new Error('Invalid independent audit polygon');
    context.beginPath();
    context.moveTo(polygon[0][0], polygon[0][1]);
    for (const point of polygon.slice(1)) context.lineTo(point[0], point[1]);
    context.closePath();
    context.fill();
  }
  return context.getImageData(0, 0, width, height).data;
}

function imageForUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Source image could not decode: ${url}`));
    image.src = url;
  });
}

// 一次复用实例，不把每帧重新建renderer的诊断开销误当作生产性能。
// Reuse one instance; per-frame renderer creation must not distort the production performance interpretation.
export async function auditPortraitMotion({ Renderer, descriptor, sourceUrl, width, height, eyePolygons, hairPolygons }) {
  const sourceImage = await imageForUrl(sourceUrl);
  if (sourceImage.naturalWidth !== width || sourceImage.naturalHeight !== height) throw new Error('Source dimensions do not match contract');
  const source = makeCanvas(width, height);
  source.context.drawImage(sourceImage, 0, 0);
  const baseline = source.context.getImageData(0, 0, width, height).data;
  const overlay = makeCanvas(width, height);
  const composite = makeCanvas(width, height);
  const eyeMask = makeAllowedMask(width, height, eyePolygons);
  const hairMask = makeAllowedMask(width, height, hairPolygons);
  const combinedMask = makeAllowedMask(width, height, [...eyePolygons, ...hairPolygons]);
  const eyePoints = eyePolygons.flat();
  const cropX = Math.max(0, Math.floor(Math.min(...eyePoints.map((point) => point[0]))) - 12);
  const cropY = Math.max(0, Math.floor(Math.min(...eyePoints.map((point) => point[1]))) - 12);
  const cropWidth = Math.min(width - cropX, Math.ceil(Math.max(...eyePoints.map((point) => point[0]))) + 12 - cropX);
  const cropHeight = Math.min(height - cropY, Math.ceil(Math.max(...eyePoints.map((point) => point[1]))) + 12 - cropY);
  const eyeCrop = makeCanvas(cropWidth, cropHeight);
  // 逐个发区保留原生像素裁切；整图缩小时可能掩盖外轮廓双线与接缝。
  // Preserve each hair region at native pixels; small portraits can hide double contours and seams.
  const hairCrops = descriptor.hairRegions.map((region) => {
    const [x, y, cropWidth, cropHeight] = region.rect;
    return { x, y, ...makeCanvas(cropWidth, cropHeight) };
  });
  let rendererError;
  const renderer = new Renderer(overlay.canvas, (error) => { rendererError = error; }, 'browser-audit:0', {
    sourceResolution: true,
    pixelRatio: 1,
    maxPixels: width * height,
  });
  const results = [];
  const legacySamples = [
    { name: 'original-open', blink: 0, hair: 0, mask: null },
    { name: 'closed', blink: 1, hair: 0, mask: eyeMask },
    { name: 'blink-threshold', blink: 0.5, hair: 0, mask: eyeMask },
    { name: 'hair-negative', blink: 0, hair: -1, mask: hairMask },
    { name: 'hair-positive', blink: 0, hair: 1, mask: hairMask },
    { name: 'combined', blink: 1, hair: 1, mask: combinedMask },
  ];
  // 多帧版逐个真实供体验收，不能用连续数值或图片数量替代实际中间形态。
  // Version two audits every actual donor, rather than treating a number or file count as an intermediate shape.
  const eyeIds = [...new Set(descriptor.eyes.flatMap((eye) => Object.keys(eye.sourceRects || {})))];
  const hairIds = [...new Set(descriptor.hairRegions.flatMap((region) => Object.keys(region.sourceRects || {})))];
  const geometryHair = descriptor.hairMode === 'geometry' && descriptor.hairRegions.length > 0;
  // 检查每对邻帧的真正中点，9发态时不能把已有±0.25/±0.75端态误当作混合检查。
  // Inspect actual adjacent-frame midpoints; nine hair states must not mistake existing ±0.25/±0.75 poses for blends.
  const hairMidpoints = (descriptor.hairSequence || []).slice(1).map((step, index) => (step.position + descriptor.hairSequence[index].position) / 2);
  const samples = descriptor.schemaVersion === 2 ? [
    { name: 'original-open', controls: { blinkFrameId: null, hairFrameId: null }, mask: null },
    ...eyeIds.map((frameId) => ({ name: `eye:${frameId}`, controls: { blinkFrameId: frameId, hairFrameId: null }, mask: eyeMask })),
    ...hairIds.map((frameId) => ({ name: `hair:${frameId}`, controls: { blinkFrameId: null, hairFrameId: frameId }, mask: hairMask })),
    ...(geometryHair ? [-1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1].map((hairPosition) => ({
      name: `hair-geometry:${hairPosition}`, controls: { blinkFrameId: null, hairPosition }, mask: hairMask,
    })) : []),
    ...(hairIds.length ? hairMidpoints.map((hairPosition) => ({ name: `hair-blend:${hairPosition}`, controls: { blinkFrameId: null, hairPosition }, mask: hairMask })) : []),
    ...(eyeIds.length && hairIds.length ? [{ name: 'combined', controls: { blinkFrameId: eyeIds.at(-1), hairFrameId: hairIds.at(-1) }, mask: combinedMask }] : []),
    ...(eyeIds.length && geometryHair ? [{ name: 'combined-geometry', controls: { blinkFrameId: eyeIds.at(-1), hairPosition: 1 }, mask: combinedMask }] : []),
  ] : legacySamples;
  try {
    await renderer.load(descriptor);
    if (rendererError) throw rendererError;
    for (const sample of samples) {
      renderer.renderFrame(sample.controls || { blink: sample.blink, hair: sample.hair });
      if (rendererError) throw rendererError;
      composite.context.clearRect(0, 0, width, height);
      composite.context.drawImage(source.canvas, 0, 0);
      composite.context.drawImage(overlay.canvas, 0, 0);
      const pixels = composite.context.getImageData(0, 0, width, height).data;
      const overlayPixels = overlay.context.getImageData(0, 0, width, height).data;
      let changedPixels = 0;
      let outsideAllowedPixels = 0;
      let overlayPixelsCount = 0;
      let maximumChannelDifference = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (overlayPixels[index + 3] !== 0) overlayPixelsCount += 1;
        let changed = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const difference = Math.abs(pixels[index + channel] - baseline[index + channel]);
          maximumChannelDifference = Math.max(maximumChannelDifference, difference);
          if (difference) changed = true;
        }
        if (changed) {
          changedPixels += 1;
          if (!sample.mask || sample.mask[index + 3] === 0) outsideAllowedPixels += 1;
        }
      }
      const expectedMotion = sample.name !== 'original-open';
      eyeCrop.context.clearRect(0, 0, cropWidth, cropHeight);
      eyeCrop.context.drawImage(composite.canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      results.push({
        name: sample.name,
        changedPixels,
        outsideAllowedPixels,
        overlayPixels: overlayPixelsCount,
        maximumChannelDifference,
        passed: outsideAllowedPixels === 0 && (expectedMotion ? changedPixels > 0 : overlayPixelsCount === 0),
        // 显示实际同一renderer的固定帧供目视复核，不是重新绘制的替身图。
        // Show the same real renderer's fixed frame for visual review, not a separately rendered stand-in.
        preview: composite.canvas.toDataURL('image/png'),
        eyePreview: eyeCrop.canvas.toDataURL('image/png'),
        hairPreviews: hairCrops.map(({ x, y, canvas, context }) => {
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(composite.canvas, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/png');
        }),
      });
    }
  } finally {
    renderer.dispose();
  }
  return { width, height, sourceUrl, scope: 'Actual Canvas2D pixels, not WebGL or device performance', results };
}

// 验证真实显示缩放下，结束眨眼/发摆后透明层没有残影；不是替身Canvas调用检查。
// Verify real display-scale alpha clears after blink/sway, not a mock Canvas call assertion.
export async function auditScaledClear(Renderer, descriptor) {
  const reports = [];
  const eyeId = Object.keys(descriptor.eyes[0]?.sourceRects || {}).at(-1);
  const active = descriptor.schemaVersion === 2 ? { blinkFrameId: eyeId, hairPosition: 1 } : { blink: 1, hair: 1 };
  const neutral = descriptor.schemaVersion === 2 ? { blinkFrameId: null, hairFrameId: null } : { blink: 0, hair: 0 };
  for (const [width, height, pixelRatio] of [[180, 240, 1], [160, 210, 1.5], [230, 320, 1], [300, 251, 1]]) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `width:${width}px;height:${height}px;position:fixed;left:0;top:0;visibility:hidden`;
    document.body.append(canvas);
    let error;
    const renderer = new Renderer(canvas, (value) => { error = value; }, 'scaled-audit', { pixelRatio });
    const samples = [];
    const countAlpha = () => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) count += 1;
      return count;
    };
    try {
      await renderer.load(descriptor);
      renderer.renderFrame(active);
      const activePixels = countAlpha();
      renderer.renderFrame(neutral);
      samples.push({ name: 'closed-to-neutral', remainingAlphaPixels: countAlpha() });
      renderer.renderFrame(descriptor.schemaVersion === 2 ? { blinkFrameId: null, hairPosition: -1 } : { blink: 0, hair: -1 });
      renderer.renderFrame(descriptor.schemaVersion === 2 ? { blinkFrameId: null, hairPosition: 1 } : { blink: 0, hair: 1 });
      renderer.renderFrame(neutral);
      samples.push({ name: 'sway-to-neutral', remainingAlphaPixels: countAlpha() });
      renderer.renderFrame(active);
      renderer.stop();
      samples.push({ name: 'stop-to-neutral', remainingAlphaPixels: countAlpha() });
      if (error) throw error;
      reports.push({ id: descriptor.id, width, height, pixelRatio, buffer: [canvas.width, canvas.height], activePixels, samples, passed: activePixels > 0 && samples.every((sample) => sample.remainingAlphaPixels === 0) });
    } finally {
      renderer.dispose();
      canvas.remove();
    }
  }
  return reports;
}
