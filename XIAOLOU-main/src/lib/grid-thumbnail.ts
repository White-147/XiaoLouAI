/**
 * Generates a composite grid thumbnail from up to 4 image URLs.
 * Layout adapts to the number of images:
 * - 1 image: full canvas
 * - 2 images: side by side
 * - 3 images: left full-height + right top/bottom
 * - 4 images: 2x2 grid
 */
export async function generateGridThumbnail(
  imageUrls: string[],
): Promise<Blob | null> {
  const urls = imageUrls.filter(Boolean).slice(0, 4);
  if (urls.length === 0) return null;

  const CANVAS_W = 640;
  const CANVAS_H = 360;
  const GAP = 4;

  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`load failed: ${src}`));
      img.src = src;
    });

  const loaded: HTMLImageElement[] = [];
  for (const u of urls) {
    try {
      loaded.push(await loadImg(u));
    } catch {
      /* skip failed images */
    }
  }
  if (loaded.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const count = loaded.length;
  const halfW = CANVAS_W / 2 - GAP / 2;
  const halfH = CANVAS_H / 2 - GAP / 2;
  const midX = CANVAS_W / 2 + GAP / 2;
  const midY = CANVAS_H / 2 + GAP / 2;

  const cells =
    count === 1
      ? [{ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }]
      : count === 2
        ? [
            { x: 0, y: 0, w: halfW, h: CANVAS_H },
            { x: midX, y: 0, w: halfW, h: CANVAS_H },
          ]
        : count === 3
          ? [
              { x: 0, y: 0, w: halfW, h: CANVAS_H },
              { x: midX, y: 0, w: halfW, h: halfH },
              { x: midX, y: midY, w: halfW, h: halfH },
            ]
          : [
              { x: 0, y: 0, w: halfW, h: halfH },
              { x: midX, y: 0, w: halfW, h: halfH },
              { x: 0, y: midY, w: halfW, h: halfH },
              { x: midX, y: midY, w: halfW, h: halfH },
            ];

  for (let i = 0; i < loaded.length && i < cells.length; i++) {
    const img = loaded[i];
    const cell = cells[i];
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const cellRatio = cell.w / cell.h;
    let sx = 0,
      sy = 0,
      sw = img.naturalWidth,
      sh = img.naturalHeight;
    if (imgRatio > cellRatio) {
      sw = img.naturalHeight * cellRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / cellRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, cell.x, cell.y, cell.w, cell.h);
  }

  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
  );
}
