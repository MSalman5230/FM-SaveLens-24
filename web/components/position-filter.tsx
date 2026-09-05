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
      <Button className="clear-positions" variant="ghost" size="sm"
        disabled={disabled || !value.length} onClick={() => onChange([])}>Clear positions</Button>
      <RadioGroup className="position-match" aria-label="Position matching"
        value={match} disabled={disabled || value.length < 2}
        onValueChange={mode => onChange(value, mode as PositionMatch)}>
        <label htmlFor="position-match-and"><RadioGroupItem id="position-match-and" value="and" />AND — All selected</label>
        <label htmlFor="position-match-or"><RadioGroupItem id="position-match-or" value="or" />OR — Any selected</label>
      </RadioGroup>
      <small id="position-rule">
        {match === 'and' ? 'Every selected position must be 15+' : 'At least one selected position must be 15+.'}
      </small>
    </div>
  );
}
