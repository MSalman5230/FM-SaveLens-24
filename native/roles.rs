//! FM24 attribute fit, independent of positional familiarity and coach stars.
use crate::{parser::CATALOG, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    sync::LazyLock,
};

const KEY_WEIGHT: u8 = 2;
const PREFERABLE_WEIGHT: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights: Option<BTreeMap<String, f64>>,
}

#[derive(Clone, Deserialize, Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub components: Option<RatingComponents>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RatingComponents {
    pub testing_score: f64,
    pub role_score: f64,
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
        || catalog.key_weight != KEY_WEIGHT
        || catalog.preferable_weight != PREFERABLE_WEIGHT
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
    pub fn weighted_attributes(&self) -> Box<dyn Iterator<Item = (&str, f64)> + '_> {
        if let Some(weights) = &self.weights {
            return Box::new(
                weights
                    .iter()
                    .filter(|(_, weight)| **weight > 0.0)
                    .map(|(key, weight)| (key.as_str(), *weight)),
            );
        }
        Box::new(
            self.key_attributes
                .iter()
                .map(|key| (key.as_str(), f64::from(KEY_WEIGHT)))
                .chain(
                    self.preferable_attributes
                        .iter()
                        .map(|key| (key.as_str(), f64::from(PREFERABLE_WEIGHT))),
                ),
        )
    }

    fn denominator(&self) -> f64 {
        self.weighted_attributes().map(|(_, weight)| weight).sum()
    }

    pub fn rate(&self, attributes: &Value) -> RoleRating {
        let mut total = 0.0;
        let mut missing_attributes = vec![];
        for (key, weight) in self.weighted_attributes() {
            match attributes.get(key).and_then(Value::as_f64) {
                Some(value) if value.is_finite() && (1.0..=20.0).contains(&value) => {
                    total += value * weight;
                }
                _ => missing_attributes.push(key.to_string()),
            }
        }
        RoleRating {
            role_id: self.id.clone(),
            score: missing_attributes
                .is_empty()
                .then(|| 5.0 * total / self.denominator()),
            missing_attributes,
            components: None,
        }
    }

    // Only call with a bundled or validated custom role. Attribute identifiers
    // and numeric weights must never come from unvalidated request data.
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
