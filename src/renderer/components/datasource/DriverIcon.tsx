import type { DriverKind } from '~shared/types/datasource.js';

interface DriverIconProps {
  kind: DriverKind;
  size?: number;
}

/** Compact tinted glyph per supported driver. JetBrains uses the real
 * mascots (elephant / dolphin / seal); we go with abstract chips so the
 * style stays consistent with the rest of the icon set in NodeGrip. */
export function DriverIcon({ kind, size = 16 }: DriverIconProps): JSX.Element {
  if (kind === 'postgres') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none">
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3"
          fill="#336791"
        />
        <text
          x="8"
          y="11.2"
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="9"
          fontWeight="700"
          fill="#ffffff"
        >
          pg
        </text>
      </svg>
    );
  }
  if (kind === 'mysql') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none">
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3"
          fill="#00758f"
        />
        <text
          x="8"
          y="11.2"
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="8"
          fontWeight="700"
          fill="#ffffff"
        >
          my
        </text>
      </svg>
    );
  }
  // mariadb
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="none">
      <rect
        x="1.5"
        y="1.5"
        width="13"
        height="13"
        rx="3"
        fill="#7a2d4a"
      />
      <text
        x="8"
        y="11.2"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="8"
        fontWeight="700"
        fill="#ffffff"
      >
        ma
      </text>
    </svg>
  );
}
