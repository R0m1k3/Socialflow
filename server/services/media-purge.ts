import { db } from '../db';
import { media } from '@shared/schema';
import { eq, lt, isNotNull, and } from 'drizzle-orm';
import { minioService as cloudinaryService } from './minio';

/**
 * Automates the cleanup of old media to save Cloudinary storage space.
 * Scans the database for media older than 60 days, deletes the physical
 * files from Cloudinary, and removes the database records (cascading to post_media).
 */
export async function purgeOldMedia() {
    console.log('[Media Purge] Starting automatic purge of old media...');

    try {
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        // Find all media older than 60 days that have a cloudinaryPublicId
        const oldMedia = await db.query.media.findMany({
            where: (media, { and, lt, isNotNull }) => and(
                lt(media.createdAt, sixtyDaysAgo),
                isNotNull(media.cloudinaryPublicId)
            )
        });

        if (oldMedia.length === 0) {
            console.log('[Media Purge] No old media found to purge.');
            return;
        }

        console.log(`[Media Purge] Found ${oldMedia.length} media items older than 60 days to purge.`);

        let successCount = 0;
        let errorCount = 0;

        for (const item of oldMedia) {
            if (!item.cloudinaryPublicId) continue;

            try {
                // Delete from Cloudinary (using global config, userId is passed but ignored internally)
                await cloudinaryService.deleteMedia(
                    item.cloudinaryPublicId,
                    item.userId,
                    item.type === 'video' ? 'video' : 'image'
                );

                // Delete from Database (cascades to post_media, effectively leaving the post text intact)
                await db.delete(media).where(eq(media.id, item.id));

                successCount++;
                console.log(`[Media Purge] Successfully deleted media ${item.id} (Cloudinary ID: ${item.cloudinaryPublicId})`);
            } catch (err) {
                // Cloudinary file might already be deleted or missing, but we still might want to clean DB if it's consistently failing.
                // For safety, we only delete DB row if Cloudinary deletion succeeds or throws 'not found' (which we assume is fine).
                console.error(`[Media Purge] Failed to delete media ${item.id} from Cloudinary:`, err);
                errorCount++;
            }
        }

        console.log(`[Media Purge] Purge completed. Successfully deleted: ${successCount}, Failed: ${errorCount}.`);
    } catch (error) {
        console.error('[Media Purge] Fatal error during media purge process:', error);
    }
}
