/**
 * Returns a thumbnail URL for a video.
 * With MinIO there are no automatic URL-based transformations,
 * so we return the original URL and let the browser render the video.
 */
export function getVideoThumbnailUrl(originalUrl: string): string {
    return originalUrl;
}
