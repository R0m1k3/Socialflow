import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Récupère la clé de chiffrement depuis les variables d'environnement.
 * Dérive une clé de 32 bytes pour AES-256.
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // En développement, utiliser une clé par défaut (non sécurisé pour la production)
    if (process.env.NODE_ENV !== 'production') {
      console.warn('⚠️ ENCRYPTION_KEY non défini. Utilisation d\'une clé par défaut (développement uniquement)');
      return crypto.scryptSync('dev-default-key-not-secure', 'salt', 32);
    }
    throw new Error('ENCRYPTION_KEY non défini dans les variables d\'environnement');
  }
  // Dériver une clé de 32 bytes depuis la clé fournie
  return crypto.scryptSync(key, 'socialflow-salt', 32);
}

/**
 * Chiffre une chaîne de texte avec AES-256-GCM.
 * @param text - Le texte à chiffrer
 * @returns Le texte chiffré au format: iv:authTag:encrypted (hex)
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Déchiffre une chaîne chiffrée avec AES-256-GCM.
 * @param encryptedText - Le texte chiffré au format iv:authTag:encrypted
 * @returns Le texte déchiffré
 */
export function decrypt(encryptedText: string): string {
  // Si le texte ne contient pas le format attendu, retourner tel quel
  // (pour la rétrocompatibilité avec les tokens non chiffrés)
  if (!encryptedText.includes(':')) {
    return encryptedText;
  }
  
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');
  
  if (parts.length !== 3) {
    // Format invalide, retourner tel quel (rétrocompatibilité)
    return encryptedText;
  }
  
  const [ivHex, authTagHex, encrypted] = parts;
  
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // Si le déchiffrement échoue, retourner tel quel (rétrocompatibilité)
    console.warn('⚠️ Échec du déchiffrement, token probablement non chiffré');
    return encryptedText;
  }
}

/**
 * Vérifie si un texte est déjà chiffré (format iv:authTag:encrypted).
 * @param text - Le texte à vérifier
 * @returns true si le texte semble être chiffré
 */
export function isEncrypted(text: string): boolean {
  if (!text.includes(':')) return false;
  const parts = text.split(':');
  if (parts.length !== 3) return false;
  // Vérifier que les parties ressemblent à du hex
  return parts.every(part => /^[a-f0-9]+$/i.test(part));
}
