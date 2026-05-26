import { useEffect, useRef } from 'react';

import {
  listDrivers,
  type DriverKind,
} from '~shared/types/datasource.js';
import { DriverIcon } from './DriverIcon.js';

interface AddDataSourceMenuProps {
  /** Anchor element — the `+` button. The menu positions itself just
   * below this element so the popover hugs the toolbar that opened it. */
  anchor: HTMLElement | null;
  onPick(kind: DriverKind): void;
  onClose(): void;
}

/** Floating dropdown listing every supported driver. v0.1 ships with
 * three (Postgres / MySQL / MariaDB); the future "Complete Support"
 * sub-section from JetBrains is omitted until we add more clients. */
export function AddDataSourceMenu({
  anchor,
  onPick,
  onClose,
}: AddDataSourceMenuProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchor.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  if (!anchor) return null;

  // Anchor the popover under the trigger button. Pulled into an inline
  // style because the trigger could be anywhere on the page — no fixed
  // offset works in CSS alone.
  const rect = anchor.getBoundingClientRect();
  const style: React.CSSProperties = {
    top: rect.bottom + 4,
    left: rect.left,
  };

  const drivers = listDrivers();
  return (
    <div ref={ref} className="ds-add-menu" role="menu" style={style}>
      <div className="ds-add-menu-section">Available drivers</div>
      {drivers.map((d) => (
        <button
          key={d.kind}
          type="button"
          className="ds-add-menu-item"
          role="menuitem"
          onClick={() => onPick(d.kind)}
        >
          <span className="ds-add-menu-item-icon" aria-hidden>
            <DriverIcon kind={d.kind} size={18} />
          </span>
          <span className="ds-add-menu-item-label">{d.label}</span>
        </button>
      ))}
    </div>
  );
}
