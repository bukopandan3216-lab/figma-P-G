import { supabase } from './supabase';

export const PRODUCT_IMAGE_BUCKET = 'product-images';
export const PRODUCT_IMAGE_LIMIT = 8;
export const VARIANT_IMAGE_LIMIT = 5;

export interface UploadedProductImage {
  path: string;
  url: string;
}

const MAX_IMAGE_DIMENSION = 1600;
const WEBP_QUALITY = 0.82;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to compress the selected image.'));
    }, type, quality);
  });
}

export async function compressProductImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image.`);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Unable to open ${file.name}. Choose a supported image format.`);
  }

  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot compress this image.');

    context.drawImage(bitmap, 0, 0, width, height);
    const webp = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
    if (webp.type === 'image/webp') return webp;

    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', WEBP_QUALITY);
    if (jpeg.type !== 'image/jpeg') throw new Error('Your browser cannot encode compressed product images.');
    return jpeg;
  } finally {
    bitmap.close();
  }
}

async function uploadSequence(files: File[], pathFor: (compressed: Blob) => string): Promise<UploadedProductImage[]> {
  const uploaded: UploadedProductImage[] = [];
  const storage = supabase.storage.from(PRODUCT_IMAGE_BUCKET);

  try {
    for (const file of files) {
      const compressed = await compressProductImage(file);
      const { data, error } = await storage.upload(pathFor(compressed), compressed, {
        cacheControl: '31536000',
        contentType: compressed.type,
        upsert: false,
      });
      if (error) throw error;

      uploaded.push({
        path: data.path,
        url: storage.getPublicUrl(data.path).data.publicUrl,
      });
    }

    return uploaded;
  } catch (error) {
    if (uploaded.length) {
      const { error: cleanupError } = await storage.remove(uploaded.map(image => image.path));
      if (cleanupError) {
        const message = error instanceof Error ? error.message : 'Image upload failed.';
        throw new Error(`${message} Cleanup also failed: ${cleanupError.message}`);
      }
    }
    throw error;
  }
}

const extensionFor = (compressed: Blob) => (compressed.type === 'image/webp' ? 'webp' : 'jpg');

export async function uploadProductImages(productId: string, files: File[]): Promise<UploadedProductImage[]> {
  if (files.length > PRODUCT_IMAGE_LIMIT) {
    throw new Error(`A product can hold up to ${PRODUCT_IMAGE_LIMIT} images.`);
  }
  return uploadSequence(files, compressed => `${productId}/${crypto.randomUUID()}.${extensionFor(compressed)}`);
}

// Per-variant photos live under {productId}/variants/{variantId}/ so they can
// be removed with the variant without touching the product's own gallery.
export async function uploadVariantImages(productId: string, variantId: string, files: File[]): Promise<UploadedProductImage[]> {
  if (files.length > VARIANT_IMAGE_LIMIT) {
    throw new Error(`A variant can hold up to ${VARIANT_IMAGE_LIMIT} images.`);
  }
  return uploadSequence(files, compressed => `${productId}/variants/${variantId}/${crypto.randomUUID()}.${extensionFor(compressed)}`);
}

export async function removeProductImages(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths);
  if (error) throw error;
}

export function getProductImageStoragePath(url: string): string | null {
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;
  const encodedPath = url.slice(markerIndex + marker.length).split('?')[0];
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}
