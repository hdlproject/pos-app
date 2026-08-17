'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateRangePicker } from '@/components/ui/DateRangePicker';

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-2xl text-text">Reports</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/admin/reports/sales">
            <Button variant="outline" size="sm">Sales Detail</Button>
          </Link>
          <Link href="/admin/reports/hr">
            <Button variant="outline" size="sm">Staff / HR</Button>
          </Link>
          <DateRangePicker from={from} to={to} onChange={({ from, to }) => { setFrom(from); setTo(to); }} />
        </div>
      </div>

      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Revenue</div>
          <div className="text-2xl font-extrabold text-text mt-2">Rp {(sales.data?.totalRevenue ?? 0).toLocaleString('id-ID')}</div>
        </Card>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Orders</div>
          <div className="text-2xl font-extrabold text-text mt-2">{sales.data?.orderCount ?? 0}</div>
        </Card>
        <Card>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wide">Avg order value</div>
          <div className="text-2xl font-extrabold text-text mt-2">
            Rp {(sales.data?.avgOrderValue ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="font-bold text-text mb-3">Best Sellers</h2>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between bg-bg -mx-4 px-4 py-2 text-xs font-bold text-text-muted-2 uppercase">
            <span>Item</span>
            <span>Sold</span>
          </div>
          {bestData?.map((row) => (
            <div key={row.menuItem?.id} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
              <span className="text-text font-semibold">{row.menuItem?.name}</span>
              <span className="text-text-muted">{row.qtySold} sold</span>
            </div>
          ))}
          {bestData?.length === 0 && (
            <p className="text-text-muted text-sm text-center py-6">No sales in this range.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
