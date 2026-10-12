//! Validation des corps de requête à la manière des schémas zod
//! (`createInsertSchema` de drizzle-zod) : mêmes champs requis, mêmes types et
//! mêmes messages d'erreur (« Required », « Expected string, received number »…).

use serde_json::{json, Value};

use crate::time::Ts;

/// Champ absent (`undefined`), `null` ou présent.
#[derive(Debug, Clone, PartialEq)]
pub enum Field<T> {
    Absent,
    Null,
    Set(T),
}

impl<T> Field<T> {
    pub fn into_option(self) -> Option<T> {
        match self {
            Field::Set(v) => Some(v),
            _ => None,
        }
    }

    pub fn is_absent(&self) -> bool {
        matches!(self, Field::Absent)
    }
}

/// Le champ peut-il manquer, être `null` ?
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    Required,
    Optional,
    Nullable,
}

/// Liste des problèmes relevés, dans l'ordre du schéma.
#[derive(Debug, Default)]
pub struct Issues(Vec<Value>);

/// Type reçu, au sens de zod (`getParsedType`).
fn received(value: Option<&Value>) -> &'static str {
    match value {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::String(_)) => "string",
        Some(Value::Number(_)) => "number",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Array(_)) => "array",
        Some(Value::Object(_)) => "object",
    }
}

