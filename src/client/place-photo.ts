import { cleanPhoto, MAX_PHOTO_LENGTH } from "../shared/life.js";

export async function preparePlacePhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12_000_000)
    throw new Error("请选择12MB以内的 JPG、PNG 或 WebP 照片。");
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("此浏览器无法处理照片，请换一张较小的图片。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.75, 0.5, 0.3, 0.2]) {
      const photo = canvas.toDataURL("image/jpeg", quality);
      if (photo.length <= MAX_PHOTO_LENGTH) return cleanPhoto(photo)!;
    }
    throw new Error("照片细节较多，请裁剪到店铺入口后再试。");
  } finally {
    bitmap.close();
  }
}
