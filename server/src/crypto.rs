//! Chiffrement des jetons au repos (AES-256-GCM), compatible avec les valeurs
//! déjà écrites par l'ancien serveur : clé dérivée par scrypt du secret
//! (`ENCRYPTION_KEY`, sinon fichier persistant), IV de 16 octets, format
//! `iv:authTag:chiffré` en hexadécimal.

use std::path::{Path, PathBuf};

use aes_gcm::aead::consts::U16;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::aes::Aes256;
use aes_gcm::{AesGcm, Nonce};
use once_cell::sync::OnceCell;
use rand::RngCore;

use crate::config::Config;

type Cipher = AesGcm<Aes256, U16>;

static KEY: OnceCell<[u8; 32]> = OnceCell::new();

const SALT: &[u8] = b"socialflow-salt";
const DOCKER_KEY_DIR: &str = "/app/.encryption-key-data";

fn derive(secret: &str) -> [u8; 32] {
    // Paramètres par défaut de crypto.scryptSync : N=16384, r=8, p=1
    let params = scrypt::Params::new(14, 8, 1, 32).expect("paramètres scrypt valides");
    let mut out = [0u8; 32];
    scrypt::scrypt(secret.as_bytes(), SALT, &params, &mut out).expect("dérivation scrypt");
    out
}

fn key_file_path() -> PathBuf {
    let dir = if Path::new(DOCKER_KEY_DIR).exists() {
        PathBuf::from(DOCKER_KEY_DIR)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    dir.join(".encryption-key")
}

/// Charge (ou crée) la clé de chiffrement. Appelé une fois au démarrage.
pub fn init(_config: &Config) {
    KEY.get_or_init(load_key);
}

fn load_key() -> [u8; 32] {
    if let Some(secret) = Config::var("ENCRYPTION_KEY") {
        return derive(&secret);
    }

    let path = key_file_path();
    if let Ok(saved) = std::fs::read_to_string(&path) {
        let saved = saved.trim();
        if !saved.is_empty() {
            tracing::info!("🔐 Clé de chiffrement chargée depuis le fichier persistant");
            return derive(saved);
        }
    }

    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret = hex::encode(bytes);
    match write_private(&path, &secret) {
        Ok(()) => tracing::info!("🔐 Nouvelle clé de chiffrement générée et sauvegardée automatiquement"),
        Err(_) => tracing::warn!(
            "⚠️ Impossible de sauvegarder la clé de chiffrement dans un fichier. Elle sera régénérée au prochain redémarrage."
        ),
    }
    derive(&secret)
}

fn write_private(path: &Path, content: &str) -> std::io::Result<()> {
    std::fs::write(path, content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn key() -> &'static [u8; 32] {
    KEY.get_or_init(load_key)
}

pub fn encrypt(text: &str) -> String {
    let cipher = Cipher::new_from_slice(key()).expect("clé de 32 octets");
    let mut iv = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut iv);
    let sealed = cipher
        .encrypt(
            Nonce::<U16>::from_slice(&iv),
            Payload {
                msg: text.as_bytes(),
                aad: &[],
            },
        )
        .expect("chiffrement AES-GCM");
    // `sealed` = chiffré || tag (16 octets)
    let (ciphertext, tag) = sealed.split_at(sealed.len() - 16);
    format!(
        "{}:{}:{}",
        hex::encode(iv),
        hex::encode(tag),
        hex::encode(ciphertext)
    )
}

/// Déchiffre ; une valeur qui n'a pas le format attendu (jeton enregistré en
/// clair avant le chiffrement) est rendue telle quelle.
pub fn decrypt(value: &str) -> String {
    if !value.contains(':') {
        return value.to_string();
    }
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 3 {
        return value.to_string();
    }
    let attempt = || -> Option<String> {
        let iv = hex::decode(parts[0]).ok()?;
        let tag = hex::decode(parts[1]).ok()?;
        let mut data = hex::decode(parts[2]).ok()?;
        if iv.len() != 16 || tag.len() != 16 {
            return None;
        }
        data.extend_from_slice(&tag);
        let cipher = Cipher::new_from_slice(key()).ok()?;
        let plain = cipher
            .decrypt(
                Nonce::<U16>::from_slice(&iv),
                Payload {
                    msg: &data,
                    aad: &[],
                },
            )
            .ok()?;
        String::from_utf8(plain).ok()
    };
    match attempt() {
        Some(plain) => plain,
        None => {
            tracing::warn!("⚠️ Échec du déchiffrement, token probablement non chiffré");
            value.to_string()
        }
    }
}

#[allow(dead_code)]
pub fn is_encrypted(text: &str) -> bool {
    let parts: Vec<&str> = text.split(':').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let _ = KEY.set(derive("test-secret"));
        let sealed = encrypt("EAAB-token");
        assert!(is_encrypted(&sealed));
        assert_eq!(decrypt(&sealed), "EAAB-token");
        assert_eq!(decrypt("plain-token"), "plain-token");
        // Valeur chiffrée par l'ancien serveur Node avec la même clé
        assert_eq!(
            decrypt("b313bfc2eec1a7b8c9743a580c75561b:348a147444c5ef2ee708e5b8bb72d5d0:aebf8e28c21928d5ad207d48d210f4"),
            "EAAB-node-token"
        );
    }
}