impl Issues {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Message du premier problème (`error.errors[0].message`).
    pub fn first_message(&self) -> Option<String> {
        self.0
            .first()
            .and_then(|i| i.get("message"))
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    /// `ZodError.message` : la liste des problèmes en JSON indenté.
    pub fn zod_message(&self) -> String {
        serde_json::to_string_pretty(&self.0).unwrap_or_default()
    }

    pub fn push_invalid_type(&mut self, key: &str, expected: &str, value: Option<&Value>) {
        let received = received(value);
        let message = if value.is_none() {
            "Required".to_string()
        } else {
            format!("Expected {expected}, received {received}")
        };
        self.0.push(json!({
            "code": "invalid_type",
            "expected": expected,
            "received": received,
            "path": [key],
            "message": message,
        }));
    }

    /// Gère absence et `null` ; `Some(valeur)` s'il faut encore la vérifier.
    fn presence<'a>(
        &mut self,
        body: &'a Value,
        key: &str,
        expected: &str,
        presence: Presence,
    ) -> Result<&'a Value, Option<Field<()>>> {
        match body.get(key) {
            None if presence == Presence::Required => {
                self.push_invalid_type(key, expected, None);
                Err(None)
            }
            None => Err(Some(Field::Absent)),
            Some(Value::Null) if presence == Presence::Nullable => Err(Some(Field::Null)),
            Some(value) => Ok(value),
        }
    }

    fn convert<T>(outcome: Option<Field<()>>) -> Field<T> {
        match outcome {
            Some(Field::Null) => Field::Null,
            _ => Field::Absent,
        }
    }

    pub fn string(&mut self, body: &Value, key: &str, presence: Presence) -> Field<String> {
        match self.presence(body, key, "string", presence) {
            Err(outcome) => Self::convert(outcome),
            Ok(Value::String(s)) => Field::Set(s.clone()),
            Ok(other) => {
                self.push_invalid_type(key, "string", Some(other));
                Field::Absent
            }
        }
    }

    /// Chaîne d'au moins `min` caractères (longueur JavaScript).
    pub fn string_min(
        &mut self,
        body: &Value,
        key: &str,
        presence: Presence,
        min: usize,
        message: &str,
    ) -> Field<String> {
        let field = self.string(body, key, presence);
        if let Field::Set(s) = &field {
            if s.encode_utf16().count() < min {
                self.0.push(json!({
                    "code": "too_small",
                    "minimum": min,
                    "type": "string",
                    "inclusive": true,
                    "exact": false,
                    "message": message,
                    "path": [key],
                }));
            }
        }
        field
    }

    pub fn enumeration(
        &mut self,
        body: &Value,
        key: &str,
        presence: Presence,
        options: &[&str],
    ) -> Field<String> {
        let expected = options
            .iter()
            .map(|o| format!("'{o}'"))
            .collect::<Vec<_>>()
            .join(" | ");
        match self.presence(body, key, &expected, presence) {
            Err(outcome) => Self::convert(outcome),
            Ok(Value::String(s)) if options.contains(&s.as_str()) => Field::Set(s.clone()),
            Ok(Value::String(s)) => {
                self.0.push(json!({
                    "received": s,
                    "code": "invalid_enum_value",
                    "options": options,
                    "path": [key],
                    "message": format!("Invalid enum value. Expected {expected}, received '{s}'"),
                }));
                Field::Absent
            }
            Ok(other) => {
                self.push_invalid_type(key, &expected, Some(other));
                Field::Absent
            }
        }
    }

    /// Entier 32 bits (`integer` PostgreSQL).
    pub fn int(&mut self, body: &Value, key: &str, presence: Presence) -> Field<i32> {
        match self.presence(body, key, "number", presence) {
            Err(outcome) => Self::convert(outcome),
            Ok(Value::Number(n)) => {
                let f = n.as_f64().unwrap_or(f64::NAN);
                if f.fract() != 0.0 {
                    self.0.push(json!({
                        "code": "invalid_type",
                        "expected": "integer",
                        "received": "float",
                        "path": [key],
                        "message": "Expected integer, received float",
                    }));
                    return Field::Absent;
                }
                if f < i32::MIN as f64 {
                    self.0.push(json!({
                        "code": "too_small", "minimum": i32::MIN, "type": "number", "inclusive": true, "exact": false,
                        "path": [key], "message": format!("Number must be greater than or equal to {}", i32::MIN),
                    }));
                    return Field::Absent;
                }
                if f > i32::MAX as f64 {
                    self.0.push(json!({
                        "code": "too_big", "maximum": i32::MAX, "type": "number", "inclusive": true, "exact": false,
                        "path": [key], "message": format!("Number must be less than or equal to {}", i32::MAX),
                    }));
                    return Field::Absent;
                }
                Field::Set(f as i32)
            }
            Ok(other) => {
                self.push_invalid_type(key, "number", Some(other));
                Field::Absent
            }
        }
    }

    /// Champ `z.date()` : un corps JSON ne contient jamais d'objet Date, donc
    /// toute valeur présente est refusée (seuls absence et `null` passent).
    pub fn date(&mut self, body: &Value, key: &str, presence: Presence) -> Field<Ts> {
        match self.presence(body, key, "date", presence) {
            Err(outcome) => Self::convert(outcome),
            Ok(other) => {
                self.push_invalid_type(key, "date", Some(other));
                Field::Absent
            }
        }
    }

    /// Date déjà convertie par la route (`new Date(chaîne)`) : invalide si illisible.
    pub fn converted_date(&mut self, key: &str, value: Option<Ts>) -> Option<Ts> {
        if value.is_none() {
            self.0
                .push(json!({ "code": "invalid_date", "path": [key], "message": "Invalid date" }));
        }
        value
    }

    /// Champ JSON libre (`jsonb`) : toute valeur JSON est acceptée.
    pub fn json(&mut self, body: &Value, key: &str) -> Field<Value> {
        match body.get(key) {
            None => Field::Absent,
            Some(Value::Null) => Field::Null,
            Some(value) => Field::Set(value.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_and_type_messages() {
        let body = json!({ "password": 12 });
        let mut issues = Issues::new();
        issues.string(&body, "username", Presence::Required);
        issues.string(&body, "password", Presence::Required);
        assert_eq!(issues.first_message().as_deref(), Some("Required"));
        assert!(issues
            .zod_message()
            .contains("\"message\": \"Expected string, received number\""));
    }

    #[test]
    fn min_length_and_enum() {
        let body = json!({ "username": "ab", "role": "boss" });
        let mut issues = Issues::new();
        issues.string_min(&body, "username", Presence::Required, 3, "trop court");
        issues.enumeration(&body, "role", Presence::Optional, &["admin", "user"]);
        assert_eq!(issues.first_message().as_deref(), Some("trop court"));
        assert!(issues
            .zod_message()
            .contains("Invalid enum value. Expected 'admin' | 'user', received 'boss'"));
    }

    #[test]
    fn nullable_and_dates() {
        let body = json!({ "a": null, "d": "2024-01-01", "n": 1.5 });
        let mut issues = Issues::new();
        assert_eq!(issues.string(&body, "a", Presence::Nullable), Field::Null);
        assert_eq!(issues.string(&body, "b", Presence::Nullable), Field::Absent);
        assert!(issues.is_empty());
        issues.date(&body, "d", Presence::Optional);
        issues.int(&body, "n", Presence::Optional);
        assert_eq!(
            issues.first_message().as_deref(),
            Some("Expected date, received string")
        );
        assert!(issues
            .zod_message()
            .contains("Expected integer, received float"));
    }
}
