//! FM24 performance index: reported experimental effects plus role highlights.
use crate::{
    parser::CATALOG,
    roles::{Role, ROLES},
};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::BTreeMap, sync::LazyLock};

pub const SYSTEM_ID: &str = "fm-arena-hybrid-rating";
pub const MODEL_VERSION: &str = "fm-arena-hybrid-v1";
pub const TESTING_SHARE: f64 = 0.70;
pub const ROLE_SHARE: f64 = 0.30;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Experiment {
    pub status: String,
    pub from: Option<f64>,
    pub to: Option<f64>,
    pub points: Option<f64>,
    pub goals_for: Option<f64>,
    pub goals_against: Option<f64>,
}

impl Experiment {
    pub fn importance(&self) -> f64 {
        if self.status == "tested" {
            self.points.unwrap() / (self.to.unwrap() - self.from.unwrap())
        } else {
            0.0
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub schema_version: u8,
    pub source: Value,
    pub outfield: BTreeMap<String, Experiment>,
    pub goalkeeper: BTreeMap<String, Experiment>,
    pub set_pieces: BTreeMap<String, Experiment>,
}

pub static EVIDENCE: LazyLock<Evidence> = LazyLock::new(|| {
    let evidence: Evidence = serde_json::from_str(include_str!("fm_arena_evidence.json"))
        .expect("FM-Arena evidence dataset");
    assert_eq!(evidence.schema_version, 1);
    for (key, experiment) in evidence
        .outfield
        .iter()
        .chain(evidence.goalkeeper.iter())
        .chain(evidence.set_pieces.iter())
    {
        assert!(CATALOG
            .attributes
            .iter()
            .any(|attribute| attribute.key == *key));
        if experiment.status == "tested" {
            let (from, to) = (experiment.from.unwrap(), experiment.to.unwrap());
            assert!((1.0..=20.0).contains(&from) && (from..=20.0).contains(&to) && to > from);
            assert!(experiment.points.is_some_and(|v| v.is_finite() && v >= 0.0));
            assert!(experiment.goals_for.is_some_and(f64::is_finite));
            assert!(experiment.goals_against.is_some_and(f64::is_finite));
        } else {
            assert_eq!(experiment.status, "untested");
            assert!(
                experiment.from.is_none()
                    && experiment.to.is_none()
                    && experiment.points.is_none()
                    && experiment.goals_for.is_none()
                    && experiment.goals_against.is_none()
            );
        }
    }
    evidence
});

// Cache the experimental component so every detail request uses the exact
// definitions that produced the combined SQL weights.
pub static TESTING_ROLES: LazyLock<BTreeMap<String, Role>> = LazyLock::new(|| {
    ROLES
        .roles
        .iter()
        .map(|source| {
            let experiments = if source.group == "Goalkeepers" {
                &EVIDENCE.goalkeeper
            } else {
                &EVIDENCE.outfield
            };
            let mut weights: BTreeMap<String, f64> = experiments
                .iter()
                .filter_map(|(key, experiment)| {
                    let boost = if source.key_attributes.contains(key) {
                        1.5
                    } else if source.preferable_attributes.contains(key) {
                        1.25
                    } else {
                        1.0
                    };
                    let weight = experiment.importance() * boost;
                    (weight > 0.0).then(|| (key.clone(), weight))
                })
                .collect();
            let total: f64 = weights.values().sum();
            assert!(total.is_finite() && total > 0.0);
            for weight in weights.values_mut() {
                *weight /= total;
            }
            let mut role = source.clone();
            role.weights = Some(weights);
            (role.id.clone(), role)
        })
        .collect()
});

pub fn combined_roles() -> Vec<Role> {
    ROLES
        .roles
        .iter()
        .map(|source| {
            let mut weights: BTreeMap<String, f64> = TESTING_ROLES[&source.id]
                .weighted_attributes()
                .map(|(key, weight)| (key.to_owned(), 100.0 * TESTING_SHARE * weight))
                .collect();
            let role_total: f64 = source.weighted_attributes().map(|(_, weight)| weight).sum();
            for (key, weight) in source.weighted_attributes() {
                *weights.entry(key.to_owned()).or_default() +=
                    100.0 * ROLE_SHARE * weight / role_total;
            }
            let mut role = source.clone();
            role.weights = Some(weights);
            role
        })
        .collect()
}
