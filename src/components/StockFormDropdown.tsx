import React, { useEffect, useRef, useState } from 'react';

export type StockFormDropdownOption = {
  value: string;
  label: string;
};

type StockFormDropdownProps = {
  value: string;
  options: StockFormDropdownOption[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  includeEmptyOption?: boolean;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  className?: string;
};

export function StockFormDropdown({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  includeEmptyOption = true,
  ariaLabelledBy,
  ariaLabel,
  className = '',
}: StockFormDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((opt) => opt.value === value)?.label;

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [disabled]);

  return (
    <div className={`stock-form-dropdown ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={
          'stock-form-dropdown-trigger' + (disabled ? ' stock-form-dropdown-trigger--disabled' : '')
        }
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <span className="stock-form-dropdown-trigger-text">
          {selectedLabel ? (
            selectedLabel
          ) : (
            <span className="stock-form-dropdown-placeholder">{placeholder}</span>
          )}
        </span>
        <span className="stock-form-dropdown-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && !disabled && (
        <div className="stock-form-dropdown-panel" role="listbox">
          {includeEmptyOption && (
            <button
              type="button"
              role="option"
              className={
                'stock-form-dropdown-option' +
                (value === '' ? ' stock-form-dropdown-option--selected' : '')
              }
              aria-selected={value === ''}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {placeholder}
            </button>
          )}
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              className={
                'stock-form-dropdown-option' +
                (value === opt.value ? ' stock-form-dropdown-option--selected' : '')
              }
              aria-selected={value === opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
