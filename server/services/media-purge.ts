import { db } from '../db';
import { media } from '@shared/schema';
import { eq, lt, and } from 'drizzle-orm';
import { minioService as storageService } from './minio';

/**
 * Purge old local media to save disk space:
 * - Images older than 30 days
 * - Videos older than 7 days
 */
export async function purgeOldMedia() {
  console.log('[Media Purge] Starting automatic purge of old media...');

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const oldImages = await db.query.media.findMany({
      where: (m, { and, lt, eq }) => and(eq(m.type, 'image'), lt(m.createdAt, thirtyDaysAgo))
    });

    const oldVideos = await db.query.media.findMany({
      where: (m, { and, lt, eq }) => and(eq(m.type, 'video'), lt(m.createdAt, sevenDaysAgo))
    });

    const toDelete = [...oldImages, ...oldVideos];

    if (toDelete.length === 0) {
      console.log('[Media Purge] No old media found to purge.');
      return;
    }

    console.log(`[Media Purge] Found ${oldImages.length} old images (>30 days) and ${oldVideos.length} old videos (>7 days) to purge.`);

    let successCount = 0;
    let errorCount = 0;

    for (const item of toDelete) {
      try {
        if (item.cloudinaryPublicId) {
          await storageService.deleteMedia(item.cloudinaryPublicId, item.userId, item.type === 'video' ? 'video' : 'image');
        }
        await db.delete(media).where(eq(media.id, item.id));
        successCount++;
      } catch (err) {
        console.error(`[Media Purge] Failed to delete media ${item.id}:`, err);
        errorCount++;
      }
    }

    console.log(`[Media Purge] Purge completed. Deleted: ${successCount}, Failed: ${errorCount}.`);
  } catch (error) {
    console.error('[Media Purge] Fatal error during media purge process:', error);
  }
}
