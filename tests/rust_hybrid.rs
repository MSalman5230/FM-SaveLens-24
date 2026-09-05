use fm_savelens_backend::{
    hybrid::{self, EVIDENCE, TESTING_ROLES},
    parser::CATALOG,
    rating_systems::{builtins, validate_roles, RatingStore, BUILTIN, BUILTIN_ID, HYBRID},
    roles::ROLES,
};
use serde_json::{json, Value};

fn attributes(value: f64) -> Value {
    CATALOG
        .attributes
        .iter()
        .map(|a| (a.key.clone(), json!(value)))
        .collect()
}

fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-10, "{actual} != {expected}");
}

#[test]
fn evidence_preserves_ranges_zero_results_and_untested_status() {
    assert_eq!(EVIDENCE.outfield.len(), 33);
    assert_eq!(EVIDENCE.goalkeeper.len(), 14);
    assert_eq!(EVIDENCE.source["updated"], "2025-01-12");
    near(EVIDENCE.outfield["pace"].importance(), 64.0 / 12.0);
    near(EVIDENCE.outfield["jumpingReach"].importance(), 16.0 / 9.0);
    assert_eq!(EVIDENCE.outfield["jumpingReach"].to, Some(17.0));
    assert_eq!(EVIDENCE.outfield["pace"].goals_for, Some(45.0));
    assert_eq!(EVIDENCE.outfield["pace"].goals_against, Some(-59.0));
    assert_eq!(EVIDENCE.outfield["marking"].status, "tested");
    assert_eq!(EVIDENCE.outfield["marking"].points, Some(0.0));
    assert_eq!(EVIDENCE.set_pieces["penaltyTaking"].status, "untested");
    assert_eq!(EVIDENCE.set_pieces["penaltyTaking"].points, None);
    near(EVIDENCE.goalkeeper["reflexes"].importance(), 8.0 / 12.0);
    assert_eq!(EVIDENCE.goalkeeper["consistency"].points, Some(0.0));
}

#[test]
fn every_hybrid_profile_is_complete_normalized_and_reconciles_components() {
    let mut validated = HYBRID.roles.clone();
    validate_roles(&mut validated).unwrap();
    assert_eq!(HYBRID.roles.len(), 85);
    for role in &HYBRID.roles {
        near(
            role.weighted_attributes().map(|(_, weight)| weight).sum(),
            100.0,
        );
        for value in [1.0, 10.25, 15.0, 20.0] {
            let result = HYBRID.rate_role(role, &attributes(value));
            near(result.score.unwrap(), value * 5.0);
            let components = result.components.unwrap();
            near(components.testing_score, value * 5.0);
            near(components.role_score, value * 5.0);
        }
        let varied: Value = CATALOG
            .attributes
            .iter()
            .enumerate()
            .map(|(i, a)| (a.key.clone(), json!((i * 7 % 20 + 1) as f64)))
            .collect();
        let result = HYBRID.rate_role(role, &varied);
        let components = result.components.unwrap();
        near(
            result.score.unwrap(),
            0.70 * components.testing_score + 0.30 * components.role_score,
        );
        let original = ROLES
            .roles
            .iter()
            .find(|source| source.id == role.id)
            .unwrap();
        assert_eq!(
            original.rate(&varied).score,
            BUILTIN.find(&role.id).unwrap().rate(&varied).score
        );
        assert!(BUILTIN.rate_role(original, &varied).components.is_none());
        let weights = role.weights.as_ref().unwrap();
        for excluded in [
            "corners",
            "freeKickTaking",
            "penaltyTaking",
            "longThrows",
            "leftFoot",
            "rightFoot",
            "importantMatches",
            "injuryProneness",
        ] {
            assert!(!weights.contains_key(excluded), "{}: {excluded}", role.id);
        }
        if matches!(role.role.as_str(), "gk" | "sk") {
            for excluded in [
                "pace",
                "consistency",
                "jumpingReach",
                "longShots",
                "finishing",
            ] {
                assert!(!weights.contains_key(excluded), "{}: {excluded}", role.id);
            }
            assert!(weights["reflexes"] > weights["agility"]);
        } else {
            assert!(
                weights["pace"] > 0.0
                    && weights["acceleration"] > 0.0
                    && weights["consistency"] > 0.0
            );
            assert!(!weights.contains_key("reflexes"));
        }
    }
}

