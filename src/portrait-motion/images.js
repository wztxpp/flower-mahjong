// 立绘供体的有界加载队列：只共享正在加载的Promise，完成后不把完整解码图永久保存在全局。
// Bounded portrait-donor loading: share only pending promises and never retain completed full-size decoded images globally.
// 每个renderer顺序摘取小ROI后丢弃整图；其他座位的卸载不能取消同一在途URL。
// Each renderer extracts small ROIs sequentially and drops the full image; another seat's disposal cannot cancel a shared pending URL.
export const MOTION_MAX_CONCURRENT_IMAGES = 2;
const imagePromises = new Map();
const imageQueue = [];
let activeImageCount = 0;

// 队列只启动有空位的下载；开始后才计15秒超时，排队时间不误报图片失败。
// Start queued downloads only when a slot is free; the 15-second timeout begins then, not while waiting for a slot.
function drainImageQueue() {
  while (activeImageCount < MOTION_MAX_CONCURRENT_IMAGES && imageQueue.length > 0) {
    activeImageCount += 1;
    imageQueue.shift()();
  }
}

// 返回同URL在途Promise；成功/失败都移除全局引用。失败可重试，但调用者的控制器仍限制自动重试。
// Return the pending promise for a URL; both success and failure remove global references. Failures can retry while controllers still bound automatic retries.
export function loadMotionImage(url, environment = globalThis) {
  if (imagePromises.has(url)) return imagePromises.get(url);
  let resolveImage;
  let rejectImage;
  const pending = new Promise((resolve, reject) => {
    resolveImage = resolve;
    rejectImage = reject;
  });
  imagePromises.set(url, pending);
  imageQueue.push(() => {
    let image;
    let timeout;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      environment.clearTimeout?.(timeout);
      if (image) {
        image.onload = null;
        image.onerror = null;
        // 共享Promise已确定失败时，取消底层Image再释放队列位；只解绑回调不会停止慢下载/解码。
        // Once the shared promise fails, cancel its underlying Image before freeing the slot; detached handlers alone do not stop slow work.
        // 清理异常不得吞掉原失败或卡住其他请求；成功的共享图和仅单个座位卸载不走此路径。
        // Cleanup errors cannot hide the original failure or stall queued work; successful images and individual-owner disposal never enter this path.
        if (error) {
          try { image.src = ''; } catch { /* 尽力取消后继续失败清理。 / Continue failure cleanup after best-effort cancellation. */ }
        }
      }
      if (imagePromises.get(url) === pending) imagePromises.delete(url);
      activeImageCount -= 1;
      if (error) rejectImage(error);
      else resolveImage(image);
      drainImageQueue();
    };
    try {
      image = new environment.Image();
      image.onload = () => finish();
      image.onerror = () => finish(new Error('Portrait image unavailable'));
      timeout = environment.setTimeout?.(() => finish(new Error('Portrait image timed out')), 15000);
      image.src = url;
    } catch (error) {
      finish(error);
    }
  });
  drainImageQueue();
  return pending;
}
