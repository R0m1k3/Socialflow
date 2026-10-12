//! Horodatages.
//!
//! Les colonnes sont des `timestamp` sans fuseau qui contiennent de l'UTC
//! (l'ancien serveur tournait en UTC dans Docker). On les expose au navigateur
//! comme le faisait `JSON.stringify(new Date())` : `2024-05-01T08:30:00.000Z`.

use std::fmt;

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, sqlx::Type)]
#[sqlx(transparent)]
pub struct Ts(pub NaiveDateTime);

impl Ts {
    pub fn now() -> Self {
        // Précision milliseconde, comme une Date JavaScript
        let now = Utc::now().naive_utc();
        Ts(now - Duration::nanoseconds(now.and_utc().timestamp_subsec_nanos() as i64 % 1_000_000))
    }

    pub fn from_utc(dt: DateTime<Utc>) -> Self {
        Ts(dt.naive_utc())
    }

    pub fn utc(self) -> DateTime<Utc> {
        self.0.and_utc()
    }

    pub fn to_iso(self) -> String {
        self.0.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    }

    pub fn timestamp_millis(self) -> i64 {
        self.0.and_utc().timestamp_millis()
    }

    pub fn from_millis(ms: i64) -> Option<Self> {
        DateTime::<Utc>::from_timestamp_millis(ms).map(Ts::from_utc)
    }

    pub fn add(self, d: Duration) -> Self {
        Ts(self.0 + d)
    }

    /// Équivalent de `new Date(value)` pour les formats envoyés par le client :
    /// ISO 8601 avec ou sans fuseau (sans fuseau = UTC, l'heure du conteneur),
    /// date seule, ou nombre de millisecondes.
    pub fn parse(value: &str) -> Option<Self> {
        parse_js_date(value)
    }
}

impl fmt::Display for Ts {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_iso())
    }
}

impl Serialize for Ts {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_iso())
    }
}

impl<'de> Deserialize<'de> for Ts {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        match &value {
            serde_json::Value::String(s) => parse_js_date(s)
                .ok_or_else(|| serde::de::Error::custom(format!("date invalide : {s}"))),
            serde_json::Value::Number(n) => n
                .as_i64()
                .or_else(|| n.as_f64().map(|f| f as i64))
                .and_then(Ts::from_millis)
                .ok_or_else(|| serde::de::Error::custom("date invalide")),
            _ => Err(serde::de::Error::custom("date invalide")),
        }
    }
}

impl From<NaiveDateTime> for Ts {
    fn from(value: NaiveDateTime) -> Self {
        Ts(value)
    }
}

impl From<DateTime<Utc>> for Ts {
    fn from(value: DateTime<Utc>) -> Self {
        Ts::from_utc(value)
    }
}

pub fn parse_js_date(value: &str) -> Option<Ts> {
    let s = value.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(Ts::from_utc(dt.with_timezone(&Utc)));
    }
    // Variantes ISO tolérées par Date.parse : décalage sans « : », espace au lieu de « T »
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f%z",
        "%Y-%m-%d %H:%M:%S%.f%z",
        "%Y-%m-%dT%H:%M%z",
    ] {
        if let Ok(dt) = DateTime::parse_from_str(s, fmt) {
            return Some(Ts::from_utc(dt.with_timezone(&Utc)));
        }
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(Ts(dt));
        }
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return d.and_hms_opt(0, 0, 0).map(Ts);
    }
    if let Ok(dt) = DateTime::parse_from_rfc2822(s) {
        return Some(Ts::from_utc(dt.with_timezone(&Utc)));
    }
    if let Ok(ms) = s.parse::<i64>() {
        return Ts::from_millis(ms);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_round_trip() {
        let ts = parse_js_date("2024-05-01T08:30:00.123Z").unwrap();
        assert_eq!(ts.to_iso(), "2024-05-01T08:30:00.123Z");
    }

    #[test]
    fn offsets_are_converted_to_utc() {
        let ts = parse_js_date("2024-05-01T10:30:00+02:00").unwrap();
        assert_eq!(ts.to_iso(), "2024-05-01T08:30:00.000Z");
    }

    #[test]
    fn naive_and_date_only() {
        assert_eq!(
            parse_js_date("2024-05-01T08:30").unwrap().to_iso(),
            "2024-05-01T08:30:00.000Z"
        );
        assert_eq!(
            parse_js_date("2024-05-01").unwrap().to_iso(),
            "2024-05-01T00:00:00.000Z"
        );
        assert!(parse_js_date("pas une date").is_none());
    }
}
