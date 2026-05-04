import { ffmpegService } from './ffmpeg';
import * as musicMetadata from 'music-metadata';

export interface SyncTiming {
  wordDuration: number;
  audioDuration: number;
  wordCount: number;
  punctuationPause: number;
  isHealthy: boolean;
  warnings: string[];
}

export class TtsSyncService {
  /**
   * Calcule le word_duration optimal pour synchroniser l'affichage du texte
   * avec la durée réelle de la voix TTS générée.
   */
  async calculateSyncTiming(text: string, voice: string): Promise<SyncTiming> {
    const cleanText = this.cleanText(text);

    // 1. Générer le TTS preview et mesurer sa durée exacte
    const ttsResult = await ffmpegService.previewTTS(cleanText, voice);
    if (!ttsResult.success || !ttsResult.audioBase64) {
      throw new Error('TTS preview failed: ' + (ttsResult.error || 'unknown'));
    }

    const audioBuffer = Buffer.from(ttsResult.audioBase64, 'base64');
    const metadata = await musicMetadata.parseBuffer(audioBuffer, 'audio/mpeg');
    const audioDuration = metadata.format.duration || 0;

    // 2. Analyser le texte (compte les mots réellement lus par la voix)
    const wordCount = this.calculateWordCount(cleanText);

    // 3. Calculer le word_duration
    const wordDuration = wordCount > 0 ? audioDuration / wordCount : 0.6;

    // 4. Validation
    const warnings: string[] = [];
    const isHealthy = wordDuration >= 0.25 && wordDuration <= 1.5;
    if (wordDuration < 0.25) {
      warnings.push('Texte trop long : les mots défileront très vite. Envisagez de raccourcir.');
    }
    if (wordDuration > 1.2) {
      warnings.push('Texte très court : affichage lent.');
    }

    return {
      wordDuration,
      audioDuration,
      wordCount,
      punctuationPause: 0,
      isHealthy,
      warnings,
    };
  }

  private cleanText(text: string): string {
    return text
      .replace(/#\w+/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]|[☀-⛿✀-➿]/g, '')
      .trim();
  }

  private calculateWordCount(text: string): number {
    const tokens = text.split(/\s+/).filter(w => w.length > 0);
    return tokens.filter(w => /[a-zA-Z0-9À-ſ]/.test(w)).length;
  }
}

export const ttsSyncService = new TtsSyncService();