#[test]
fn cd_long_shots_has_the_agreed_small_effect_and_highlight_only_skills_still_count() {
    let cd = HYBRID.find("cd-defend").unwrap();
    let weights = cd.weights.as_ref().unwrap();
    near(weights["longShots"], 1.2025769506084465);
    let baseline = attributes(10.0);
    let mut changed = baseline.clone();
    changed["longShots"] = json!(20);
    near(
        cd.rate(&changed).score.unwrap() - cd.rate(&baseline).score.unwrap(),
        0.6012884753042232,
    );
    // Marking has zero experimental effect but remains a key CD attribute.
    near(weights["marking"], 30.0 * 2.0 / 19.0);
    changed = baseline.clone();
    changed["marking"] = json!(20);
    assert!(cd.rate(&changed).score > cd.rate(&baseline).score);
    changed = baseline.clone();
    changed["pace"] = json!(20);
    assert!(cd.rate(&changed).score.unwrap() - cd.rate(&baseline).score.unwrap() > 8.0);
    // Corrected Jumping Reach still contributes above the experiment's endpoint.
    changed = attributes(17.0);
    changed["jumpingReach"] = json!(20);
    assert!(cd.rate(&changed).score.unwrap() > 85.0);
    let experimental = TESTING_ROLES["cd-defend"].weights.as_ref().unwrap();
    near(
        experimental["jumpingReach"] / experimental["longShots"],
        (16.0 / 9.0 * 1.5) / (6.0 / 12.0),
    );
}

#[test]
fn role_adjustment_can_change_a_players_best_outfield_role() {
    let mut player = attributes(12.0);
    player["pace"] = json!(20);
    player["acceleration"] = json!(20);
    let best = |system: &fm_savelens_backend::rating_systems::RatingSystem| {
        system
            .roles
            .iter()
            .filter(|role| role.group != "Goalkeepers")
            .max_by(|a, b| {
                a.rate(&player)
                    .score
                    .partial_cmp(&b.rate(&player).score)
                    .unwrap()
            })
            .unwrap()
            .id
            .clone()
    };
    assert_eq!(best(&BUILTIN), "w-support");
    assert_eq!(best(&HYBRID), "pf-defend");
}

#[test]
fn missing_positive_weights_invalidate_both_score_and_components_but_exclusions_do_not() {
    let cd = HYBRID.find("cd-defend").unwrap();
    for key in ["longShots", "marking", "consistency", "pace"] {
        for invalid in [Value::Null, json!(0), json!(21), json!("15"), json!(true)] {
            let mut player = attributes(15.0);
            player[key] = invalid;
            let rated = HYBRID.rate_role(cd, &player);
            assert!(rated.score.is_none() && rated.components.is_none());
            assert_eq!(rated.missing_attributes, [key]);
            assert!(serde_json::to_value(rated)
                .unwrap()
                .get("components")
                .is_none());
        }
        let mut player = attributes(15.0);
        player.as_object_mut().unwrap().remove(key);
        assert!(HYBRID.rate_role(cd, &player).score.is_none());
    }
    let mut player = attributes(15.0);
    for key in ["corners", "leftFoot", "reflexes"] {
        player[key] = Value::Null;
    }
    near(HYBRID.rate_role(cd, &player).score.unwrap(), 75.0);
    player = attributes(15.0);
    for key in ["pace", "consistency", "jumpingReach"] {
        player[key] = Value::Null;
    }
    near(
        HYBRID
            .rate_role(HYBRID.find("gk-defend").unwrap(), &player)
            .score
            .unwrap(),
        75.0,
    );
}

