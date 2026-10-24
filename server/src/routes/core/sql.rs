//! Console SQL (administrateurs).
//!
//! L'ancienne route passait la requête telle quelle à `db.execute` (pilote
//! `pg`, protocole simple) et renvoyait l'objet `QueryResult` de `pg` :
//! `{ command, rowCount, oid, rows, fields, … }`, ou un tableau de ces objets
//! quand la requête contenait plusieurs instructions. Les valeurs sont
//! converties comme le faisait `pg-types`, avec les exceptions de Drizzle
//! (dates, horodatages et intervalles laissés en texte brut).

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::TryStreamExt;
use serde_json::{json, Map, Number, Value};
use sqlx::postgres::{PgRow, PgValueRef};
use sqlx::{Column, Either, Row, TypeInfo, ValueRef};

use super::validate::{Issues, Presence};
use crate::auth::AdminUser;
use crate::error::{ApiResult, AppError};
use crate::extract::Body;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/sql/execute", post(execute))
        .route("/api/sql/tables", get(tables))
}

/// La console SQL n'est active que si `ENABLE_SQL_CONSOLE=true`.
fn console_enabled() -> bool {
    crate::config::Config::var("ENABLE_SQL_CONSOLE")
        .is_some_and(|v| v.eq_ignore_ascii_case("true") || v == "1")
}

fn console_disabled() -> AppError {
    AppError::json(
        StatusCode::FORBIDDEN,
        json!({
            "success": false,
            "error": "Console SQL désactivée. Définissez ENABLE_SQL_CONSOLE=true pour l'activer (lecture seule).",
        }),
    )
}

async fn execute(
    State(state): State<AppState>,
    _admin: AdminUser,
    Body(body): Body<Value>,
) -> ApiResult<Json<Value>> {
    if !console_enabled() {
        return Err(console_disabled());
    }
    let mut issues = Issues::new();
    let query = issues.string_min(
        &body,
        "query",
        Presence::Required,
        1,
        "La requête SQL ne peut pas être vide",
    );
    let Some(query) = query.into_option().filter(|_| issues.is_empty()) else {
        return Err(AppError::json(
            StatusCode::BAD_REQUEST,
            json!({ "success": false, "error": issues.first_message().unwrap_or_else(|| "Données invalides".into()) }),
        ));
    };
    if let Err(message) = check_read_only_query(&query) {
        return Err(AppError::json(
            StatusCode::BAD_REQUEST,
            json!({ "success": false, "error": message }),
        ));
    }

    match run_query(&state, &query).await {
        Ok(result) => Ok(Json(json!({ "success": true, "result": result }))),
        Err(error) => {
            tracing::error!("Error executing SQL: {error}");
            let message = super::pg_message(&error);
            let message = if message.is_empty() {
                "Erreur lors de l'exécution de la requête SQL".to_string()
            } else {
                message
            };
            Err(AppError::json(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "success": false, "error": message }),
            ))
        }
    }
}

