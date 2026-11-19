import { useEffect, useState } from 'react';
import { parseMoney } from '../../core/money';

function toText(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2);
}

/** A text field for dollar amounts that keeps integer cents as its value. */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = '0.00',
  required,
  ariaLabel,
  autoFocus,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  id?: string;
  placeholder?: string;
  required?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(toText(value));
  useEffect(() => {
    if (parseMoney(text) !== value) setText(toText(value));
    // Only react to outside changes of the value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      required={required}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMoney(e.target.value));
      }}
      onBlur={() => {
        const v = parseMoney(text);
        setText(toText(v));
      }}
    />
  );
}
