"use client";
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import type { Attribute, Detail, RoleDefinition } from '@/lib/scout-api';
import { formatRoleScore, rankedRoles, roleLabel } from '@/lib/role-ratings';

export function RoleRatings({ player, roles, attributes, initialRoleId }: {
  player: Detail;
  roles: RoleDefinition[];
  attributes: Attribute[];
  initialRoleId: string;
}) {
  const initialRole = roles.find(role => role.id === initialRoleId);
  const [search, setSearch] = useState(initialRole ? roleLabel(initialRole) : '');
  const [expanded, setExpanded] = useState<string[]>(initialRole ? [initialRole.id] : []);
  const labels = useMemo(() => new Map(attributes.map(a => [a.key, a.label])), [attributes]);
  const rows = useMemo(() => rankedRoles(roles, player.roleRatings, search), [roles, player.roleRatings, search]);
  return (
    <section className="role-ratings" aria-label="SaveLens role ratings">
      <p className="role-model-note">SaveLens role ratings measure attribute fit. Key attributes count twice; preferable attributes count once. Position familiarity is separate.</p>
      <div className="role-search">
        <Input aria-label="Search role ratings" placeholder="Search roles and duties…" value={search} onChange={e => setSearch(e.target.value)} />
        {search && <Button variant="outline" onClick={() => setSearch('')}>Show all roles</Button>}
      </div>
      <p className="role-count">{rows.length} of {roles.length} profiles · highest rating first · / 100</p>
      <Accordion value={expanded} onValueChange={setExpanded}>
        {rows.map(({ role, rating }) => {
          const missing = new Set(rating?.missingAttributes ?? []);
          const available = rating?.score != null;
          const sum = (keys: string[]) => keys.reduce((total, key) => total + (player.attributes[key] ?? 0), 0);
          return (
            <AccordionItem key={role.id} value={role.id} className="role-item">
              <AccordionTrigger className="role-trigger">
                <span className="role-name">{roleLabel(role)}<small>{role.group}</small></span>
                <span className="role-score" aria-label={available ? `${rating.score!.toFixed(1)} out of 100` : 'Rating unavailable'}>{formatRoleScore(rating?.score)}</span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="role-tiers">
                  {[
                    { label: 'Key', weight: 2, keys: role.keyAttributes, className: 'role-key' },
                    { label: 'Preferable', weight: 1, keys: role.preferableAttributes, className: 'role-preferable' },
                  ].map(tier => (
                    <section key={tier.label} className={tier.className}>
                      <h4>{tier.label} <span>×{tier.weight} each</span></h4>
                      <ul>{tier.keys.map(key => (
                        <li key={key}><span>{labels.get(key) ?? key}</span><strong>{missing.has(key) ? '—' : player.attributes[key] ?? '—'}</strong></li>
                      ))}</ul>
                    </section>
                  ))}
                </div>
                {available ? (
                  <p className="role-calculation">
                    5 × (2 × {sum(role.keyAttributes)} + {sum(role.preferableAttributes)}) ÷ {2 * role.keyAttributes.length + role.preferableAttributes.length} = <strong>{formatRoleScore(rating.score)}/100</strong>
                    <br />Weighted attribute average: {(rating.score! / 5).toFixed(2)}/20.
                  </p>
                ) : (
                  <p className="role-calculation">Rating unavailable. Missing or invalid attributes: {rating?.missingAttributes.map(key => labels.get(key) ?? key).join(', ') || 'role data unavailable'}.</p>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
      {!rows.length && <p className="role-model-note">No roles match this search.</p>}
      <p className="role-model-note">These scores use FM24’s highlighted attributes and SaveLens’s 2:1 weights. They do not reproduce coach stars or predict match performance. Automatic duties use the applicable Defend, Support, or Attack profile.</p>
    </section>
  );
}