async fn tables(State(state): State<AppState>, _admin: AdminUser) -> ApiResult<Json<Value>> {
    if !console_enabled() {
        return Err(console_disabled());
    }
    let names: Result<Vec<String>, sqlx::Error> = sqlx::query_scalar(
        "SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    )
    .fetch_all(&state.db.pool)
    .await;
    match names {
        Ok(names) => Ok(Json(json!({
            "tables": names.into_iter().map(|t| json!({ "tablename": t })).collect::<Vec<_>>(),
        }))),
        Err(error) => {
            tracing::error!("Error fetching tables: {error}");
            Err(AppError::internal(super::pg_message(&error)))
        }
    }
}

/// Résultat d'une instruction en cours de lecture.
#[derive(Default)]
struct StatementResult {
    rows: Vec<Value>,
    fields: Vec<Value>,
}

/// Instructions de lecture acceptées (premier mot-clé).
const READ_ONLY_COMMANDS: [&str; 6] = ["SELECT", "WITH", "VALUES", "TABLE", "EXPLAIN", "SHOW"];

/// Fonctions donnant accès au serveur (fichiers, programmes, autres
/// sessions, réglages) : refusées même en lecture seule.
const FORBIDDEN_WORDS: [&str; 16] = [
    "COPY",
    "PG_READ_FILE",
    "PG_READ_BINARY_FILE",
    "PG_LS_DIR",
    "PG_STAT_FILE",
    "LO_IMPORT",
    "LO_EXPORT",
    "LO_FROM_BYTEA",
    "DBLINK",
    "QUERY_TO_XML",
    "QUERY_TO_XML_AND_XMLSCHEMA",
    "SET_CONFIG",
    "PG_TERMINATE_BACKEND",
    "PG_CANCEL_BACKEND",
    "PG_RELOAD_CONF",
    "PG_SLEEP",
];

/// Une seule instruction de lecture, sans fonction d'accès au serveur.
/// L'exécution a de plus lieu dans une transaction en lecture seule.
fn check_read_only_query(query: &str) -> Result<(), String> {
    let statements = split_statements(query);
    if statements.len() > 1 {
        return Err("Une seule instruction SQL à la fois.".into());
    }
    let Some(statement) = statements.first() else {
        return Ok(());
    };
    let upper = statement.to_ascii_uppercase();
    let first: String = upper
        .trim_start()
        .trim_start_matches('(')
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    if !READ_ONLY_COMMANDS.contains(&first.as_str()) {
        return Err("Console SQL en lecture seule : seules les requêtes SELECT, WITH, VALUES, TABLE, EXPLAIN et SHOW sont autorisées.".into());
    }
    let words = upper
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|w| !w.is_empty());
    for word in words {
        if FORBIDDEN_WORDS.contains(&word) {
            return Err(format!("Instruction ou fonction non autorisée : {word}"));
        }
    }
    Ok(())
}

/// Exécute la requête (une seule instruction de lecture) dans une transaction
/// en lecture seule, annulée à la fin, et assemble le résultat au format `pg`.
async fn run_query(state: &AppState, query: &str) -> Result<Value, sqlx::Error> {
    let commands = statement_commands(query);
    let mut results: Vec<Value> = Vec::new();
    let mut current = StatementResult::default();

    let mut tx = state.db.pool.begin().await?;
    sqlx::query("SET TRANSACTION READ ONLY")
        .execute(&mut *tx)
        .await?;
    sqlx::query("SET LOCAL statement_timeout = '30s'")
        .execute(&mut *tx)
        .await?;
    let mut stream = sqlx::raw_sql(query).fetch_many(&mut *tx);
    while let Some(item) = stream.try_next().await? {
        match item {
            Either::Right(row) => {
                if current.fields.is_empty() {
                    current.fields = row_fields(&row);
                }
                current.rows.push(row_to_json(&row));
            }
            Either::Left(done) => {
                let command = commands.get(results.len()).cloned().unwrap_or_default();
                let finished = std::mem::take(&mut current);
                results.push(query_result(&command, done.rows_affected(), finished));
            }
        }
    }
    drop(stream);
    tx.rollback().await?;

    Ok(match results.len() {
        // Requête vide (commentaire seul…) : objet résultat vierge
        0 => json!({
            "command": null, "rowCount": null, "oid": null, "rows": [], "fields": [],
            "_types": {}, "RowCtor": null, "rowAsArray": false, "_prebuiltEmptyResultObject": null,
        }),
        1 => results.pop().unwrap_or(Value::Null),
        _ => Value::Array(results),
    })
}

