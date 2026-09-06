'use client';

import { Button } from '@/components/ui/button';
import {
  Combobox, ComboboxChips, ComboboxChip, ComboboxChipsInput,
  ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty,
  ComboboxTrigger, useComboboxAnchor,
} from '@/components/ui/combobox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { PositionMatch } from '@/lib/position-filter';

export function PositionFilter({ positions, value, match, disabled, onChange }: {
  positions: string[];
  value: string[];
  match: PositionMatch;
  disabled: boolean;
  onChange: (positions: string[], match?: PositionMatch) => void;
}) {
  const anchor = useComboboxAnchor();
  const items = positions.map((_, index) => String(index));
  return (
    <div className="filter-field position-filter">
      <label htmlFor="position">Positions</label>
      <Combobox multiple items={items} value={value} disabled={disabled}
        itemToStringLabel={id => positions[Number(id)]}
        onValueChange={ids => onChange(ids)}>
        <ComboboxChips ref={anchor}>
          {value.map(id => (
            <ComboboxChip key={id} removeLabel={`Remove ${positions[Number(id)]}`}>
              {positions[Number(id)]}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput id="position" aria-label="Positions" placeholder={value.length ? 'Add position…' : 'All positions'}
            aria-describedby="position-rule" />
          <ComboboxTrigger aria-label="Show positions" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>No positions found</ComboboxEmpty>
          <ComboboxList>
            {id => <ComboboxItem key={id} value={id}>{positions[Number(id)]}</ComboboxItem>}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <span id="position-rule" className="sr-only">
        {match === 'and' ? 'Every selected position must be 15+' : 'At least one selected position must be 15+.'}
      </span>
    </div>
  );
}

export function PositionMatching({ value, match, disabled, onChange }: {
  value: string[];
  match: PositionMatch;
  disabled: boolean;
  onChange: (positions: string[], match?: PositionMatch) => void;
}) {
  return (
    <div className="filter-field position-matching">
      <RadioGroup className="position-match" aria-label="Position matching"
        aria-describedby="position-rule"
        value={match} disabled={disabled || value.length < 2}
        onValueChange={mode => onChange(value, mode as PositionMatch)}>
        <label htmlFor="position-match-and"><RadioGroupItem id="position-match-and" value="and" />All (AND)</label>
        <label htmlFor="position-match-or"><RadioGroupItem id="position-match-or" value="or" />Any (OR)</label>
      </RadioGroup>
      {value.length > 0 && <Button className="clear-positions" variant="ghost" size="sm"
        aria-label="Clear positions" disabled={disabled} onClick={() => onChange([])}>Clear</Button>}
    </div>
  );
}
