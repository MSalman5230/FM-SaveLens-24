//! Workspace-owned rating definitions. Snapshot data is never rewritten.
use crate::{
    hybrid,
    parser::CATALOG,
    roles::{RatingComponents, Role, RoleRating, ROLES},
    Error, Result,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, io::Write, path::Path, sync::LazyLock};

pub const BUILTIN_ID: &str = "role-highlighted-rating";
pub const DEFAULT_ID: &str = hybrid::SYSTEM_ID;
pub const MAX_CUSTOM_SYSTEMS: usize = 32;
pub const MAX_ROLES_PER_SYSTEM: usize = 128;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RatingSystem {
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub built_in: bool,
    pub roles: Vec<Role>,
}

pub static BUILTIN: LazyLock<RatingSystem> = LazyLock::new(|| RatingSystem {
    id: BUILTIN_ID.into(),
    name: "Role Highlighted Rating".into(),
    revision: 1,
    built_in: true,
    roles: ROLES
        .roles
        .iter()
        .map(|role| {
            let mut copy = role.clone();
            copy.weights = Some(
                role.weighted_attributes()
                    .map(|(key, weight)| (key.to_owned(), weight))
                    .collect(),
            );
            copy
        })
        .collect(),
});

pub static HYBRID: LazyLock<RatingSystem> = LazyLock::new(|| {
    let mut roles = hybrid::combined_roles();
    validate_roles(&mut roles).expect("valid hybrid role weights");
    RatingSystem {
        id: hybrid::SYSTEM_ID.into(),
        name: "FM-Arena Hybrid Rating".into(),
        revision: 1,
        built_in: true,
        roles,
    }
});

pub fn builtins() -> [&'static RatingSystem; 2] {
    [&BUILTIN, &HYBRID]
}

pub fn allowed_attribute(key: &str) -> bool {
    CATALOG.attributes.iter().any(|attribute| {
        attribute.key == key
            && (matches!(
                attribute.group.as_str(),
                "Technical" | "Mental" | "Physical" | "Goalkeeping" | "Feet"
            ) || key == "consistency")
    })
}

fn name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 100 {
        return Err(Error::query("Names must contain 1–100 characters."));
    }
    Ok(value.to_string())
}

pub fn validate_roles(roles: &mut [Role]) -> Result<()> {
    if roles.len() > MAX_ROLES_PER_SYSTEM {
        return Err(Error::query(format!(
            "A system can contain at most {MAX_ROLES_PER_SYSTEM} role profiles."
        )));
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for role in roles.iter_mut() {
        role.name = name(&role.name)?;
        let original = ROLES.roles.iter().find(|original| original.id == role.id);
        let custom_id = role
            .id
            .strip_prefix("custom-")
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok());
        if !ids.insert(role.id.clone())
            || (original.is_none() && !custom_id)
            || !names.insert((role.name.to_lowercase(), role.duty.clone()))
            || !ROLES.roles.iter().any(|source| {
                source.role == role.role && source.duty == role.duty && source.group == role.group
            })
            || original.is_some_and(|source| {
                source.role != role.role || source.duty != role.duty || source.group != role.group
            })
        {
            return Err(Error::query(
                "Roles need unique IDs and names for each duty, and a valid source role.",
            ));
        }
        let weights = role
            .weights
            .as_ref()
            .ok_or_else(|| Error::query("Each role needs explicit attribute weights."))?;
        for (key, weight) in weights {
            if !allowed_attribute(key) || !weight.is_finite() || *weight < 0.0 {
                return Err(Error::query(format!(
                    "Invalid weight or unsupported attribute: {key}."
                )));
            }
        }
        let total: f64 = weights.values().sum();
        if !total.is_finite() || total <= 0.0 || total > f64::MAX / 100.0 {
            return Err(Error::query(
                "Each role needs at least one positive weight and a finite total.",
            ));
        }
        // Keep highlight/source metadata anchored to the bundled role. Custom
        // calculations and displays use weights, never editable tier arrays.
        let source = ROLES
            .roles
            .iter()
            .find(|source| source.role == role.role && source.duty == role.duty)
            .unwrap();
        role.key_attributes = source.key_attributes.clone();
        role.preferable_attributes = source.preferable_attributes.clone();
        role.source = source.source.clone();
        role.source_role = source.source_role.clone();
    }
    if ROLES.roles.iter().any(|role| !ids.contains(&role.id)) {
        return Err(Error::query(
            "Keep the original role profiles; only added roles can be deleted.",
        ));
    }
    Ok(())
}

