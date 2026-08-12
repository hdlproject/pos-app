'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';

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
  const range = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };

  const sales = trpc.report.dailySales.useQuery(range);
  const best = trpc.report.bestSellers.useQuery(range);
  const bestData = best.data as unknown as BestSeller[] | undefined;
  const usage = trpc.report.inventoryUsage.useQuery(range);
  const shift = trpc.report.shiftSummary.useQuery(range);

  return (
    <main>
      <h1>Reports</h1>
      <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>

      <section>
        <h2>Daily Sales</h2>
        <p>Revenue: {sales.data?.totalRevenue}</p>
        <p>Orders: {sales.data?.orderCount}</p>
        <p>Avg order value: {sales.data?.avgOrderValue.toFixed(2)}</p>
      </section>

      <section>
        <h2>Best Sellers</h2>
        {bestData?.map((row) => (
          <p key={row.menuItem?.id}>{row.menuItem?.name}: {row.qtySold} sold</p>
        ))}
      </section>

      <section>
        <h2>Inventory Usage</h2>
        {usage.data?.lowStock.map((ing) => <p key={ing.id} style={{ color: 'red' }}>{ing.name}: LOW STOCK</p>)}
        {usage.data?.usage.map((m) => (
          <p key={m.id}>{m.ingredient.name}: {String(m.delta)} ({m.reason})</p>
        ))}
      </section>

      <section>
        <h2>Shift Summary</h2>
        {shift.data?.map((s) => <p key={s.name}>{s.name}: {s.orderCount} orders, {s.total} collected</p>)}
      </section>
    </main>
  );
}
