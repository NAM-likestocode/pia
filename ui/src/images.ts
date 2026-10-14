// Photos she adds: shrink them before sending so they travel quickly.

import type { ImageData } from "./protocol";

const MAX_SIDE = 1600;
const QUALITY = 0.85;

export type PendingImage = ImageData & { key: string; preview: string };

let counter = 0;

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; done(): void }> {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Downscales to at most 1600 px on the long side and re-encodes as JPEG. */
export async function prepareImage(file: Blob): Promise<PendingImage> {
  const image = await decode(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    // JPEG has no transparency: put see-through parts on white.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
    const comma = dataUrl.indexOf(",");
    return {
      key: `img${++counter}`,
      data: dataUrl.slice(comma + 1),
      mimeType: "image/jpeg",
      preview: dataUrl,
    };
  } finally {
    image.done();
  }
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}