impl RatingSystem {
    pub fn find(&self, id: &str) -> Result<&Role> {
        self.roles
            .iter()
            .find(|role| role.id == id)
            .ok_or_else(|| Error::query("Unknown role in the active rating system."))
    }

    pub fn catalog(&self) -> Value {
        let mut catalog = serde_json::to_value(&*ROLES).expect("serializable catalog");
        catalog["roles"] = json!(self.roles);
        catalog["systemId"] = json!(self.id);
        catalog["systemName"] = json!(self.name);
        catalog["systemRevision"] = json!(self.revision);
        catalog["builtIn"] = json!(self.built_in);
        if self.id != BUILTIN_ID {
            catalog["modelVersion"] = json!("attribute-weights-v1");
            catalog.as_object_mut().unwrap().remove("keyWeight");
            catalog.as_object_mut().unwrap().remove("preferableWeight");
        }
        if self.id == hybrid::SYSTEM_ID {
            catalog["modelVersion"] = json!(hybrid::MODEL_VERSION);
            catalog["sources"]
                .as_array_mut()
                .unwrap()
                .push(hybrid::EVIDENCE.source.clone());
        }
        catalog
    }

    pub fn rate_role(&self, role: &Role, attributes: &Value) -> RoleRating {
        let mut rating = role.rate(attributes);
        if self.id == hybrid::SYSTEM_ID && rating.score.is_some() {
            let testing = hybrid::TESTING_ROLES[&role.id].rate(attributes);
            let highlighted = ROLES
                .roles
                .iter()
                .find(|source| source.id == role.id)
                .unwrap()
                .rate(attributes);
            rating.components = Some(RatingComponents {
                testing_score: testing.score.expect("complete hybrid attributes"),
                role_score: highlighted.score.expect("complete highlighted attributes"),
            });
        }
        rating
    }

    pub fn tag(&self, value: &mut Value) {
        value["systemId"] = json!(self.id);
        value["systemRevision"] = json!(self.revision);
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RatingStore {
    schema_version: u8,
    pub active_system_id: String,
    pub systems: Vec<RatingSystem>,
}

impl Default for RatingStore {
    fn default() -> Self {
        Self {
            schema_version: 1,
            active_system_id: DEFAULT_ID.into(),
            systems: vec![],
        }
    }
}

impl RatingStore {
    pub fn load(data: &Path) -> Result<Self> {
        let path = data.join("rating-systems.json");
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(error) => return Err(error.into()),
        };
        let mut store: Self = serde_json::from_slice(&bytes)?;
        if store.schema_version != 1 {
            return Err(Error::query("Unsupported rating systems file version."));
        }
        if store.systems.len() > MAX_CUSTOM_SYSTEMS {
            return Err(Error::query(format!(
                "A workspace can contain at most {MAX_CUSTOM_SYSTEMS} custom rating systems."
            )));
        }
        let mut ids = HashSet::new();
        let mut names = HashSet::from([BUILTIN.name.to_lowercase()]);
        for system in &mut store.systems {
            system.name = name(&system.name)?;
            if system.built_in
                || uuid::Uuid::parse_str(&system.id).is_err()
                || system.revision == 0
                || !ids.insert(system.id.clone())
                || !names.insert(system.name.to_lowercase())
            {
                return Err(Error::query("Invalid saved rating system."));
            }
            validate_roles(&mut system.roles)?;
        }
        store.find(&store.active_system_id)?;
        Ok(store)
    }

    pub fn persist(&self, data: &Path) -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(data)?;
        file.write_all(&serde_json::to_vec_pretty(self)?)?;
        file.as_file().sync_all()?;
        file.persist(data.join("rating-systems.json"))
            .map_err(|error| Error::from(error.error))?;
        Ok(())
    }

