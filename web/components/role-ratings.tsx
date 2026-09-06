"use client";
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import type { Detail, RoleDefinition } from '@/lib/scout-api';
import { eligiblePlayerRoles, formatRoleScore, groupedRoles, roleLabel, type RoleFamily } from '@/lib/role-ratings';

function PositionRoles({ name, families, initialRoleId }: {
  name: string;
  families: RoleFamily[];
  initialRoleId: string;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  return (
    <section className="role-position-group" aria-label={name}>
      <h3>{name}</h3>
      <Accordion multiple value={families.filter(family => !collapsed.includes(family.id)).map(family => family.id)}
        onValueChange={expanded => setCollapsed(previous => [
          ...previous.filter(id => !families.some(family => family.id === id)),
          ...families.filter(family => !expanded.includes(family.id)).map(family => family.id),
        ])}>
        {families.map(family => (
          <AccordionItem key={family.id} value={family.id} className="role-item">
            <AccordionTrigger className="role-trigger">
              <span className="role-name">{family.name}<small>{family.rows.length} {family.rows.length === 1 ? 'duty' : 'duties'}</small></span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="role-duties" aria-label={`${family.name} duty ratings`}>
                {family.rows.map(({ role, rating }) => (
                  <li key={role.id} className="role-duty" data-selected={role.id === initialRoleId || undefined}>
                    <span className="role-duty-name">{role.duty[0].toUpperCase() + role.duty.slice(1)}
                      {role.id === initialRoleId && <small>Selected role</small>}
                    </span>
                    <span className="role-score" aria-label={`${roleLabel(role)}: ${rating?.score != null ? `${formatRoleScore(rating.score)} out of 100` : 'Rating unavailable'}`}>
                      {formatRoleScore(rating?.score)}
                    </span>
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

export function RoleRatings({ player, roles, initialRoleId, systemName }: {
  player: Detail;
  roles: RoleDefinition[];
  initialRoleId: string;
  systemName: string;
}) {
  const [search, setSearch] = useState('');
  const eligible = useMemo(() => eligiblePlayerRoles(roles, player.positionRatings), [roles, player.positionRatings]);
  const groups = useMemo(() => groupedRoles(eligible, player.roleRatings, search), [eligible, player.roleRatings, search]);
  const count = groups.reduce((total, group) => total + group.families.reduce((sum, family) => sum + family.rows.length, 0), 0);
  return (
    <section className="role-ratings" aria-label="SaveLens role ratings">
      <p className="role-model-note"><strong>{systemName}</strong> · Role ratings out of 100. Position familiarity is separate.</p>
      <div className="role-search">
        <Input aria-label="Search role ratings" placeholder="Search roles and duties…" value={search} onChange={e => setSearch(e.target.value)} />
        {search && <Button variant="outline" onClick={() => setSearch('')}>Show all roles</Button>}
      </div>
      <p className="role-count" aria-live="polite">{count} of {eligible.length} profiles · role families ranked by best score within each position · / 100</p>
      {groups.map(group => <PositionRoles key={group.name} {...group} initialRoleId={initialRoleId} />)}
      {!count && <p className="role-model-note">{search ? 'No roles match this search.' : 'No role profiles are available for this player.'}</p>}
      <p className="role-model-note">A dash means the rating is unavailable. Scores do not reproduce coach stars or predict match performance. Automatic duties use the applicable Defend, Support, or Attack profile.</p>
    </section>
  );
}
