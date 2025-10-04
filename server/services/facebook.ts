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

  async publishPost(post: Post, page: SocialPage, postType: string, media?: Media): Promise<string> {
    if (page.platform !== 'facebook') {
      throw new Error('This service only supports Facebook pages');
    }

    if (!page.accessToken) {
      throw new Error('No access token found for this page');
    }

    // If there's media, publish as photo post, otherwise as text post
    if (media) {
      return await this.publishPhotoPost(post, page, media);
    } else {
      return await this.publishTextPost(post, page);
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
}

export const facebookService = new FacebookService();
