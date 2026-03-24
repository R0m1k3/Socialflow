import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { storage } from '../storage';
import fs from 'fs';
import path from 'path';

function getS3Client(accessKey: string, secretKey: string): S3Client {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    region: 'us-east-1',
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
}

/**
 * Builds the public URL for a stored object.
 * MINIO_PUBLIC_URL = public-facing base (e.g. https://media.example.com)
 * Object URL = ${MINIO_PUBLIC_URL}/${bucketName}/${objectKey}
 */
export function buildMinioUrl(bucketName: string, objectKey: string): string {
  const base = (process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT || 'http://localhost:9000').replace(/\/$/, '');
  return `${base}/${bucketName}/${objectKey}`;
}

class MinioService {
  async uploadMedia(
    file: Buffer | string,
    fileName: string,
    _userId: string,
    mimeType: string
  ): Promise<{
    publicId: string;
    originalUrl: string;
    facebookFeedUrl: string | null;
    instagramFeedUrl: string | null;
    instagramStoryUrl: string | null;
  }> {
    const config = await storage.getCloudinaryConfig();
    if (!config) throw new Error('MinIO non configuré. Veuillez configurer le stockage dans les Paramètres.');

    const client = getS3Client(config.apiKey, config.apiSecret);
    const bucket = config.cloudName;
    const safeName = path.basename(fileName).replace(/\s+/g, '-');
    const objectKey = `social-flow/${Date.now()}-${safeName}`;

    const body: Buffer = typeof file === 'string' ? fs.readFileSync(file) : file;

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: body,
      ContentType: mimeType,
    }));

    const url = buildMinioUrl(bucket, objectKey);
    return { publicId: objectKey, originalUrl: url, facebookFeedUrl: url, instagramFeedUrl: url, instagramStoryUrl: url };
  }

  async deleteMedia(publicId: string, _userId: string, _mediaType: 'image' | 'video'): Promise<void> {
    const config = await storage.getCloudinaryConfig();
    if (!config) throw new Error('MinIO non configuré.');

    const client = getS3Client(config.apiKey, config.apiSecret);
    await client.send(new DeleteObjectCommand({ Bucket: config.cloudName, Key: publicId }));
  }

  async uploadStoryImageWithText(buffer: Buffer, originalFileName: string): Promise<string> {
    const config = await storage.getCloudinaryConfig();
    if (!config) throw new Error('MinIO non configuré.');

    const client = getS3Client(config.apiKey, config.apiSecret);
    const safeName = path.basename(originalFileName).replace(/\s+/g, '-');
    const objectKey = `social-flow/stories/story-${Date.now()}-${safeName}`;

    await client.send(new PutObjectCommand({
      Bucket: config.cloudName,
      Key: objectKey,
      Body: buffer,
      ContentType: 'image/jpeg',
    }));

    return buildMinioUrl(config.cloudName, objectKey);
  }

  async uploadLogo(buffer: Buffer, fileName: string): Promise<{ publicId: string; url: string }> {
    const config = await storage.getCloudinaryConfig();
    if (!config) throw new Error('MinIO non configuré.');

    const client = getS3Client(config.apiKey, config.apiSecret);
    const ext = path.extname(fileName) || '.png';
    const objectKey = `social-flow/logos/logo-${Date.now()}${ext}`;

    await client.send(new PutObjectCommand({
      Bucket: config.cloudName,
      Key: objectKey,
      Body: buffer,
      ContentType: fileName.match(/\.png$/i) ? 'image/png' : 'image/jpeg',
    }));

    return { publicId: objectKey, url: buildMinioUrl(config.cloudName, objectKey) };
  }

  async deleteLogo(publicId: string): Promise<void> {
    const config = await storage.getCloudinaryConfig();
    if (!config) throw new Error('MinIO non configuré.');

    const client = getS3Client(config.apiKey, config.apiSecret);
    await client.send(new DeleteObjectCommand({ Bucket: config.cloudName, Key: publicId }));
  }
}

export const minioService = new MinioService();
