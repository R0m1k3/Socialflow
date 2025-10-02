import { v2 as cloudinary } from 'cloudinary';
import { storage } from '../storage';

class CloudinaryService {
  async uploadMedia(
    buffer: Buffer,
    fileName: string,
    userId: string,
    mimeType: string
  ): Promise<{
    publicId: string;
    originalUrl: string;
    facebookFeedUrl: string | null;
    instagramFeedUrl: string | null;
    instagramStoryUrl: string | null;
  }> {
    // Get user's Cloudinary config
    const config = await storage.getCloudinaryConfig(userId);
    
    if (!config) {
      throw new Error('Cloudinary configuration not found. Please configure Cloudinary in Settings.');
    }

    // Configure Cloudinary with user's credentials
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });

    const isVideo = mimeType.startsWith('video/');

    // Upload to Cloudinary (without eager transformations)
    const uploadResult = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'social-flow',
          public_id: `${Date.now()}-${fileName.replace(/\.[^/.]+$/, '')}`,
          resource_type: isVideo ? 'video' : 'image',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      uploadStream.end(buffer);
    });

    const publicId = uploadResult.public_id;
    const originalUrl = uploadResult.secure_url;

    // For now, use the original URL for all formats - no transformations
    // The frontend will handle display with CSS to prevent cropping
    let facebookFeedUrl = null;
    let instagramFeedUrl = null;
    let instagramStoryUrl = null;

    if (!isVideo) {
      // Use original image for all formats - NO CROPPING
      facebookFeedUrl = originalUrl;
      instagramFeedUrl = originalUrl;
      instagramStoryUrl = originalUrl;
    }

    return {
      publicId,
      originalUrl,
      facebookFeedUrl,
      instagramFeedUrl,
      instagramStoryUrl,
    };
  }

  async deleteMedia(publicId: string, userId: string, mediaType: 'image' | 'video'): Promise<void> {
    const config = await storage.getCloudinaryConfig(userId);
    
    if (!config) {
      throw new Error('Cloudinary configuration not found');
    }

    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });

    await cloudinary.uploader.destroy(publicId, {
      resource_type: mediaType,
    });
  }
}

export const cloudinaryService = new CloudinaryService();
