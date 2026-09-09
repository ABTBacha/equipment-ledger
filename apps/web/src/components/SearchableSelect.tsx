'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
  /**
   * Background utility class for the field itself. Every other input in the app uses
   * whichever background reads as "raised" relative to its immediate container (a
   * bg-surface panel gets bg-raised fields; a bg-raised panel, e.g. a modal, gets
   * bg-surface fields) — defaults to bg-raised, the more common case.
   */
  fieldBackground?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  disabled,
  'aria-label': ariaLabel,
  fieldBackground = 'bg-raised',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlight]?.scrollIntoView?.({ block: 'nearest' });
  }, [highlight, open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const openDropdown = () => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
  };

  const selectOption = (option: SearchableSelectOption) => {
    onChange(option.value);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        openDropdown();
        return;
      }
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered[highlight]) {
        selectOption(filtered[highlight]);
      } else {
        openDropdown();
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery('');
      }
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : ''}
        onFocus={openDropdown}
        onMouseDown={() => {
          // Selecting an option (or pressing Escape) closes the dropdown but keeps
          // focus on the input, so a plain `focus` event never fires again on the
          // next click. Reopen explicitly whenever the field is clicked while closed.
          if (!open) openDropdown();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        className={`border border-hairline ${fieldBackground} px-3 py-2 w-full text-primary placeholder:text-muted disabled:opacity-50`}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto border border-hairline bg-surface"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matches.</li>
          ) : (
            filtered.map((option, i) => (
              <li key={option.value}>
                <button
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={(e) => {
                    // Prevent the input's blur (and thus the outside-click close handler
                    // racing it) from firing before the click is registered.
                    e.preventDefault();
                  }}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3 py-2 text-sm border-l-2 ${
                    i === highlight
                      ? 'bg-raised border-accent-blue text-accent-blue'
                      : 'border-transparent bg-surface text-primary'
                  }`}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
