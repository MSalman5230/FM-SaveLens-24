"use client";
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBestRole, formatRoleScore, roleLabel } from '@/lib/role-ratings';
import type { PlayerColumn } from '@/lib/player-columns';
import type { Player, RoleDefinition } from '@/lib/scout-api';

export function PlayerListTable({ players, columns, roles, sort, direction, onSort, onOpen }: {
  players: Player[]; columns: PlayerColumn[]; roles: RoleDefinition[]; sort: string; direction: string;
  onSort: (key: string) => void; onOpen: (id: number, roleId?: string) => void;
}) {
  function cell(player: Player, column: PlayerColumn) {
    if (column.id === 'bestRoleRating') {
      const best = player.bestRole;
      const role = roles.find(role => role.id === best?.roleId);
      if (!best || !role) return <span className="muted" aria-label="Best role rating unavailable">—</span>;
      return <button className="role-table-score" title={`${roleLabel(role)} · View attribute breakdown`}
        aria-label={`Best role rating: ${formatRoleScore(best.score)} out of 100, ${roleLabel(role)}. View breakdown for ${player.name}`}
        onClick={e => { e.stopPropagation(); onOpen(player.id, best.roleId); }}>{formatBestRole(best.score, role)}</button>;
    }
    if (column.roleId) {
      const score = player.roleScores?.[column.roleId];
      return <button className="role-table-score" title={score == null ? 'Rating unavailable — view attribute breakdown' : 'View attribute breakdown'}
        aria-label={`${column.label}: ${formatRoleScore(score)}${score == null ? ', rating unavailable' : ' out of 100'}. View breakdown for ${player.name}`}
        onClick={e => { e.stopPropagation(); onOpen(player.id, column.roleId); }}>{formatRoleScore(score)}</button>;
    }
    switch (column.id) {
      case 'name': return <button className="player-name" title={player.name} onClick={e => { e.stopPropagation(); onOpen(player.id); }}>{player.name}</button>;
      case 'age': return player.age;
      case 'club': return <span className={!player.club ? 'muted' : ''}>{player.club ?? 'Unavailable'}</span>;
      case 'nationalities': return <span className="nationality" title={player.nationalities.join(' · ')}>{player.nationalities[0]}{player.nationalities.length > 1 && <small> +{player.nationalities.length - 1}</small>}</span>;
      case 'positions': return <span className="positions">{player.positions.join(', ') || 'Unavailable'}</span>;
      case 'ca': return <span className="ca">{player.ca}</span>;
      case 'pa': return <div className="potential"><strong>{player.pa}</strong><span><i style={{ width: `${player.pa / 2}%` }} /></span></div>;
    }
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>{columns.map(column => (
          <TableHead key={column.id} className={column.roleId || column.id === 'bestRoleRating' ? 'player-column-role' : column.id === 'name' ? 'player-column-name' : ''}
            aria-sort={column.sort && sort === column.sort ? direction === 'asc' ? 'ascending' : 'descending' : undefined}>
            {column.sort ? <button className="sort-button" onClick={() => onSort(column.sort!)} aria-label={`Sort by ${column.label}`}>
              <span>{column.label}{(column.roleId || column.id === 'bestRoleRating') && <small>/ 100</small>}</span>
              {sort === column.sort && (direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}
            </button> : column.label}
          </TableHead>
        ))}</TableRow>
      </TableHeader>
      <TableBody>{players.map(player => (
        <TableRow key={player.id} onClick={() => onOpen(player.id)} className="player-row">
          {columns.map(column => <TableCell key={column.id} className={column.id === 'name' ? 'player-column-name' : column.roleId || column.id === 'bestRoleRating' || column.id === 'age' || column.id === 'ca' ? 'number' : ''}>{cell(player, column)}</TableCell>)}
        </TableRow>
      ))}</TableBody>
    </Table>
  );
}
