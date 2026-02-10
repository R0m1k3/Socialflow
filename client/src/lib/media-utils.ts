/**
 * Derives a Cloudinary video thumbnail URL from the original video URL.
 *
 * Cloudinary automatically generates image frames for uploaded videos.
 * By inserting transformation parameters into the URL, we can extract
 * a static JPEG thumbnail without any backend change or DB migration.
 *
 * @param originalUrl - The Cloudinary video URL (e.g. .../video/upload/v123/file.mp4)
 * @returns A JPEG thumbnail URL with fill-crop at 400x400
 */
export function getVideoThumbnailUrl(originalUrl: string): string {
    // Only transform Cloudinary video URLs
    if (!originalUrl.includes('/video/upload/')) {
        return originalUrl;
    }

    return originalUrl
        .replace('/video/upload/', '/video/upload/so_0,w_400,h_400,c_fill/')
        .replace(/\.[^.]+$/, '.jpg');
}
