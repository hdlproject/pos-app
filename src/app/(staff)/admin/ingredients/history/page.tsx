'use client';
import { trpc } from '@/lib/trpc-client';
import { Card } from '@/components/ui/Card';

export default function IngredientHistoryPage() {
  const history = trpc.stockBatch.listHistory.useQuery();

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Stock Adjustment History</h1>

      <div className="flex flex-col gap-4">
        {history.data?.map((batch) => (
          <Card key={batch.id}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span
                className={`text-xs font-extrabold uppercase px-2 py-1 rounded-full ${
                  batch.status === 'CONFIRMED' ? 'bg-success/15 text-success' : 'bg-border text-text-muted-2'
                }`}
              >
                {batch.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'}
              </span>
              <span className="text-xs text-text-muted">
                {new Date(batch.createdAt).toLocaleString('id-ID')}
              </span>
            </div>
            {batch.note && <p className="text-sm text-text mb-2">{batch.note}</p>}
            <div className="flex flex-col gap-1 mb-2">
              {batch.lines.map((line) => (
                <div key={line.id} className="flex justify-between text-sm">
                  <span className="text-text">{line.ingredient.name}</span>
                  <span className={Number(line.delta) >= 0 ? 'text-success' : 'text-warning'}>
                    {Number(line.delta) >= 0 ? '+' : ''}{String(line.delta)} {line.ingredient.unit} ({line.reason === 'RESTOCK' ? 'Restock' : 'Manual Adjust'})
                  </span>
                </div>
              ))}
            </div>
            <div className="text-xs text-text-muted">
              Staged by {batch.createdBy.name}
              {batch.status === 'CONFIRMED' && batch.confirmedBy &&
                ` · Confirmed by ${batch.confirmedBy.name} on ${new Date(batch.confirmedAt!).toLocaleString('id-ID')}`}
            </div>
          </Card>
        ))}
        {history.data?.length === 0 && (
          <p className="text-text-muted text-sm text-center py-6">No history yet.</p>
        )}
      </div>
    </div>
  );
}
