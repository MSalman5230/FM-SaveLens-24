"use client";
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import type { Attribute, Detail, RoleDefinition } from '@/lib/scout-api';
import { formatRoleScore, rankedRoles, roleLabel } from '@/lib/role-ratings';
import { hybridEvidenceUrl, ratingModel, ratingModelNote, roleWeights } from '@/lib/rating-systems';

export function RoleRatings({ player, roles, attributes, initialRoleId, systemName, systemId }: {
  player: Detail;
  roles: RoleDefinition[];
  attributes: Attribute[];
  initialRoleId: string;
  systemName: string;
  systemId: string;
}) {
  const model = ratingModel(systemId);
  const initialRole = roles.find(role => role.id === initialRoleId);
  const [search, setSearch] = useState(initialRole ? roleLabel(initialRole) : '');
  const [expanded, setExpanded] = useState<string[]>(initialRole ? [initialRole.id] : []);
  const labels = useMemo(() => new Map(attributes.map(a => [a.key, a.label])), [attributes]);
  const rows = useMemo(() => rankedRoles(roles, player.roleRatings, search), [roles, player.roleRatings, search]);
  return (
    <section className="role-ratings" aria-label="SaveLens role ratings">
      <p className="role-model-note"><strong>{systemName}</strong> · {ratingModelNote(systemId)} Position familiarity is separate.</p>
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
          const weighted = Object.entries(roleWeights(role)).filter(([, weight]) => weight > 0);
          const denominator = weighted.reduce((sum, [, weight]) => sum + weight, 0);
          const numerator = weighted.reduce((sum, [key, weight]) => sum + (player.attributes[key] ?? 0) * weight, 0);
          return (
            <AccordionItem key={role.id} value={role.id} className="role-item">
              <AccordionTrigger className="role-trigger">
                <span className="role-name">{roleLabel(role)}<small>{role.group}</small></span>
                <span className="role-score" aria-label={available ? `${rating.score!.toFixed(1)} out of 100` : 'Rating unavailable'}>{formatRoleScore(rating?.score)}</span>
              </AccordionTrigger>
              <AccordionContent>
                {model === 'highlighted' ? <div className="role-tiers">
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
                </div> : <div className="custom-role-breakdown"><table>
                  <caption>Attribute contributions to {roleLabel(role)}</caption>
                  <thead><tr><th>Attribute</th><th>Value / 20</th><th>{model === 'hybrid' ? 'Effective weight' : 'Weight'}</th><th>Points / 100</th></tr></thead>
                  <tbody>{weighted.map(([key, weight]) => <tr key={key}>
                    <th scope="row">{labels.get(key) ?? key}</th><td>{missing.has(key) ? '—' : player.attributes[key] ?? '—'}</td>
                    <td>{model === 'hybrid' ? `${(100 * weight / denominator).toFixed(2)}%` : weight}</td><td>{missing.has(key) || player.attributes[key] == null ? '—' : (5 * player.attributes[key]! * weight / denominator).toFixed(2)}</td>
                  </tr>)}</tbody>
                </table></div>}
                {available ? (
                  <p className="role-calculation">
                    {model === 'hybrid' && rating.components ? <>70% × {rating.components.testingScore.toFixed(2)} (testing) + 30% × {rating.components.roleScore.toFixed(2)} (role fit)</> : model === 'highlighted' ? <>5 × (2 × {sum(role.keyAttributes)} + {sum(role.preferableAttributes)}) ÷ {denominator}</> : <>5 × {Number(numerator.toPrecision(8))} ÷ {Number(denominator.toPrecision(8))}</>} = <strong>{formatRoleScore(rating.score)}/100</strong>
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
      <p className="role-model-note">{model === 'hybrid' ? <>An evidence-informed performance index, not a validated match forecast or coach star rating. The blend and role boosts are modeling choices; team-level tests do not establish individual role effects. Goalkeeper profiles use separate GK evidence. <a href={hybridEvidenceUrl} target="_blank" rel="noreferrer">FM-Arena research</a>. </> : <>{model === 'highlighted' ? 'These scores use FM24’s highlighted attributes and SaveLens’s 2:1 weights. ' : ''}Scores do not reproduce coach stars or predict match performance. </>}Automatic duties use the applicable Defend, Support, or Attack profile.</p>
    </section>
  );
}
