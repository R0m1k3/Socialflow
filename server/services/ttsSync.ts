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
    const cleanTtsText = this.cleanForTts(text);
    const cleanDisplayText = this.cleanForDisplay(text);

    // 1. Générer le TTS preview et mesurer sa durée exacte
    const ttsResult = await ffmpegService.previewTTS(cleanTtsText, voice);
    if (!ttsResult.success || !ttsResult.audioBase64) {
      throw new Error('TTS preview failed: ' + (ttsResult.error || 'unknown'));
    }

    const audioBuffer = Buffer.from(ttsResult.audioBase64, 'base64');
    const metadata = await musicMetadata.parseBuffer(audioBuffer, 'audio/mpeg');
    const audioDuration = metadata.format.duration || 0;

    // 2. Analyser le texte
    const words = cleanDisplayText.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    const punctuationPause = this.calculatePunctuationPauses(cleanDisplayText);

    // 3. Calculer le word_duration ajusté
    const effectiveDuration = Math.max(audioDuration - punctuationPause, 0.5);
    const wordDuration = wordCount > 0 ? effectiveDuration / wordCount : 0.6;

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
      punctuationPause,
      isHealthy,
      warnings,
    };
  }

  private cleanForTts(text: string): string {
    return text
      .replace(/#\w+/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[\uD83C-\uD83E][\uDC00-\uDFFF]|[☀-⛿✀-➿]/g, '')
      .trim();
  }

  private cleanForDisplay(text: string): string {
    return text.trim();
  }

  private calculatePunctuationPauses(text: string): number {
    let pause = 0;
    const chars = text.split('');
    for (const c of chars) {
      if (',;'.includes(c)) pause += 0.3;
      else if ('.!?'.includes(c)) pause += 0.6;
      else if (':'.includes(c)) pause += 0.4;
      else if (c === '\n') pause += 0.3;
    }
    // "..." compte comme un seul point mais pause plus longue
    const ellipsisCount = (text.match(/\.\.\./g) || []).length;
    pause += ellipsisCount * 0.3; // bonus pour les points de suspension
    return pause;
  }
}

export const ttsSyncService = new TtsSyncService();
