import { storage } from '../storage';
import type { Post, SocialPage, Media } from '@shared/schema';
import { imageProcessor } from './imageProcessor';
import { cloudinaryService } from './cloudinary';

interface FacebookPhotoResponse {
  id: string;
  post_id: string;
}

interface FacebookFeedResponse {
  id: string;
}

interface FacebookVideoResponse {
  id: string;
  post_id?: string;
}

interface FacebookError {
  error: {
    message: string;
    type: string;
    code: number;
  };
}

export class FacebookService {
  private baseUrl = 'https://graph.facebook.com/v23.0';

  async publishPost(post: Post, page: SocialPage, postType: string, mediaList: Media[] = []): Promise<string> {
    if (page.platform !== 'facebook') {
      throw new Error('This service only supports Facebook pages');
    }

    if (!page.accessToken) {
      throw new Error('No access token found for this page');
    }

    // Handle different post types
    // Note: "both" type should never reach here - new posts are split at creation
    // If it does reach here (legacy data), throw an error
    if (postType === 'both') {
      throw new Error('postType "both" is not supported. Posts should be split into separate feed and story entries at creation.');
    }

    if (postType === 'story') {
      // Publish as story - one story per media
      if (mediaList.length === 0) {
        throw new Error('Stories require media (photo or video)');
      }

      // Publish each media as a separate story
      const storyIds: string[] = [];
      for (const media of mediaList) {
        const storyId = await this.publishStory(post, page, media);
        storyIds.push(storyId);
      }

      // Return all story IDs joined together
      return storyIds.join(',');
    } else if (postType === 'reel') {
      // Publish as Reel
      if (mediaList.length === 0) {
        throw new Error('Reels require a video');
      }

      const videoMedia = mediaList.find(m => m.type === 'video');
      if (!videoMedia) {
        throw new Error('Reels require a video media');
      }

      return await this.publishReel(page, videoMedia.originalUrl, post.content);
    } else {
      // Default to feed
      const imageMedia = mediaList.filter(m => m.type === 'image');
      const videoMedia = mediaList.filter(m => m.type === 'video');

      if (imageMedia.length > 1) {
        // Multi-photo carousel (images only)
        return await this.publishMultiPhotoPost(post, page, mediaList);
      } else if (imageMedia.length === 1) {
        // Single image (even if mixed with videos, prioritize the image)
        return await this.publishPhotoPost(post, page, imageMedia[0]);
      } else if (videoMedia.length >= 1) {
        // Video post - use video endpoint
        return await this.publishVideoPost(post, page, videoMedia[0]);
      } else {
        // Text only
        return await this.publishTextPost(post, page);
      }
    }
  }

  private async publishTextPost(post: Post, page: SocialPage): Promise<string> {
    const params = new URLSearchParams({
      access_token: page.accessToken!,
      message: post.content,
    });

    const url = `${this.baseUrl}/${page.pageId}/feed?${params.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json() as FacebookError;
      throw new Error(`Facebook API error: ${error.error.message} (code: ${error.error.code})`);
    }

    const data = await response.json() as FacebookFeedResponse;
    return data.id;
  }

  private async publishPhotoPost(post: Post, page: SocialPage, media: Media): Promise<string> {
    // Use original URL - Facebook handles the cropping
    const photoUrl = media.originalUrl;

    const params = new URLSearchParams({
      access_token: page.accessToken!,
      message: post.content,
      url: photoUrl,
    });

    const url = `${this.baseUrl}/${page.pageId}/photos?${params.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json() as FacebookError;
      throw new Error(`Facebook API error: ${error.error.message} (code: ${error.error.code})`);
    }

    const data = await response.json() as FacebookPhotoResponse;
    // Return the post_id which is the full post identifier
    return data.post_id || data.id;
  }

