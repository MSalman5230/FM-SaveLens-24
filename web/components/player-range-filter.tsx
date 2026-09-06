'use client';

import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { commitRangeBound, rangeValues, type RangeBounds } from '@/lib/range-filter';

function RangeInput({ id, label, value, placeholder, disabled, onCommit }: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <Input id={id} type="number" aria-label={label} min={0} step={1}
    placeholder={placeholder} value={draft ?? value} disabled={disabled}
    onChange={event => setDraft(event.target.value)}
    onBlur={event => {
      if (draft !== null) onCommit(event.target.value);
      setDraft(null);
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
      }
    }} />;
}

export function PlayerRangeFilter({ label, max, value, disabled, onChange }: {
  label: string;
  max: number;
  value: RangeBounds;
  disabled: boolean;
  onChange: (value: RangeBounds) => void;
}) {
  const labelId = useId();
  return (
    <div className="range-field">
      <span className="filter-label" id={labelId}>{label}</span>
      <Slider className="filter-range-slider" aria-labelledby={labelId}
        min={0} max={max} step={1} value={rangeValues(value, max)} disabled={disabled}
        thumbCollisionBehavior="none"
        onValueChange={(values, details) => {
          const index = details.activeThumbIndex;
          if (Array.isArray(values) && (index === 0 || index === 1)) {
            onChange(commitRangeBound(value, index, String(values[index])));
          }
        }} />
      <div className="range-inputs">
        <label htmlFor={`${labelId}-min`}>
          Min
          <RangeInput id={`${labelId}-min`} label={`${label} minimum`} value={value[0]} placeholder="0"
            disabled={disabled} onCommit={raw => onChange(commitRangeBound(value, 0, raw))} />
        </label>
        <label htmlFor={`${labelId}-max`}>
          Max
          <RangeInput id={`${labelId}-max`} label={`${label} maximum`} value={value[1]} placeholder={String(max)}
            disabled={disabled} onCommit={raw => onChange(commitRangeBound(value, 1, raw))} />
        </label>
      </div>
    </div>
  );
}
