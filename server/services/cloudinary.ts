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

    // Upload to Cloudinary
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

    // Generate transformation URLs only for images
    let facebookFeedUrl = null;
    let instagramFeedUrl = null;
    let instagramStoryUrl = null;

    if (!isVideo) {
      facebookFeedUrl = cloudinary.url(publicId, {
        transformation: [
          { width: 1200, height: 630, crop: 'fill', gravity: 'auto' }
        ]
      });
      instagramFeedUrl = cloudinary.url(publicId, {
        transformation: [
          { width: 1080, height: 1080, crop: 'fill', gravity: 'auto' }
        ]
      });
      instagramStoryUrl = cloudinary.url(publicId, {
        transformation: [
          { width: 1080, height: 1920, crop: 'fill', gravity: 'auto' }
        ]
      });
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
