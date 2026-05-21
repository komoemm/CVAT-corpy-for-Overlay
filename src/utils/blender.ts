import { MatchedPair } from '../types';

/**
 * Strips folder path and extension to extract a clean base filename in lowercase.
 */
export function getBaseName(filePath: string): string {
  const filename = filePath.split('/').pop() || filePath;
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return filename.toLowerCase();
  return filename.substring(0, lastDot).toLowerCase();
}

/**
 * Matches original files and CVAT mask files by their base filenames.
 */
export function matchFiles(originalFiles: File[], maskFiles: File[]): MatchedPair[] {
  const originalMap = new Map<string, { file: File; path: string }>();
  
  for (const file of originalFiles) {
    const relativePath = (file as any).webkitRelativePath || file.name;
    const baseName = getBaseName(relativePath);
    originalMap.set(baseName, { file, path: relativePath });
  }

  const matched: MatchedPair[] = [];
  
  for (const maskFile of maskFiles) {
    const relativePath = (maskFile as any).webkitRelativePath || maskFile.name;
    const baseName = getBaseName(relativePath);
    
    if (originalMap.has(baseName)) {
      const original = originalMap.get(baseName)!;
      matched.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 9),
        name: baseName,
        originalFile: original.file,
        maskFile: maskFile,
        originalPath: original.path,
        maskPath: relativePath,
        status: 'pending',
        size: original.file.size + maskFile.size
      });
    }
  }
  
  // Sort naturally by filename
  return matched.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );
}

/**
 * Utility to load an image source into HTMLImageElement.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image asset: ${url}`));
    img.src = url;
  });
}

/**
 * Draws original and mask images on offscreen canvases, crops out pure black
 * mask pixels, overlays them with custom opacity, and outputs a formatted Blob.
 */
export async function blendImages(
  orgFile: File,
  maskFile: File,
  opacity: number,
  format: 'png' | 'jpeg',
  jpegQuality: number = 0.9,
  blackThreshold: number = 0
): Promise<Blob> {
  const orgUrl = URL.createObjectURL(orgFile);
  const maskUrl = URL.createObjectURL(maskFile);

  try {
    const [orgImg, maskImg] = await Promise.all([
      loadImage(orgUrl),
      loadImage(maskUrl)
    ]);

    const width = orgImg.naturalWidth;
    const height = orgImg.naturalHeight;

    const mainCanvas = document.createElement('canvas');
    mainCanvas.width = width;
    mainCanvas.height = height;
    const mainCtx = mainCanvas.getContext('2d');
    if (!mainCtx) throw new Error('Could not obtain output canvas 2D context');

    // Canvas to process the mask
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) throw new Error('Could not obtain mask canvas 2D context');

    // Draw original image onto output canvas
    mainCtx.drawImage(orgImg, 0, 0, width, height);

    // Draw mask image onto mask canvas
    maskCtx.drawImage(maskImg, 0, 0, width, height);

    // Process mask pixel array
    const maskImageData = maskCtx.getImageData(0, 0, width, height);
    const pixels = maskImageData.data;
    const alphaLimit = Math.round(opacity * 255);

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];

      // Check if pixel is pure black [0, 0, 0] or within dark threshold
      if (r <= blackThreshold && g <= blackThreshold && b <= blackThreshold) {
        pixels[i + 3] = 0; // Completely transparent
      } else {
        // Apply opacity mask on non-black items
        if (a > 0) {
          pixels[i + 3] = alphaLimit;
        }
      }
    }

    // Put modulated mask data back
    maskCtx.putImageData(maskImageData, 0, 0);

    // Paint processed mask canvas on top of original image
    mainCtx.drawImage(maskCanvas, 0, 0);

    // Export image blob
    return new Promise((resolve, reject) => {
      const targetMime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const compression = format === 'jpeg' ? jpegQuality : undefined;
      
      mainCanvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas image compression failed'));
          }
        },
        targetMime,
        compression
      );
    });

  } finally {
    // Release resources
    URL.revokeObjectURL(orgUrl);
    URL.revokeObjectURL(maskUrl);
  }
}
