'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Popover } from '@/components/ui/Popover';

type ViewMode = 'row' | 'thumbnail';

function orderUrl(qrToken: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/order/${qrToken}`;
}

function EditableLabel({
  label,
  onSave,
  error,
}: {
  label: string;
  onSave: (next: string) => void;
  error: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="font-bold text-sm text-text">{label}</span>
        <button
          onClick={() => { setValue(label); setEditing(true); }}
          aria-label="Edit table name"
          title="Edit table name"
          className="p-1 rounded-lg text-text-muted-2 hover:bg-surface-input transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) { onSave(value.trim()); setEditing(false); }
            if (e.key === 'Escape') setEditing(false);
          }}
          autoFocus
          className="w-32 px-2 py-1 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button
          variant="dark"
          size="sm"
          disabled={!value.trim()}
          onClick={() => { onSave(value.trim()); setEditing(false); }}
        >
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-warning text-xs font-semibold">{error}</p>}
    </div>
  );
}

function QrPopover({ qrToken }: { qrToken: string }) {
  return (
    <Popover
      trigger={({ open, toggle }) => (
        <button
          onClick={toggle}
          aria-label="Show QR"
          title="Show QR"
          className={`shrink-0 p-2 rounded-lg transition-colors ${
            open ? 'bg-surface-input text-accent' : 'text-text-muted-2 hover:bg-surface-input'
          }`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3" />
          </svg>
        </button>
      )}
    >
      <div className="flex items-center justify-center p-2">
        <QRCodeSVG value={orderUrl(qrToken)} size={160} />
      </div>
    </Popover>
  );
}

export default function AdminTablesPage() {
  const utils = trpc.useUtils();
  const tables = trpc.table.list.useQuery();
  const [showNewTableForm, setShowNewTableForm] = useState(false);
  const [label, setLabel] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<{ id: string; message: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('thumbnail');

  const create = trpc.table.create.useMutation({
    onSuccess: () => {
      utils.table.list.invalidate();
      setLabel('');
      setCreateError(null);
      setShowNewTableForm(false);
    },
    onError: (err) => setCreateError(err.message),
  });
  const rename = trpc.table.rename.useMutation({
    onSuccess: () => {
      utils.table.list.invalidate();
      setRenameError(null);
    },
    onError: (err, variables) => setRenameError({ id: variables.id, message: err.message }),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-2xl text-text">Tables</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-bg p-1 rounded-lg">
            <button
              onClick={() => setViewMode('row')}
              aria-label="Row view"
              title="Row view"
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'row' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('thumbnail')}
              aria-label="Thumbnail view"
              title="Thumbnail view"
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'thumbnail' ? 'bg-surface text-accent shadow-sm' : 'text-text-muted-2'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
          </div>
          {!showNewTableForm && (
            <Button variant="primary" onClick={() => setShowNewTableForm(true)}>
              + New Table
            </Button>
          )}
        </div>
      </div>

      {showNewTableForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-text">New Table</h2>
            <Button variant="outline" size="sm" onClick={() => setShowNewTableForm(false)}>
              Cancel
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && label) create.mutate({ label });
              }}
              placeholder="Table label (e.g. T5)"
              className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button variant="dark" disabled={!label} onClick={() => create.mutate({ label })}>
              Add Table
            </Button>
          </div>
          {createError && <p className="text-warning text-xs font-semibold mt-2">{createError}</p>}
        </Card>
      )}

      <Card>
        {viewMode === 'row' ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-bg -mx-4 px-4 py-2 text-xs font-bold text-text-muted-2 uppercase">
              <span>Table</span>
              <span>QR</span>
            </div>
            {tables.data?.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <EditableLabel
                  label={t.label}
                  onSave={(next) => rename.mutate({ id: t.id, label: next })}
                  error={renameError?.id === t.id ? renameError.message : null}
                />
                <QrPopover qrToken={t.qrToken} />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {tables.data?.map((t) => (
              <div key={t.id} className="flex flex-col items-center gap-2 p-3 bg-accent/5 border border-accent/20 rounded-xl">
                <QrPopover qrToken={t.qrToken} />
                <EditableLabel
                  label={t.label}
                  onSave={(next) => rename.mutate({ id: t.id, label: next })}
                  error={renameError?.id === t.id ? renameError.message : null}
                />
              </div>
            ))}
          </div>
        )}
        {tables.data?.length === 0 && (
          <p className="text-text-muted text-sm text-center py-6">No tables yet.</p>
        )}
      </Card>
    </div>
  );
}
