"use client";
import { useState } from 'react';
import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { columnMatches, defaultColumns } from '@/lib/player-columns';
import type { PlayerColumn } from '@/lib/player-columns';

export function PlayerColumnChooser({ columns, selected, onChange, disabled }: {
  columns: PlayerColumn[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean;
}) {
  const [search, setSearch] = useState('');
  const filtered = columns.filter(column => columnMatches(column, search));
  const groups = [...new Set(filtered.map(column => column.group))];
  const roleCount = selected.filter(id => id.startsWith('role:')).length;
  return (
    <Dialog onOpenChange={open => { if (open) setSearch(''); }}>
      <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        <Columns3 size={16} /> Edit columns
      </DialogTrigger>
      <DialogContent className="column-chooser">
        <DialogHeader>
          <DialogTitle>Player list columns</DialogTitle>
          <DialogDescription>Tick the columns to show. Choose as many role ratings as you like; each is out of 100.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Search columns" placeholder="Search columns or roles…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="column-actions">
          <span aria-live="polite">{selected.length} columns · {roleCount} role ratings</span>
          <Button size="sm" variant="ghost" onClick={() => onChange([...new Set([...selected, ...columns.filter(c => c.roleId).map(c => c.id)])])}>All roles</Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(selected.filter(id => !id.startsWith('role:')))}>Clear roles</Button>
          <Button size="sm" variant="ghost" onClick={() => onChange([...defaultColumns])}>Reset view</Button>
        </div>
        <div className="column-options">
          {groups.map(group => (
            <fieldset key={group}>
              <legend>{group}</legend>
              <div className="column-option-grid">
                {filtered.filter(column => column.group === group).map(column => (
                  <label key={column.id} className="column-option">
                    <Checkbox checked={selected.includes(column.id)} disabled={column.id === 'name'}
                      onCheckedChange={checked => onChange(checked ? [...selected, column.id] : selected.filter(id => id !== column.id))} />
                    <span>{column.label}{column.id === 'name' && <small>Always shown</small>}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {!filtered.length && <p className="muted">No columns match this search.</p>}
        </div>
        <DialogFooter className="column-footer">
          <span>Your view is remembered on this device.</span>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
