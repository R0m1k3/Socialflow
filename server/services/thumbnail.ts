/**
 * Génération de vignettes vidéo.
 *
 * Les vidéos sources sont supprimées du disque une fois publiées (le
 * planificateur libère la place, la purge quotidienne fait le reste), alors que
 * la ligne `media` survit pour l'historique. Sans vignette persistée, l'interface
 * tente alors de lire un fichier disparu : d'où les « Video thumbnail generation
 * failed » et les tuiles vides.
 *
 * On extrait donc une image au moment de la création du média, et elle reste
 * disponible après la disparition de la vidéo.
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { minioService } from './minio';

const execAsync = promisify(exec);

const TEMP_DIR = path.join(process.cwd(), 'uploads', 'temp');

/**
 * Extrait une image d'une vidéo avec FFmpeg.
 *
 * @param videoPath chemin du fichier vidéo
 * @param outputPath chemin de l'image à écrire
 * @param seekTime instant de la capture, en secondes
 * @returns true si l'image a bien été écrite
 */
export async function generateVideoThumbnail(
  videoPath: string,
  outputPath: string,
  seekTime: number = 1
): Promise<boolean> {
  try {
    const cmd = `ffmpeg -y -ss ${seekTime} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`;
    await execAsync(cmd);
    return fs.existsSync(outputPath);
  } catch (error) {
    console.warn('⚠️ Failed to generate video thumbnail:', error);
    return false;
  }
}

/**
 * Produit la vignette d'une vidéo et la range dans le stockage public.
 *
 * Tolérante à l'échec : une vignette manquante dégrade l'affichage mais ne doit
 * jamais faire échouer une publication.
 *
 * @param source chemin du fichier vidéo, ou son contenu en mémoire
 * @returns l'URL publique de la vignette, ou null si l'extraction a échoué
 */
export async function createVideoThumbnail(source: string | Buffer): Promise<string | null> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const outputPath = path.join(TEMP_DIR, `thumb-${stamp}.jpg`);

  // Une vidéo reçue en mémoire doit d'abord être posée sur le disque pour FFmpeg
  let videoPath: string;
  let tempVideoPath: string | null = null;

  try {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    if (Buffer.isBuffer(source)) {
      tempVideoPath = path.join(TEMP_DIR, `thumb-src-${stamp}.mp4`);
      await fs.promises.writeFile(tempVideoPath, source);
      videoPath = tempVideoPath;
    } else {
      videoPath = source;
      if (!fs.existsSync(videoPath)) {
        console.warn(`⚠️ [Thumbnail] Vidéo introuvable pour la vignette : ${videoPath}`);
        return null;
      }
    }

    const ok = await generateVideoThumbnail(videoPath, outputPath);
    if (!ok) return null;

    const buffer = await fs.promises.readFile(outputPath);
    const { url } = await minioService.uploadThumbnail(buffer, `thumb-${stamp}.jpg`);

    console.log(`🖼️ [Thumbnail] Vignette générée : ${url}`);
    return url;
  } catch (error) {
    console.warn('⚠️ [Thumbnail] Génération de la vignette impossible :', error);
    return null;
  } finally {
    for (const file of [outputPath, tempVideoPath]) {
      if (file) {
        await fs.promises.unlink(file).catch(() => { /* déjà absent */ });
      }
    }
  }
}