#[test]
fn registry_preserves_defaults_protects_both_presets_and_copies_independently() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = RatingStore::load(dir.path()).unwrap();
    assert_eq!(store.active_system_id, hybrid::SYSTEM_ID);
    assert_eq!(store.list()["systems"].as_array().unwrap().len(), 2);
    let original_catalog = BUILTIN.catalog();
    assert_eq!(original_catalog["modelVersion"], "key2-preferable1-v1");
    assert_eq!(original_catalog["keyWeight"], 2);
    let catalog = HYBRID.catalog();
    assert_eq!(catalog["modelVersion"], hybrid::MODEL_VERSION);
    assert!(catalog.get("keyWeight").is_none() && catalog.get("preferableWeight").is_none());
    assert!(catalog["sources"]
        .as_array()
        .unwrap()
        .contains(&EVIDENCE.source));
    for preset in builtins() {
        assert!(store
            .update(&preset.id, &json!({"name":"Overwrite","revision":1}))
            .is_err());
        assert!(store.delete(&preset.id).is_err());
        assert!(store.create(&json!({"name":preset.name})).is_err());
    }
    store.activate(BUILTIN_ID).unwrap();
    store.persist(dir.path()).unwrap();
    assert_eq!(
        RatingStore::load(dir.path()).unwrap().active().id,
        BUILTIN_ID
    );
    store.activate(hybrid::SYSTEM_ID).unwrap();
    store.persist(dir.path()).unwrap();
    let mut store = RatingStore::load(dir.path()).unwrap();
    assert_eq!(store.active().id, hybrid::SYSTEM_ID);
    assert!(store.systems.is_empty());
    let copy = store
        .create(&json!({"name":"Hybrid copy","sourceId":hybrid::SYSTEM_ID}))
        .unwrap();
    assert_eq!(
        serde_json::to_value(&copy.roles).unwrap(),
        serde_json::to_value(&HYBRID.roles).unwrap()
    );
    assert_eq!(copy.catalog()["modelVersion"], "attribute-weights-v1");
    assert!(copy
        .rate_role(&copy.roles[0], &attributes(15.0))
        .components
        .is_none());
    assert_eq!(store.active().id, hybrid::SYSTEM_ID);
    let mut roles = copy.roles.clone();
    roles[0].weights = Some([("pace".into(), 1.0)].into());
    store
        .update(
            &copy.id,
            &json!({"name":copy.name,"revision":1,"roles":roles}),
        )
        .unwrap();
    assert_ne!(
        store.find(&copy.id).unwrap().roles[0].weights,
        HYBRID.roles[0].weights
    );
    store.activate(&copy.id).unwrap();
    store.persist(dir.path()).unwrap();
    assert_eq!(RatingStore::load(dir.path()).unwrap().active().id, copy.id);
    store.delete(&copy.id).unwrap();
    assert_eq!(store.active().id, hybrid::SYSTEM_ID);
}

#[test]
fn an_existing_custom_name_collision_survives_upgrade_and_weight_edits() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = RatingStore::default();
    let custom = store.create(&json!({"name":"Pre-upgrade custom"})).unwrap();
    store.systems[0].name = HYBRID.name.clone();
    store.activate(&custom.id).unwrap();
    store.persist(dir.path()).unwrap();
    let mut loaded = RatingStore::load(dir.path()).unwrap();
    assert_eq!(loaded.active().id, custom.id);
    assert_eq!(loaded.active().name, HYBRID.name);
    loaded
        .update(&custom.id, &json!({"name":HYBRID.name,"revision":1}))
        .unwrap();
    assert_eq!(loaded.active().revision, 2);
    assert!(loaded.create(&json!({"name":HYBRID.name})).is_err());
    loaded.persist(dir.path()).unwrap();
    assert_eq!(
        RatingStore::load(dir.path()).unwrap().active().id,
        custom.id
    );
}