/// Objet `Result` de `pg` pour une instruction terminée.
fn query_result(command: &str, rows_affected: u64, result: StatementResult) -> Value {
    // `pg` lit l'étiquette « COMMANDE [OID] LIGNES » envoyée par PostgreSQL
    let (row_count, oid) = match command {
        "INSERT" => (json!(rows_affected), json!(0)),
        "SELECT" | "UPDATE" | "DELETE" | "MERGE" | "MOVE" | "FETCH" | "COPY" => {
            (json!(rows_affected), Value::Null)
        }
        _ => (Value::Null, Value::Null),
    };
    let empty_row: Map<String, Value> = result
        .fields
        .iter()
        .filter_map(|f| f.get("name").and_then(Value::as_str))
        .map(|name| (name.to_string(), Value::Null))
        .collect();
    let has_fields = !result.fields.is_empty();
    let field_count = result.fields.len();
    // Même ordre de clés que l'objet `Result` de `pg`
    let mut object = Map::new();
    object.insert(
        "command".into(),
        if command.is_empty() {
            Value::Null
        } else {
            json!(command)
        },
    );
    object.insert("rowCount".into(), row_count);
    object.insert("oid".into(), oid);
    object.insert("rows".into(), Value::Array(result.rows));
    object.insert("fields".into(), Value::Array(result.fields));
    if has_fields {
        // Les analyseurs de `pg` sont des fonctions : `null` une fois sérialisés
        object.insert(
            "_parsers".into(),
            Value::Array(vec![Value::Null; field_count]),
        );
    }
    object.insert("_types".into(), json!({}));
    object.insert("RowCtor".into(), Value::Null);
    object.insert("rowAsArray".into(), Value::Bool(false));
    object.insert(
        "_prebuiltEmptyResultObject".into(),
        if has_fields {
            Value::Object(empty_row)
        } else {
            Value::Null
        },
    );
    Value::Object(object)
}

/// Description des colonnes (`fields` de `pg`).
fn row_fields(row: &PgRow) -> Vec<Value> {
    row.columns()
        .iter()
        .map(|column| {
            let type_info = column.type_info();
            json!({
                "name": column.name(),
                "tableID": column.relation_id().map(|o| o.0).unwrap_or(0),
                "columnID": column.relation_attribute_no().unwrap_or(0),
                "dataTypeID": type_info.oid().map(|o| o.0).unwrap_or(0),
                "format": "text",
            })
        })
        .collect()
}

fn row_to_json(row: &PgRow) -> Value {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let oid = column.type_info().oid().map(|o| o.0).unwrap_or(0);
        let value = match row.try_get_raw(index) {
            Ok(raw) => raw_to_json(oid, column.type_info().name(), raw),
            Err(_) => Value::Null,
        };
        // Colonnes homonymes : la dernière l'emporte, à la place de la première
        object.insert(column.name().to_string(), value);
    }
    Value::Object(object)
}

fn raw_to_json(oid: u32, type_name: &str, raw: PgValueRef<'_>) -> Value {
    if raw.is_null() {
        return Value::Null;
    }
    match raw.as_str() {
        Ok(text) => text_to_json(oid, text),
        // Valeur binaire (jamais en protocole simple) : nom du type en repli
        Err(_) => Value::String(format!("<{type_name}>")),
    }
}

/// Conversion d'une valeur texte PostgreSQL, comme les analyseurs de `pg-types`.
pub(crate) fn text_to_json(oid: u32, text: &str) -> Value {
    match oid {
        // int2, int4, oid
        21 | 23 | 26 => parse_int(text),
        // float4, float8
        700 | 701 => parse_float(text),
        16 => Value::Bool(matches!(
            text,
            "TRUE" | "t" | "true" | "y" | "yes" | "on" | "1"
        )),
        114 | 3802 => serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.into())),
        17 => parse_bytea(text),
        600 => parse_point(text),
        // Tableaux
        1000 => parse_array(text, &|e| {
            Value::Bool(matches!(
                e,
                "TRUE" | "t" | "true" | "y" | "yes" | "on" | "1"
            ))
        }),
        1005 | 1007 | 1028 => parse_array(text, &parse_int),
        1016 => parse_array(text, &|e| Value::String(e.trim().into())),
        1021 | 1022 | 1231 => parse_array(text, &parse_float),
        199 | 3807 => parse_array(text, &|e| {
            serde_json::from_str(e).unwrap_or_else(|_| Value::String(e.into()))
        }),
        1115 | 1182 | 1185 => parse_array(text, &parse_date),
        1001 => parse_array(text, &parse_bytea),
        651 | 1014 | 1015 | 1008 | 1009 | 1040 | 1041 | 3907 | 2951 | 791 | 1183 | 1270 => {
            parse_array(text, &|e| Value::String(e.into()))
        }
        // int8 et numeric restent du texte ; date, timestamp(tz), interval
        // aussi (Drizzle désactive leur conversion) ; uuid, enums… : texte
        _ => Value::String(text.into()),
    }
}

