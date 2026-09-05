# Custom weighted rating systems

In **Settings → Rating systems**, choose **New system** to copy the selected system. The bundled **Role Highlighted Rating** preset stays protected and retains its 85 profiles and 2:1 calculations. System copies contain independent definitions; editing a source does not modify its copies.

The additional protected **FM-Arena Hybrid Rating** preset combines **70% role-adjusted experimental importance with 30% highlighted role fit** across the same 85 profiles. It leaves your active selection intact until you choose **Use system**. See [the formula, evidence, and worked example](FM_ARENA_HYBRID.md). Either preset can be copied for customization.

Choose a role and edit individual attribute weights. Technical, Mental, Physical, Goalkeeping, Left foot, Right foot, and Consistency are supported. Other hidden attributes are excluded. Weights may be nonnegative decimals; zero excludes an attribute. At least one weight must be positive. The editor shows each attribute's percentage of the total; weights need not add up to 100.

**Save changes** updates the current custom role and system name. **Save as new role** copies the edited role under a new name, preserving its source, duty, and group. **Save as new system** captures the current draft in an independent system. Unsaved edits can be saved or discarded when changing roles, systems, tabs, or closing Settings. System names are unique; role names are unique for each duty within a system, ignoring case and surrounding whitespace. Names contain 1–100 characters.

**Use system** makes a saved system active across the workspace. Saving an inactive system does not activate it. The active system supplies player filters, sorting, table columns, and profile breakdowns. Only custom systems and added roles can be deleted; deleting an active custom system restores FM-Arena Hybrid Rating. Settings → General retains the save-folder controls.

## Calculation

`score = 5 × Σ(attribute × weight) / Σ(weight)`

Inputs are the existing displayed 1–20 values, including feet and Consistency. Values are not scaled again or inverted. Missing, nonnumeric, or out-of-range attributes with positive weights make the score unavailable (`null`); excluded attributes do not affect it. Full precision is used for filtering and sorting; scores are displayed to one decimal. Scores measure attribute fit and do not reproduce coach stars or predict match performance.

SQL and player-detail calculations use the same validated weight maps. Null scores sort last in either direction, with CA descending and ID ascending as tie-breakers. Filtering and sorting happen before pagination; additional visible role columns are scored only for the returned page.

## Local persistence

`rating-systems.json` lives in the existing application data directory. Its version-1 structure contains `schemaVersion`, `activeSystemId`, and custom `systems`. Both built-in systems are supplied by bundled definitions and are not editable. Systems contain `id`, `name`, `revision`, `builtIn`, and complete `roles` with explicit `weights` maps. Copies preserve role IDs; added roles use `custom-<UUID>` IDs. Existing custom names that collide with a newly bundled preset remain loadable; new naming changes cannot use reserved preset names.

Writes are atomic and published to memory only after successful persistence. Folder changes and imports leave rating systems intact. Workspaces without a saved selection default to `fm-arena-hybrid-rating`; saved selections are preserved; snapshots need no migration or reimport. Saved calculations are reusable definitions, not frozen player results. Malformed or unsupported persisted definitions fail loading without overwriting the file.

## API

- `GET /api/rating-systems`: system summaries, `activeSystemId`, and the active `catalog`.
- `GET /api/rating-systems/:id`: full system definition.
- `POST /api/rating-systems`: create a system with `{name, sourceId?, roles?}`. The default source is FM-Arena Hybrid Rating. Omitted roles copy the source; supplied roles capture a draft. Returns the created system with status 201.
- `PUT /api/rating-systems/:id`: update `{name, revision, roles?}`. The revision must match; stale writes return 409. Successful updates increment the revision and return the saved system.
- `PUT /api/rating-systems/active`: activate `{systemId}` and return the list with its active catalog.
- `DELETE /api/rating-systems/:id`: delete a custom system and return the updated list/catalog. Built-in modification/deletion and invalid definitions return 400; unknown systems return 404.

System write bodies support up to 4 MiB. All 85 original role IDs must remain present; only added roles may be removed. Role metadata is anchored to a valid bundled role/duty, and only allowlisted attribute keys and finite numeric weights reach SQL.

`GET /api/roles` now returns the **active** catalog with `systemId`, `systemName`, `systemRevision`, `builtIn`, and explicit role `weights`. The bundled version/source metadata remains available. Custom systems use model version `attribute-weights-v1` and omit the fixed `keyWeight` / `preferableWeight` fields.

FM-Arena Hybrid Rating uses `fm-arena-hybrid-v1`, adds the experimental source, and also omits the fixed-weight fields. Available hybrid detail ratings include `components: {testingScore, roleScore}` for the 70/30 breakdown; original/custom ratings and unavailable scores omit this field.

Existing player query parameters (`role`, `roles`, `roleMin`, `sort=roleRating`, `sort=role:<id>`) resolve against the active catalog. Player search and detail responses include `systemId` and `systemRevision`. Clients may send those two query parameters to require a specific active definition; a mismatch returns 409. The frontend refreshes the active catalog on workspace changes, conflicts, and window focus, and scopes requests to both snapshot and rating identity so old responses cannot replace new scores.
