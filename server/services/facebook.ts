import { storage } from '../storage';
import type { Post, SocialPage, Media } from '@shared/schema';

interface FacebookPhotoResponse {
  id: string;
  post_id: string;
}

interface FacebookFeedResponse {
  id: string;
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
      // Publish as story only
      if (mediaList.length === 0) {
        throw new Error('Stories require media (photo or video)');
      }
      return await this.publishStory(post, page, mediaList[0]);
    } else {
      // Default to feed
      // Count images only (videos not supported in multi-photo carousel)
      const imageMedia = mediaList.filter(m => m.type === 'image');
      
      if (imageMedia.length > 1) {
        // Multi-photo carousel (images only)
        return await this.publishMultiPhotoPost(post, page, mediaList);
      } else if (imageMedia.length === 1) {
        // Single image (even if mixed with videos, prioritize the image)
        return await this.publishPhotoPost(post, page, imageMedia[0]);
      } else if (mediaList.length >= 1) {
        // No images, but has media (likely video) - publish first media
        // Note: Facebook /photos endpoint doesn't support videos well, this may fail
        console.warn(`Publishing non-image media to Facebook feed - this may fail`);
        return await this.publishPhotoPost(post, page, mediaList[0]);
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
    // Use the Facebook Feed optimized URL (1200x630)
    const photoUrl = media.facebookFeedUrl || media.originalUrl;

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
      const photoUrl = media.facebookFeedUrl || media.originalUrl;
      
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
    const photoUrl = media.facebookFeedUrl || media.originalUrl;

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
    // Use vertical format for stories (Instagram Story URL 1080x1920)
    const photoUrl = media.instagramStoryUrl || media.originalUrl;

    const params = new URLSearchParams({
      access_token: page.accessToken!,
      url: photoUrl,
    });

    const url = `${this.baseUrl}/${page.pageId}/photo_stories?${params.toString()}`;

    const response = await fetch(url, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json() as FacebookError;
      throw new Error(`Facebook API error: ${error.error.message} (code: ${error.error.code})`);
    }

    const data = await response.json() as FacebookPhotoResponse;
    return data.id;
  }
}

export const facebookService = new FacebookService();