  /**
   * Generates a Facebook-compatible video URL with Cloudinary transformations
   * Facebook requires: H.264 video codec, AAC audio codec, MP4 container
   */
  private getFacebookCompatibleVideoUrl(originalUrl: string): string {
    // Check if this is a Cloudinary URL
    const cloudinaryPattern = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/video\/upload\//;
    const match = originalUrl.match(cloudinaryPattern);

    if (!match) {
      // Not a Cloudinary URL, return as-is (may fail on Facebook)
      console.warn('Video URL is not from Cloudinary, cannot apply transformations:', originalUrl);
      return originalUrl;
    }

    const [fullMatch, cloudName] = match;
    const videoPath = originalUrl.replace(fullMatch, '');

    // Apply transformations for Facebook compatibility:
    // - vc_h264: Video codec H.264
    // - ac_aac: Audio codec AAC
    // - f_mp4: Force MP4 format
    // - q_auto: Automatic quality optimization
    const transformations = 'vc_h264,ac_aac,f_mp4,q_auto';

    const transformedUrl = `https://res.cloudinary.com/${cloudName}/video/upload/${transformations}/${videoPath}`;

    console.log('🎬 Transforming video for Facebook compatibility:');
    console.log('   Original:', originalUrl);
    console.log('   Transformed:', transformedUrl);

    return transformedUrl;
  }

  private async publishVideoPost(post: Post, page: SocialPage, media: Media): Promise<string> {
    // Transform video URL to ensure Facebook compatibility (H.264/AAC/MP4)
    const videoUrl = this.getFacebookCompatibleVideoUrl(media.originalUrl);

    const params = new URLSearchParams({
      access_token: page.accessToken!,
      description: post.content,
      file_url: videoUrl,
    });

    const url = `${this.baseUrl}/${page.pageId}/videos?${params.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json() as FacebookError;
      throw new Error(`Facebook API error publishing video: ${error.error.message} (code: ${error.error.code})`);
    }

    const data = await response.json() as FacebookVideoResponse;
    // Return the post_id or id
    return data.post_id || data.id;
  }

  private async publishMultiPhotoPost(post: Post, page: SocialPage, mediaList: Media[]): Promise<string> {
    // Validate that all media are images
    const imageMedia = mediaList.filter(m => m.type === 'image');
    if (imageMedia.length === 0) {
      throw new Error('Multi-photo posts require at least one image');
    }

    if (imageMedia.length !== mediaList.length) {
      console.warn(`Filtered out ${mediaList.length - imageMedia.length} non-image media from multi-photo post`);
    }

    // Step 1: Upload all photos as unpublished and collect photo IDs
    const photoIds: string[] = [];

    for (const media of imageMedia) {
      // Use original URL - Facebook handles the cropping for carousel
      const photoUrl = media.originalUrl;

      if (!photoUrl) {
        console.warn(`Skipping media ${media.id} - no valid URL found`);
        continue;
      }

      const uploadParams = new URLSearchParams({
        access_token: page.accessToken!,
        url: photoUrl,
        published: 'false',
      });

      const uploadUrl = `${this.baseUrl}/${page.pageId}/photos?${uploadParams.toString()}`;

      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json() as FacebookError;
        throw new Error(`Facebook API error uploading photo: ${error.error.message} (code: ${error.error.code})`);
      }

      const uploadData = await uploadResponse.json() as FacebookPhotoResponse;
      photoIds.push(uploadData.id);
    }

    if (photoIds.length === 0) {
      throw new Error('No photos were successfully uploaded');
    }

    // Step 2: Create feed post with all attached photos
    const feedParams = new URLSearchParams({
      access_token: page.accessToken!,
      message: post.content,
    });

    // Add each photo as attached_media
    photoIds.forEach((photoId, index) => {
      feedParams.append(`attached_media[${index}]`, JSON.stringify({ media_fbid: photoId }));
    });

    const feedUrl = `${this.baseUrl}/${page.pageId}/feed?${feedParams.toString()}`;

    const feedResponse = await fetch(feedUrl, {
      method: 'POST',
    });

    if (!feedResponse.ok) {
      const error = await feedResponse.json() as FacebookError;
      throw new Error(`Facebook API error creating feed post: ${error.error.message} (code: ${error.error.code})`);
    }

    const feedData = await feedResponse.json() as FacebookFeedResponse;
    return feedData.id;
  }

  async schedulePost(post: Post, page: SocialPage, scheduledTime: Date, media?: Media): Promise<string> {
    if (page.platform !== 'facebook') {
      throw new Error('This service only supports Facebook pages');
    }

    if (!page.accessToken) {
      throw new Error('No access token found for this page');
    }

    // Facebook requires Unix timestamp for scheduled posts
    const scheduledTimestamp = Math.floor(scheduledTime.getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);

    // Facebook requires scheduled time to be at least 10 minutes in the future
    if (scheduledTimestamp < now + 600) {
      throw new Error('Scheduled time must be at least 10 minutes in the future');
    }

    // Maximum 6 months in the future
    const sixMonthsFromNow = now + (6 * 30 * 24 * 60 * 60);
    if (scheduledTimestamp > sixMonthsFromNow) {
      throw new Error('Scheduled time cannot be more than 6 months in the future');
    }

    // For scheduled posts with photos
    if (media) {
      return await this.schedulePhotoPost(post, page, scheduledTimestamp, media);
    } else {
      return await this.scheduleTextPost(post, page, scheduledTimestamp);
    }
  }

  private async scheduleTextPost(post: Post, page: SocialPage, scheduledTimestamp: number): Promise<string> {
    const params = new URLSearchParams({
      access_token: page.accessToken!,
      message: post.content,
      published: '0',
      scheduled_publish_time: scheduledTimestamp.toString(),
    });

    const url = `${this.baseUrl}/${page.pageId}/feed?${params.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json() as FacebookError;
      throw new Error(`Facebook API error: ${error.error.message} (code: ${error.error.code})`);
    }

    const data = await response.json() as FacebookFeedResponse;
    return data.id;
  }

