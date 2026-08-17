'use client';
import { useEffect, useRef, useState } from 'react';

type DateRangePickerProps = {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatShort(s: string): string {
  const d = parseISODate(s);
  return `${MONTH_LABELS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function formatDisplay(from: string, to: string): string {
  const year = parseISODate(to).getFullYear();
  if (from === to) return `${formatShort(from)}, ${year}`;
  return `${formatShort(from)} – ${formatShort(to)}, ${year}`;
}

function buildMonthGrid(viewYear: number, viewMonth: number): (Date | null)[] {
  const firstDay = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(viewYear, viewMonth, day));
  return cells;
}

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const initialTo = parseISODate(to);
  const [viewYear, setViewYear] = useState(initialTo.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialTo.getMonth());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSelecting(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function handleDayClick(day: Date) {
    const iso = toISODate(day);
    if (!selecting) {
      onChange({ from: iso, to: iso });
      setSelecting(true);
    } else {
      if (iso < from) {
        onChange({ from: iso, to: from });
      } else {
        onChange({ from, to: iso });
      }
      setSelecting(false);
      setOpen(false);
    }
  }

  const cells = buildMonthGrid(viewYear, viewMonth);
  const previewDate = selecting ? hoverDate : null;
  const rangeStart = previewDate && previewDate < from ? previewDate : from;
  const rangeEnd = previewDate && previewDate < from ? from : previewDate ?? to;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm font-semibold text-text outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent"
      >
        <svg
          className="w-4 h-4 text-text-muted-2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {formatDisplay(from, to)}
      </button>

      {open && (
        <div className="absolute z-20 top-full mt-2 right-0 bg-surface border border-border rounded-2xl shadow-lg p-3 w-[min(280px,calc(100vw-2rem))]">
          <div className="flex items-center justify-between mb-2 px-1">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted-2 hover:bg-surface-input transition-colors"
            >
              &#8249;
            </button>
            <span className="text-sm font-bold text-text">
              {MONTH_LABELS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={goToNextMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted-2 hover:bg-surface-input transition-colors"
            >
              &#8250;
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {WEEKDAY_LABELS.map((w, i) => (
              <span key={i} className="text-[10px] font-bold text-text-muted uppercase">
                {w}
              </span>
            ))}
            {cells.map((day, i) => {
              if (!day) return <span key={i} />;
              const iso = toISODate(day);
              const isStart = iso === rangeStart;
              const isEnd = iso === rangeEnd;
              const isInRange = iso > rangeStart && iso < rangeEnd;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  onMouseEnter={() => setHoverDate(iso)}
                  className={`h-8 text-xs font-semibold rounded-lg transition-colors ${
                    isStart || isEnd
                      ? 'bg-accent text-white'
                      : isInRange
                        ? 'bg-accent/15 text-text'
                        : 'text-text hover:bg-surface-input'
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
