'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Card } from '@/components/ui/Card';

// Explicit view of the JSON-serialized shape returned by report.bestSellers,
// limited to the fields this page's JSX uses. (Deriving the type directly
// from the tRPC procedure hits TS2589 "Type instantiation is excessively
// deep and possibly infinite" here, because MenuItem's `modifiers Json?`
// field pulls in Prisma's recursive JsonValue union, which pushes the
// compiler past its recursion limit when combined with tRPC's output
// inference. This mirrors the real over-the-wire JSON shape.)
type BestSeller = {
  menuItem: { id: string; name: string } | undefined;
  qtySold: number;
};

export default function ReportsPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = {
    from: new Date(from).toISOString(),
    to: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };

  const sales = trpc.report.dailySales.useQuery(range);
  const best = trpc.report.bestSellers.useQuery(range);
  const bestData = best.data as unknown as BestSeller[] | undefined;
  const usage = trpc.report.inventoryUsage.useQuery(range);
  const shift = trpc.report.shiftSummary.useQuery(range);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-2xl text-text">Reports</h1>
        <div className="flex gap-2 items-center text-sm">
          <label className="flex items-center gap-1.5 text-text-muted-2 font-semibold">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1.5 border border-border-strong rounded-lg bg-surface-input outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-text-muted-2 font-semibold">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1.5 border border-border-strong rounded-lg bg-surface-input outline-none"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Revenue</div>
          <div className="text-2xl font-extrabold text-text mt-2">Rp {sales.data?.totalRevenue ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Orders</div>
          <div className="text-2xl font-extrabold text-text mt-2">{sales.data?.orderCount ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Avg order value</div>
          <div className="text-2xl font-extrabold text-text mt-2">{sales.data?.avgOrderValue?.toFixed(2) ?? '0.00'}</div>
        </Card>
      </div>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">Best Sellers</h2>
        <div className="flex flex-col gap-1.5">
          {bestData?.map((row) => (
            <div key={row.menuItem?.id} className="flex justify-between text-sm py-1">
              <span className="text-text font-semibold">{row.menuItem?.name}</span>
              <span className="text-text-muted">{row.qtySold} sold</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">Inventory Usage</h2>
        {usage.data?.lowStock.map((ing) => (
          <div key={ing.id} className="text-warning text-sm font-bold py-1">{ing.name}: LOW STOCK</div>
        ))}
        {usage.data?.usage.map((m) => (
          <div key={m.id} className="text-sm text-text-muted py-1">
            {m.ingredient.name}: {String(m.delta)} ({m.reason})
          </div>
        ))}
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Shift Summary</h2>
        {shift.data?.map((s) => (
          <div key={s.name} className="flex justify-between text-sm py-1">
            <span className="text-text font-semibold">{s.name}</span>
            <span className="text-text-muted">{s.orderCount} orders, {s.total} collected</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