  private async schedulePhotoPost(post: Post, page: SocialPage, scheduledTimestamp: number, media: Media): Promise<string> {
    // Use original URL - Facebook handles the cropping
    const photoUrl = media.originalUrl;

    const params = new URLSearchParams({
      access_token: page.accessToken!,
      message: post.content,
      url: photoUrl,
      published: '0',
      scheduled_publish_time: scheduledTimestamp.toString(),
    });

    const url = `${this.baseUrl}/${page.pageId}/photos?${params.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json() as FacebookError;
      throw new Error(`Facebook API error: ${error.error.message} (code: ${error.error.code})`);
    }

    const data = await response.json() as FacebookPhotoResponse;
    return data.post_id || data.id;
  }

  private async publishStory(post: Post, page: SocialPage, media: Media): Promise<string> {
    if (media.type === 'video') {
      return this.publishVideoStory(post, page, media);
    }

    // Stories require a 2-step process:
    // Step 1: Upload photo as unpublished to get photo_id
    // Step 2: Publish the photo as a story using the photo_id

    let photoUrl = media.originalUrl;

    if (post.content && post.content.trim().length > 0) {
      try {
        const imageWithText = await imageProcessor.addTextToStoryImage(media.originalUrl, post.content);
        photoUrl = await cloudinaryService.uploadStoryImageWithText(imageWithText, `story-${media.id}.png`);
        console.log('Story image with text generated:', photoUrl);
      } catch (error) {
        console.error('Error generating story image with text, using original:', error);
      }
    }

    // Step 1: Upload photo as unpublished
    const uploadParams = new URLSearchParams({
      access_token: page.accessToken!,
      url: photoUrl,
      published: 'false', // Important: must be unpublished first
    });

    const uploadUrl = `${this.baseUrl}/${page.pageId}/photos?${uploadParams.toString()}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json() as FacebookError;
      throw new Error(`Facebook API error uploading photo for story: ${error.error.message} (code: ${error.error.code})`);
    }

    const uploadData = await uploadResponse.json() as FacebookPhotoResponse;
    const photoId = uploadData.id;

    // Step 2: Publish the photo as a story
    const storyParams = new URLSearchParams({
      access_token: page.accessToken!,
      photo_id: photoId,
    });

    const storyUrl = `${this.baseUrl}/${page.pageId}/photo_stories?${storyParams.toString()}`;

    const storyResponse = await fetch(storyUrl, {
      method: 'POST',
    });

    if (!storyResponse.ok) {
      const error = await storyResponse.json() as FacebookError;
      throw new Error(`Facebook API error publishing story: ${error.error.message} (code: ${error.error.code})`);
    }

