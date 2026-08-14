type CategoryIconProps = {
  category: string;
  className?: string;
};

const CATEGORY_STYLES: Record<string, { from: string; to: string }> = {
  Coffee: { from: '#efe3d6', to: '#e4d3c0' },
  Tea: { from: '#e4ece1', to: '#d3e0cf' },
  Food: { from: '#f0e2cf', to: '#e6d2b6' },
  Pastry: { from: '#f2e6dc', to: '#ead4c2' },
  Snacks: { from: '#eee0d6', to: '#e2ccbe' },
};

const FALLBACK_STYLE = { from: '#f3ede3', to: '#e9e0d2' };

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'w-6 h-6',
};

function CoffeeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z" />
      <path d="M16 10h2a2 2 0 0 1 0 4h-2" />
      <path d="M8 3c0 1-1 1-1 2s1 1 1 2" />
      <path d="M12 3c0 1-1 1-1 2s1 1 1 2" />
    </svg>
  );
}

function TeaIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 11h11a4 4 0 0 1 0 8H7a4 4 0 0 1-4-8Z" />
      <path d="M14 12l6-2" />
      <path d="M7 11V8a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function FoodIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function PastryIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 15c0-6 4-10 9-10 4 0 7 3 7 7 0 1-1 2-2 1-1-2-3-3-5-3-4 0-7 3-7 7 0 1-2 1-2-2Z" />
    </svg>
  );
}

function SnacksIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 10h14l-1.5 9a2 2 0 0 1-2 1.7H8.5a2 2 0 0 1-2-1.7L5 10Z" />
      <path d="M9 10V6M12 10V5M15 10V6" />
    </svg>
  );
}

function FallbackIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4M12 15h.01" />
    </svg>
  );
}

const CATEGORY_ICONS: Record<string, () => React.JSX.Element> = {
  Coffee: CoffeeIcon,
  Tea: TeaIcon,
  Food: FoodIcon,
  Pastry: PastryIcon,
  Snacks: SnacksIcon,
};

export function CategoryIcon({ category, className = '' }: CategoryIconProps) {
  const style = CATEGORY_STYLES[category] ?? FALLBACK_STYLE;
  const Icon = CATEGORY_ICONS[category] ?? FallbackIcon;

  return (
    <div
      className={`flex items-center justify-center text-text-muted-2 ${className}`}
      style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
    >
      <Icon />
    </div>
  );
}