    pub fn find(&self, id: &str) -> Result<&RatingSystem> {
        if let Some(system) = builtins().into_iter().find(|system| system.id == id) {
            return Ok(system);
        }
        self.systems
            .iter()
            .find(|system| system.id == id)
            .ok_or_else(|| Error::new("NOT_FOUND", "Rating system not found."))
    }

    pub fn active(&self) -> &RatingSystem {
        self.find(&self.active_system_id)
            .expect("validated active system")
    }

    pub fn list(&self) -> Value {
        json!({"activeSystemId": self.active_system_id,
            "systems": builtins().into_iter().chain(self.systems.iter()).map(|system|
                json!({"id":system.id,"name":system.name,"revision":system.revision,"builtIn":system.built_in,"roleCount":system.roles.len()})
            ).collect::<Vec<_>>(), "catalog": self.active().catalog(),
            "limits": {"maxCustomSystems": MAX_CUSTOM_SYSTEMS, "maxRolesPerSystem": MAX_ROLES_PER_SYSTEM}})
    }

    pub fn create(&mut self, body: &Value) -> Result<RatingSystem> {
        if self.systems.len() >= MAX_CUSTOM_SYSTEMS {
            return Err(Error::query(format!(
                "A workspace can contain at most {MAX_CUSTOM_SYSTEMS} custom rating systems."
            )));
        }
        let source = self.find(body["sourceId"].as_str().unwrap_or(DEFAULT_ID))?;
        let mut system = source.clone();
        system.id = uuid::Uuid::new_v4().to_string();
        system.built_in = false;
        system.revision = 1;
        self.apply_input(&mut system, body)?;
        self.systems.push(system.clone());
        Ok(system)
    }

    fn apply_input(&self, system: &mut RatingSystem, body: &Value) -> Result<()> {
        system.name = name(body["name"].as_str().unwrap_or(""))?;
        // A pre-upgrade custom system may already use a newly bundled name.
        // Preserve it (and allow weight edits), but reserve preset names for
        // new systems and actual name changes.
        let unchanged_name = self.systems.iter().any(|existing| {
            existing.id == system.id && existing.name.to_lowercase() == system.name.to_lowercase()
        });
        if (!unchanged_name
            && builtins()
                .iter()
                .any(|preset| system.name.to_lowercase() == preset.name.to_lowercase()))
            || self.systems.iter().any(|existing| {
                existing.id != system.id
                    && existing.name.to_lowercase() == system.name.to_lowercase()
            })
        {
            return Err(Error::query(
                "A rating system with this name already exists.",
            ));
        }
        if let Some(roles) = body.get("roles") {
            system.roles = serde_json::from_value(roles.clone())
                .map_err(|_| Error::query("Invalid role definitions or weights."))?;
        }
        validate_roles(&mut system.roles)
    }

    pub fn update(&mut self, id: &str, body: &Value) -> Result<RatingSystem> {
        if self.find(id)?.built_in {
            return Err(Error::query(
                "Duplicate the built-in rating system to customize it.",
            ));
        }
        let mut system = self.find(id)?.clone();
        if body["revision"].as_u64() != Some(system.revision) {
            return Err(Error::new(
                "CONFLICT",
                "This system changed in another window. Reload it before saving.",
            ));
        }
        self.apply_input(&mut system, body)?;
        system.revision += 1;
        *self
            .systems
            .iter_mut()
            .find(|existing| existing.id == id)
            .unwrap() = system.clone();
        Ok(system)
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        if self.find(id)?.built_in {
            return Err(Error::query(
                "The built-in rating system cannot be deleted.",
            ));
        }
        self.find(id)?;
        self.systems.retain(|system| system.id != id);
        if self.active_system_id == id {
            self.active_system_id = DEFAULT_ID.into();
        }
        Ok(())
    }

    pub fn activate(&mut self, id: &str) -> Result<()> {
        self.find(id)?;
        self.active_system_id = id.into();
        Ok(())
    }
}