    const storyData = await storyResponse.json() as { success: boolean; post_id: string };
    return storyData.post_id;
  }

  private async publishVideoStory(post: Post, page: SocialPage, media: Media): Promise<string> {
    // Video stories require a 3-phase upload process:
    // 1. START phase - Initialize the upload and get upload_url
    // 2. UPLOAD phase - Upload the video to upload_url using file_url header
    // 3. FINISH phase - Finalize and publish the story

    const videoUrl = media.originalUrl;
    const accessToken = page.accessToken!;

    // Phase 1: START - Initialize the upload
    const startParams = new URLSearchParams({
      access_token: accessToken,
      upload_phase: 'start',
    });

    const startUrl = `${this.baseUrl}/${page.pageId}/video_stories?${startParams.toString()}`;

    const startResponse = await fetch(startUrl, {
      method: 'POST',
    });

    if (!startResponse.ok) {
      const error = await startResponse.json() as FacebookError;
      throw new Error(`Facebook API error (START phase): ${error.error.message} (code: ${error.error.code})`);
    }

    const startData = await startResponse.json() as { video_id: string; upload_url: string };
    const videoId = startData.video_id;
    const uploadUrl = startData.upload_url;

    // Phase 2: UPLOAD - Upload the video using the upload_url
    // IMPORTANT: file_url must be passed as a header, not a query parameter
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${accessToken}`,
        'file_url': videoUrl,
      },
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Facebook API error (UPLOAD phase): ${errorText}`);
    }

    // Phase 3: FINISH - Finalize and publish the story
    const finishParams = new URLSearchParams({
      access_token: accessToken,
      upload_phase: 'finish',
      video_id: videoId,
    });

    const finishUrl = `${this.baseUrl}/${page.pageId}/video_stories?${finishParams.toString()}`;

    const finishResponse = await fetch(finishUrl, {
      method: 'POST',
    });

    if (!finishResponse.ok) {
      const error = await finishResponse.json() as FacebookError;
      throw new Error(`Facebook API error (FINISH phase): ${error.error.message} (code: ${error.error.code})`);
    }

    const finishData = await finishResponse.json() as { success: boolean; post_id?: string };

    // Return the post_id from the finish response
    return finishData.post_id || videoId;
  }

  /**
   * Publie une vidéo comme Reel Facebook
   * 
   * Utilise l'endpoint /{page-id}/video_reels avec un processus en 3 phases :
   * 1. START - Initialise l'upload et récupère l'upload_url
   * 2. UPLOAD - Upload la vidéo vers rupload.facebook.com
   * 3. FINISH - Finalise et publie le Reel
   * 
   * Spécifications vidéo requises :
   * - Format : MP4, H.264
   * - Ratio : 9:16 (vertical)
   * - Durée : 3-90 secondes
   * - Résolution recommandée : 1080x1920
   * 
   * @param page - Page Facebook cible
   * @param videoUrl - URL de la vidéo à publier
   * @param description - Description du Reel (optionnel)
   * @returns ID du Reel publié
   */
  async publishReel(
    page: SocialPage,
    videoUrl: string,
    description?: string
  ): Promise<string> {
    if (page.platform !== 'facebook') {
      throw new Error('This method only supports Facebook pages');
    }

    if (!page.accessToken) {
      throw new Error('No access token found for this page');
    }

    const accessToken = page.accessToken;

    console.log('🎬 Publishing Reel to Facebook:', {
      pageId: page.pageId,
      pageName: page.pageName,
      hasDescription: !!description,
    });

    // Phase 1: START - Initialize the upload
    const startParams = new URLSearchParams({
      access_token: accessToken,
      upload_phase: 'start',
    });

    const startUrl = `${this.baseUrl}/${page.pageId}/video_reels?${startParams.toString()}`;

    console.log('📤 Phase 1: START - Initializing Reel upload');
    const startResponse = await fetch(startUrl, {
      method: 'POST',
    });

    if (!startResponse.ok) {
      const error = await startResponse.json() as FacebookError;
      throw new Error(`Facebook Reel API error (START phase): ${error.error.message} (code: ${error.error.code})`);
    }

    const startData = await startResponse.json() as { video_id: string; upload_url: string };
    const videoId = startData.video_id;
    const uploadUrl = startData.upload_url;

    console.log('✅ START phase complete, video_id:', videoId);

    // Phase 2: UPLOAD - Upload the video to rupload.facebook.com
    // IMPORTANT: file_url must be passed as a header for URL-based uploads
    console.log('📤 Phase 2: UPLOAD - Uploading video to:', uploadUrl);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${accessToken}`,
        'file_url': videoUrl,
      },
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('❌ UPLOAD phase failed:', errorText);
      throw new Error(`Facebook Reel API error (UPLOAD phase): ${errorText}`);
    }

    console.log('✅ UPLOAD phase complete');

    // Phase 3: FINISH - Finalize and publish the Reel
    const finishParams = new URLSearchParams({
      access_token: accessToken,
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
    });

    // Add description if provided
    if (description) {
      finishParams.append('description', description);
    }

    const finishUrl = `${this.baseUrl}/${page.pageId}/video_reels?${finishParams.toString()}`;

    console.log('📤 Phase 3: FINISH - Publishing Reel');
    const finishResponse = await fetch(finishUrl, {
      method: 'POST',
    });

    if (!finishResponse.ok) {
      const error = await finishResponse.json() as FacebookError;
      throw new Error(`Facebook Reel API error (FINISH phase): ${error.error.message} (code: ${error.error.code})`);
    }

    const finishData = await finishResponse.json() as { success: boolean; post_id?: string };

    if (!finishData.success) {
      throw new Error('Facebook Reel publishing failed - success was false');
    }

    const reelId = finishData.post_id || videoId;
    console.log('✅ Reel published successfully! ID:', reelId);

    return reelId;
  }

  /**
   * Publie une vidéo comme Reel Facebook en uploadant directement les données binaires
   * Utile quand on a la vidéo en base64 (après traitement FFmpeg)
   * 
   * @param page - Page Facebook cible
   * @param videoBuffer - Buffer de la vidéo
   * @param description - Description du Reel (optionnel)
   * @returns ID du Reel publié
   */
  async publishReelFromBuffer(
    page: SocialPage,
    videoBuffer: ArrayBuffer,
    description?: string
  ): Promise<string> {
    if (page.platform !== 'facebook') {
      throw new Error('This method only supports Facebook pages');
    }

    if (!page.accessToken) {
      throw new Error('No access token found for this page');
    }

    const accessToken = page.accessToken;
    const fileSize = videoBuffer.byteLength;

    console.log('🎬 Publishing Reel from buffer:', {
      pageId: page.pageId,
      fileSize: `${(fileSize / 1024 / 1024).toFixed(2)} MB`,
    });

    // Phase 1: START
    const startParams = new URLSearchParams({
      access_token: accessToken,
      upload_phase: 'start',
    });

    const startUrl = `${this.baseUrl}/${page.pageId}/video_reels?${startParams.toString()}`;

    const startResponse = await fetch(startUrl, {
      method: 'POST',
    });

    if (!startResponse.ok) {
      const error = await startResponse.json() as FacebookError;
      throw new Error(`Facebook Reel API error (START phase): ${error.error.message} (code: ${error.error.code})`);
    }

    const startData = await startResponse.json() as { video_id: string; upload_url: string };
    const videoId = startData.video_id;
    const uploadUrl = startData.upload_url;

    // Phase 2: UPLOAD - Upload binary data directly
    const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'offset': '0',
        'file_size': fileSize.toString(),
      },
      body: videoBlob,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Facebook Reel API error (UPLOAD phase): ${errorText}`);
    }

    // Phase 3: FINISH
    const finishParams = new URLSearchParams({
      access_token: accessToken,
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
    });

    if (description) {
      finishParams.append('description', description);
    }

    const finishUrl = `${this.baseUrl}/${page.pageId}/video_reels?${finishParams.toString()}`;

    const finishResponse = await fetch(finishUrl, {
      method: 'POST',
    });

    if (!finishResponse.ok) {
      const error = await finishResponse.json() as FacebookError;
      throw new Error(`Facebook Reel API error (FINISH phase): ${error.error.message} (code: ${error.error.code})`);
    }

    const finishData = await finishResponse.json() as { success: boolean; post_id?: string };

    return finishData.post_id || videoId;
  }
}

export const facebookService = new FacebookService();

