import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// Chemin du fichier de clé - utilise le volume Docker si disponible, sinon le répertoire courant
const KEY_DIR = fs.existsSync('/app/.encryption-key-data')
  ? '/app/.encryption-key-data'
  : process.cwd();
const KEY_FILE_PATH = path.join(KEY_DIR, '.encryption-key');

// Cache de la clé pour éviter de lire le fichier à chaque appel
let cachedKey: Buffer | null = null;
let keyInitialized = false;

/**
 * Génère une clé de chiffrement aléatoire et la sauvegarde dans un fichier.
 * @returns La clé générée
 */
function generateAndSaveKey(): Buffer {
  const randomKey = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(KEY_FILE_PATH, randomKey, { mode: 0o600 }); // Permissions restrictives
    console.log('🔐 Nouvelle clé de chiffrement générée et sauvegardée automatiquement');
  } catch (error) {
    console.warn('⚠️ Impossible de sauvegarder la clé de chiffrement dans un fichier. Elle sera régénérée au prochain redémarrage.');
  }
  return crypto.scryptSync(randomKey, 'socialflow-salt', 32);
}

/**
 * Charge la clé depuis le fichier persistant si elle existe.
 * @returns La clé ou null si non trouvée
 */
function loadKeyFromFile(): Buffer | null {
  try {
    if (fs.existsSync(KEY_FILE_PATH)) {
      const savedKey = fs.readFileSync(KEY_FILE_PATH, 'utf8').trim();
      if (savedKey) {
        console.log('🔐 Clé de chiffrement chargée depuis le fichier persistant');
        return crypto.scryptSync(savedKey, 'socialflow-salt', 32);
      }
    }
  } catch (error) {
    console.warn('⚠️ Impossible de lire le fichier de clé de chiffrement');
  }
  return null;
}

/**
 * Récupère la clé de chiffrement.
 * Priorité: 1) Variable d'environnement, 2) Fichier persistant, 3) Génération auto
 */
function getEncryptionKey(): Buffer {
  // Retourner la clé en cache si déjà initialisée
  if (keyInitialized && cachedKey) {
    return cachedKey;
  }

  // 1. Priorité à la variable d'environnement
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    cachedKey = crypto.scryptSync(envKey, 'socialflow-salt', 32);
    keyInitialized = true;
    return cachedKey;
  }

  // 2. Essayer de charger depuis le fichier persistant
  const fileKey = loadKeyFromFile();
  if (fileKey) {
    cachedKey = fileKey;
    keyInitialized = true;
    return cachedKey;
  }

  // 3. Générer automatiquement une nouvelle clé et la sauvegarder
  cachedKey = generateAndSaveKey();
  keyInitialized = true;
  return cachedKey;
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
