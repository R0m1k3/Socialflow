//! Requêtes HTTP sortantes vers des URL fournies par les utilisateurs,
//! protégées contre la SSRF : seules les adresses publiques sont joignables.
//!
//! Les noms d'hôte passent par un résolveur qui refuse toute adresse non
//! publique : chaque connexion (redirections et « DNS rebinding » compris)
//! est contrôlée au moment où son adresse est choisie. Les IP littérales sont
//! contrôlées d'emblée et à chaque redirection.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use ipnet::IpNet;
use once_cell::sync::Lazy;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use url::Url;

#[derive(Debug)]
pub enum UrlError {
    Invalid,
    Scheme,
    Blocked(String),
    Resolve,
}

impl std::fmt::Display for UrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UrlError::Invalid => write!(f, "URL invalide"),
            UrlError::Scheme => write!(f, "schéma d'URL non pris en charge"),
            UrlError::Blocked(h) => write!(f, "adresse non publique refusée : {h}"),
            UrlError::Resolve => write!(f, "résolution du nom d'hôte impossible"),
        }
    }
}

impl std::error::Error for UrlError {}

static EXTRA_BLOCKED: Lazy<Vec<IpNet>> = Lazy::new(|| {
    [
        "192.0.0.0/24",   // affectations IETF
        "198.18.0.0/15",  // bancs d'essai
        "240.0.0.0/4",    // réservé + diffusion
        "0.0.0.0/8",      // « ce réseau »
        "100.64.0.0/10",  // CGNAT
        "::/96",          // IPv4-compatible (obsolète)
        "64:ff9b::/96",   // NAT64
        "64:ff9b:1::/48", // NAT64 local
        "2002::/16",      // 6to4
        "2001::/32",      // Teredo
        "100::/64",       // discard-only
        "fc00::/7",       // unique local
        "fe80::/10",      // lien local
        "ff00::/8",       // multicast
    ]
    .iter()
    .map(|s| s.parse().expect("préfixe valide"))
    .collect()
});

/// Adresse privée, locale, de lien local, non spécifiée ou autrement interdite.
pub fn is_disallowed_ip(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => IpAddr::V6(v6),
        },
        v4 => v4,
    };
    let basic = match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_unspecified()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
        }
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || v6.is_multicast(),
    };
    basic || EXTRA_BLOCKED.iter().any(|net| net.contains(&ip))
}

/// Analyse `raw`, impose http(s) et refuse les IP littérales non publiques.
/// Les noms d'hôte sont contrôlés à la résolution (voir [`client`]).
pub fn check_url(raw: &str) -> Result<Url, UrlError> {
    let u = Url::parse(raw.trim()).map_err(|_| UrlError::Invalid)?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return Err(UrlError::Scheme);
    }
    match u.host() {
        None => Err(UrlError::Invalid),
        Some(url::Host::Ipv4(ip)) if is_disallowed_ip(IpAddr::V4(ip)) => {
            Err(UrlError::Blocked(ip.to_string()))
        }
        Some(url::Host::Ipv6(ip)) if is_disallowed_ip(IpAddr::V6(ip)) => {
            Err(UrlError::Blocked(ip.to_string()))
        }
        Some(_) => Ok(u),
    }
}

/// Résolveur qui échoue dès qu'une adresse de l'hôte n'est pas publique.
struct PublicResolver;

impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0))
                .await
                .map_err(|_| {
                    Box::new(UrlError::Resolve) as Box<dyn std::error::Error + Send + Sync>
                })?
                .collect();
            if addrs.is_empty() || addrs.iter().any(|a| is_disallowed_ip(a.ip())) {
                return Err(
                    Box::new(UrlError::Blocked(host)) as Box<dyn std::error::Error + Send + Sync>
                );
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// Client partagé, durci contre la SSRF.
pub fn client() -> &'static reqwest::Client {
    static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
        let redirect = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("trop de redirections");
            }
            match check_url(attempt.url().as_str()) {
                Ok(_) => attempt.follow(),
                Err(e) => attempt.error(e),
            }
        });
        reqwest::Client::builder()
            .user_agent("SocialFlow/2.0")
            .connect_timeout(Duration::from_secs(30))
            .redirect(redirect)
            // Un proxy résoudrait lui-même les noms et contournerait le contrôle
            .no_proxy()
            .dns_resolver(Arc::new(PublicResolver))
            .build()
            .expect("construction du client HTTP")
    });
    &CLIENT
}

/// Requête GET vers une URL fournie par un utilisateur.
pub async fn get(raw: &str) -> anyhow::Result<reqwest::Response> {
    let url = check_url(raw)?;
    Ok(client().get(url).send().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_internal_addresses() {
        for s in [
            "127.0.0.1",
            "10.1.2.3",
            "172.18.0.2",
            "192.168.1.1",
            "169.254.169.254",
            "::1",
            "64:ff9b::a00:1",
            "2002:a00:1::1",
            "198.18.0.1",
            "100.64.0.1",
            "::ffff:127.0.0.1",
            "fd00::1",
        ] {
            assert!(
                is_disallowed_ip(s.parse().unwrap()),
                "{s} devrait être refusée"
            );
        }
        for s in ["1.1.1.1", "2606:4700:4700::1111"] {
            assert!(
                !is_disallowed_ip(s.parse().unwrap()),
                "{s} devrait être acceptée"
            );
        }
    }

    #[test]
    fn check_url_rejects_bad_targets() {
        assert!(check_url("ftp://example.org/").is_err());
        assert!(check_url("file:///etc/passwd").is_err());
        assert!(check_url("http://127.0.0.1/").is_err());
        assert!(check_url("http://[::1]/").is_err());
        assert!(check_url("https://example.org/image.jpg").is_ok());
    }
}
