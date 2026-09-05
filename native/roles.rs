//! FM24 attribute fit, independent of positional familiarity and coach stars.
use crate::{parser::CATALOG, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, sync::LazyLock};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub id: String,
    pub role: String,
    pub name: String,
    pub duty: String,
    pub group: String,
    pub key_attributes: Vec<String>,
    pub preferable_attributes: Vec<String>,
    pub source: String,
    pub source_role: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleCatalog {
    pub version: String,
    pub model_version: String,
    pub game_version: String,
    pub key_weight: u8,
    pub preferable_weight: u8,
    pub scale: u8,
    pub source_matrix_sha256: String,
    pub sources: Vec<Value>,
    pub roles: Vec<Role>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleRating {
    pub role_id: String,
    pub score: Option<f64>,
    // Includes missing and invalid values. Never silently reweight partial data.
    pub missing_attributes: Vec<String>,
}

pub static ROLES: LazyLock<RoleCatalog> = LazyLock::new(|| {
    let catalog: RoleCatalog =
        serde_json::from_str(include_str!("roles.json")).expect("role catalog");
    validate(&catalog).expect("valid role catalog");
    catalog
});

pub fn validate(catalog: &RoleCatalog) -> Result<()> {
    let mut ids = HashSet::new();
    let mut identities = HashSet::new();
    if catalog.roles.len() != 85
        || catalog.key_weight != 2
        || catalog.preferable_weight != 1
        || catalog.scale != 100
    {
        return Err(Error::query("Invalid role catalog or scoring model."));
    }
    for role in &catalog.roles {
        identities.insert(&role.role);
        let mut keys = HashSet::new();
        if !ids.insert(&role.id)
            || role.id != format!("{}-{}", role.role, role.duty)
            || !["defend", "support", "attack", "stopper", "cover"].contains(&role.duty.as_str())
            || role.key_attributes.is_empty()
            || !catalog.sources.iter().any(|s| s["id"] == role.source)
        {
            return Err(Error::query(format!("Invalid role: {}", role.id)));
        }
        for (key, _) in role.weighted_attributes() {
            // SQL identifiers come only from the validated, bundled attribute catalog.
            if !keys.insert(key)
                || !key.bytes().all(|c| c.is_ascii_alphanumeric())
                || !CATALOG.attributes.iter().any(|a| a.key == key)
            {
                return Err(Error::query(format!("Invalid role attribute: {key}")));
            }
        }
    }
    if identities.len() != 45 {
        return Err(Error::query("Expected 45 FM24 roles."));
    }
    Ok(())
}

pub fn find(id: &str) -> Result<&'static Role> {
    ROLES
        .roles
        .iter()
        .find(|role| role.id == id)
        .ok_or_else(|| Error::query("Unknown FM24 role and duty."))
}

impl Role {
    fn weighted_attributes(&self) -> impl Iterator<Item = (&str, u8)> {
        self.key_attributes
            .iter()
            .map(|key| (key.as_str(), 2))
            .chain(
                self.preferable_attributes
                    .iter()
                    .map(|key| (key.as_str(), 1)),
            )
    }

    fn denominator(&self) -> usize {
        2 * self.key_attributes.len() + self.preferable_attributes.len()
    }

    pub fn rate(&self, attributes: &Value) -> RoleRating {
        let mut total = 0.0;
        let mut missing_attributes = vec![];
        for (key, weight) in self.weighted_attributes() {
            match attributes.get(key).and_then(Value::as_f64) {
                Some(value) if value.is_finite() && (1.0..=20.0).contains(&value) => {
                    total += value * f64::from(weight);
                }
                _ => missing_attributes.push(key.to_string()),
            }
        }
        RoleRating {
            role_id: self.id.clone(),
            score: missing_attributes
                .is_empty()
                .then(|| 5.0 * total / self.denominator() as f64),
            missing_attributes,
        }
    }

    // Only call on a role obtained from ROLES/find, which validates every identifier.
    pub(crate) fn sql_score(&self) -> String {
        let valid = self
            .weighted_attributes()
            .map(|(key, _)| {
                format!(
                    "(typeof(attr_{key}) IN ('integer','real') AND attr_{key} BETWEEN 1 AND 20)"
                )
            })
            .collect::<Vec<_>>()
            .join(" AND ");
        let total = self
            .weighted_attributes()
            .map(|(key, weight)| format!("{weight} * attr_{key}"))
            .collect::<Vec<_>>()
            .join(" + ");
        format!(
            "(CASE WHEN {valid} THEN 5.0 * ({total}) / {} ELSE NULL END)",
            self.denominator()
        )
    }
}

pub fn rate_all(attributes: &Value) -> Vec<RoleRating> {
    ROLES
        .roles
        .iter()
        .map(|role| role.rate(attributes))
        .collect()
}