/// `parseInt(value, 10)` : `null` si illisible (NaN sérialisé par JSON).
fn parse_int(text: &str) -> Value {
    let trimmed = text.trim();
    let (sign, digits) = match trimmed.strip_prefix('-') {
        Some(rest) => (-1i64, rest),
        None => (1, trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };
    let end = digits.bytes().take_while(u8::is_ascii_digit).count();
    match digits[..end].parse::<i64>() {
        Ok(n) => json!(sign * n),
        Err(_) => Value::Null,
    }
}

/// `parseFloat` : `NaN` et `Infinity` deviennent `null` en JSON.
fn parse_float(text: &str) -> Value {
    match text.trim().parse::<f64>() {
        Ok(f) if f.is_finite() => {
            if f.fract() == 0.0 && f.abs() < 9e15 {
                json!(f as i64)
            } else {
                Number::from_f64(f)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            }
        }
        _ => Value::Null,
    }
}

/// Élément de tableau date/horodatage : objet `Date` JavaScript, donc ISO 8601.
fn parse_date(text: &str) -> Value {
    let mut value = text.to_string();
    // Décalage « +02 » sans minutes, refusé par chrono
    if let Some(pos) = value.rfind(['+', '-']) {
        if pos > 10 && value.len() - pos == 3 {
            value.push_str(":00");
        }
    }
    match crate::time::parse_js_date(&value) {
        Some(ts) => Value::String(ts.to_iso()),
        None => Value::Null,
    }
}

/// `bytea` (format hexadécimal) : objet `Buffer` sérialisé.
fn parse_bytea(text: &str) -> Value {
    match text
        .strip_prefix("\\x")
        .and_then(|hex_text| hex::decode(hex_text).ok())
    {
        Some(bytes) => json!({ "type": "Buffer", "data": bytes }),
        None => Value::String(text.into()),
    }
}

fn parse_point(text: &str) -> Value {
    let inner = text.trim().trim_start_matches('(').trim_end_matches(')');
    let mut parts = inner.split(',').map(|p| p.trim().parse::<f64>().ok());
    match (parts.next().flatten(), parts.next().flatten()) {
        (Some(x), Some(y)) => json!({ "x": x, "y": y }),
        _ => Value::String(text.into()),
    }
}

/// Tableau PostgreSQL (`{1,2,NULL}`, `{"a b","c\"d"}`, imbriqué) en JSON.
fn parse_array(text: &str, element: &dyn Fn(&str) -> Value) -> Value {
    let text = text.trim();
    // Bornes explicites (« [0:1]={…} ») : on les ignore
    let text = match (text.starts_with('['), text.find('=')) {
        (true, Some(pos)) => &text[pos + 1..],
        _ => text,
    };
    let chars: Vec<char> = text.chars().collect();
    let mut pos = 0;
    match parse_array_level(&chars, &mut pos, element) {
        Some(value) => value,
        None => Value::String(text.into()),
    }
}

fn parse_array_level(
    chars: &[char],
    pos: &mut usize,
    element: &dyn Fn(&str) -> Value,
) -> Option<Value> {
    if chars.get(*pos) != Some(&'{') {
        return None;
    }
    *pos += 1;
    let mut items = Vec::new();
    loop {
        match chars.get(*pos)? {
            '}' => {
                *pos += 1;
                return Some(Value::Array(items));
            }
            ',' => {
                *pos += 1;
            }
            '{' => items.push(parse_array_level(chars, pos, element)?),
            '"' => {
                *pos += 1;
                let mut buf = String::new();
                loop {
                    match chars.get(*pos)? {
                        '\\' => {
                            buf.push(*chars.get(*pos + 1)?);
                            *pos += 2;
                        }
                        '"' => {
                            *pos += 1;
                            break;
                        }
                        c => {
                            buf.push(*c);
                            *pos += 1;
                        }
                    }
                }
                items.push(element(&buf));
            }
            _ => {
                let start = *pos;
                while !matches!(chars.get(*pos), Some(',') | Some('}') | None) {
                    *pos += 1;
                }
                let raw: String = chars[start..*pos].iter().collect();
                let raw = raw.trim();
                items.push(if raw.eq_ignore_ascii_case("NULL") {
                    Value::Null
                } else {
                    element(raw)
                });
            }
        }
    }
}

/// Commande de chaque instruction (« SELECT », « INSERT »…), dans l'ordre :
/// l'étiquette envoyée par PostgreSQL n'est pas exposée par sqlx.
fn statement_commands(query: &str) -> Vec<String> {
    split_statements(query)
        .iter()
        .filter_map(|statement| {
            let word: String = statement
                .trim_start()
                .chars()
                .take_while(|c| c.is_ascii_alphabetic())
                .collect::<String>()
                .to_ascii_uppercase();
            if word.is_empty() {
                return None;
            }
            Some(match word.as_str() {
                // VALUES et TABLE renvoient l'étiquette SELECT
                "VALUES" | "TABLE" => "SELECT".to_string(),
                "WITH" => with_command(statement),
                "START" => "START".to_string(),
                _ => word,
            })
        })
        .collect()
}

/// `WITH … SELECT/INSERT/UPDATE/DELETE` : premier mot-clé principal hors parenthèses.
fn with_command(statement: &str) -> String {
    let upper = statement.to_ascii_uppercase();
    let mut depth = 0i32;
    let mut word = String::new();
    for c in upper.chars().chain(std::iter::once(' ')) {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if c.is_ascii_alphabetic() {
            word.push(c);
        } else {
            if depth == 0
                && matches!(
                    word.as_str(),
                    "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "MERGE"
                )
            {
                return word;
            }
            word.clear();
        }
    }
    "SELECT".to_string()
}

/// Découpe une requête en instructions sur les « ; » hors chaînes,
/// identifiants entre guillemets, chaînes dollar et commentaires.
/// Les commentaires sont retirés du texte des instructions.
fn split_statements(query: &str) -> Vec<String> {
    let chars: Vec<char> = query.chars().collect();
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '\'' | '"' => {
                let quote = c;
                current.push(c);
                i += 1;
                while i < chars.len() {
                    current.push(chars[i]);
                    if chars[i] == quote {
                        if chars.get(i + 1) == Some(&quote) {
                            current.push(quote);
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            '-' if chars.get(i + 1) == Some(&'-') => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                current.push(' ');
            }
            '/' if chars.get(i + 1) == Some(&'*') => {
                let mut depth = 0;
                while i < chars.len() {
                    if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                        depth += 1;
                        i += 2;
                    } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                        depth -= 1;
                        i += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
                current.push(' ');
            }
            '$' => {
                // Étiquette de chaîne dollar : $$ ou $tag$
                let mut j = i + 1;
                while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_') {
                    j += 1;
                }
                let is_tag = chars.get(j) == Some(&'$')
                    && !chars.get(i + 1).is_some_and(|c| c.is_ascii_digit())
                    && !current
                        .chars()
                        .last()
                        .is_some_and(|p| p.is_alphanumeric() || p == '_');
                if is_tag {
                    let tag: Vec<char> = chars[i..=j].to_vec();
                    current.extend(&tag);
                    i = j + 1;
                    while i < chars.len() {
                        if chars[i..].starts_with(&tag) {
                            current.extend(&tag);
                            i += tag.len();
                            break;
                        }
                        current.push(chars[i]);
                        i += 1;
                    }
                } else {
                    current.push(c);
                    i += 1;
                }
            }
            ';' => {
                statements.push(std::mem::take(&mut current));
                i += 1;
            }
            _ => {
                current.push(c);
                i += 1;
            }
        }
    }
    statements.push(current);
    statements
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_conversions_follow_pg_types() {
        assert_eq!(text_to_json(23, "42"), json!(42));
        assert_eq!(
            text_to_json(20, "9007199254740993"),
            json!("9007199254740993")
        );
        assert_eq!(text_to_json(1700, "12.50"), json!("12.50"));
        assert_eq!(text_to_json(701, "1.5"), json!(1.5));
        assert_eq!(text_to_json(701, "3"), json!(3));
        assert_eq!(text_to_json(701, "NaN"), Value::Null);
        assert_eq!(text_to_json(16, "t"), json!(true));
        assert_eq!(text_to_json(16, "f"), json!(false));
        assert_eq!(
            text_to_json(3802, r#"{"a": [1, 2]}"#),
            json!({ "a": [1, 2] })
        );
        // Drizzle laisse les dates en texte brut
        assert_eq!(
            text_to_json(1114, "2024-05-01 08:30:00.123"),
            json!("2024-05-01 08:30:00.123")
        );
        assert_eq!(text_to_json(2950, "a0ee-…"), json!("a0ee-…"));
        assert_eq!(
            text_to_json(17, "\\x0102"),
            json!({ "type": "Buffer", "data": [1, 2] })
        );
        assert_eq!(text_to_json(600, "(1.5,2)"), json!({ "x": 1.5, "y": 2.0 }));
    }

    #[test]
    fn array_conversions() {
        assert_eq!(text_to_json(1007, "{1,2,NULL}"), json!([1, 2, null]));
        assert_eq!(
            text_to_json(1009, r#"{"a b","c\"d",e}"#),
            json!(["a b", "c\"d", "e"])
        );
        assert_eq!(text_to_json(1007, "{{1,2},{3,4}}"), json!([[1, 2], [3, 4]]));
        assert_eq!(text_to_json(1016, "{10,20}"), json!(["10", "20"]));
        assert_eq!(text_to_json(1009, "{}"), json!([]));
        assert_eq!(
            text_to_json(1185, r#"{"2024-05-01 10:30:00+02"}"#),
            json!(["2024-05-01T08:30:00.000Z"])
        );
        assert_eq!(
            text_to_json(1115, r#"{"2024-05-01 08:30:00"}"#),
            json!(["2024-05-01T08:30:00.000Z"])
        );
    }

    #[test]
    fn statement_splitting() {
        let commands = statement_commands(
            "select 'a;b'; -- commentaire ; ici\nINSERT INTO t VALUES ($$x;y$$); /* ; */ ; with x as (select 1) delete from t; values (1)",
        );
        assert_eq!(commands, vec!["SELECT", "INSERT", "DELETE", "SELECT"]);
        assert_eq!(statement_commands("  "), Vec::<String>::new());
        assert_eq!(
            statement_commands("create table \"a;b\" (id int)"),
            vec!["CREATE"]
        );
    }

    #[test]
    fn read_only_guard() {
        assert!(check_read_only_query("select * from users;").is_ok());
        assert!(check_read_only_query("  WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
        assert!(check_read_only_query("(select 1)").is_ok());
        assert!(check_read_only_query("select 'a;b' -- ; drop").is_ok());
        assert!(check_read_only_query("select 1; drop table users").is_err());
        assert!(check_read_only_query("commit").is_err());
        assert!(check_read_only_query("DROP TABLE users").is_err());
        assert!(check_read_only_query("do $$ begin end $$").is_err());
        assert!(check_read_only_query("copy users to program 'id'").is_err());
        assert!(check_read_only_query("select pg_read_file('/etc/passwd')").is_err());
        assert!(check_read_only_query("select query_to_xml('x', true, true, '')").is_err());
    }

    #[test]
    fn result_shape() {
        let result = query_result(
            "SELECT",
            1,
            StatementResult {
                rows: vec![json!({ "a": 1 })],
                fields: vec![json!({ "name": "a" })],
            },
        );
        let keys: Vec<&String> = result.as_object().unwrap().keys().collect();
        assert_eq!(
            keys[..6],
            ["command", "rowCount", "oid", "rows", "fields", "_parsers"]
        );
        assert_eq!(result["rowCount"], 1);
        assert_eq!(result["_prebuiltEmptyResultObject"], json!({ "a": null }));
        let create = query_result("CREATE", 0, StatementResult::default());
        assert_eq!(create["rowCount"], Value::Null);
        assert_eq!(
            query_result("INSERT", 2, StatementResult::default())["oid"],
            0
        );
    }
}
