import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ContextMenuItem =
  | {
      kind: 'item';
      label: string;
      onClick(): void;
      /** When set, the row is dimmed and clicks are ignored. The
       * `title` doubles as a tooltip explaining why. */
      disabled?: boolean;
      title?: string;
      /** Reddens the label — used for destructive actions like Remove. */
      destructive?: boolean;
    }
  | { kind: 'separator' };

interface ContextMenuProps {
  /** Mouse position the menu was opened at. The component nudges
   * itself off-screen edges automatically so the full menu stays in
   * view regardless of where the cursor was. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose(): void;
}

/** Floating popover anchored at viewport coords. Closes on Esc,
 * click-outside, or window resize. Items can be disabled (with a
 * tooltip) or destructive (red). Reusable across the project — kept
 * inside `components/datasource/` for now since that's its only
 * caller; promote to a shared location when a second user appears. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // Adjusted position after we measure the rendered menu and clamp
  // against the viewport. Initial render uses the raw coords; the
  // layout effect below corrects in the same frame.
  const [pos, setPos] = useState({ top: y, left: x });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 6;
    let nextLeft = x;
    let nextTop = y;
    if (rect.width + x + pad > window.innerWidth) {
      nextLeft = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (rect.height + y + pad > window.innerHeight) {
      nextTop = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (nextLeft !== pos.left || nextTop !== pos.top) {
      setPos({ left: nextLeft, top: nextTop });
    }
    // We deliberately depend only on x/y — re-running on `pos` would
    // loop. The effect should fire once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onResize = () => onClose();
    // Pointerdown gets the click before the original target reacts,
    // which is what users expect from a context menu dismissal.
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ top: pos.top, left: pos.left }}
    >
      {items.map((item, idx) =>
        item.kind === 'separator' ? (
          <div key={`sep-${idx}`} className="ctx-menu-sep" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            className={
              'ctx-menu-item' +
              (item.disabled ? ' ctx-menu-item-disabled' : '') +
              (item.destructive ? ' ctx-menu-item-destructive' : '')
            }
            role="menuitem"
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
