'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateRangePicker } from '@/components/ui/DateRangePicker';

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

export default function SalesDetailPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = {
    from: new Date(from).toISOString(),
    to: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };

  const orders = trpc.report.salesDetail.useQuery(range);
  const usage = trpc.report.inventoryUsage.useQuery(range);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-2xl text-text">Sales Detail</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/admin/reports">
            <Button variant="outline" size="sm">Back to Reports</Button>
          </Link>
          <DateRangePicker from={from} to={to} onChange={({ from, to }) => { setFrom(from); setTo(to); }} />
        </div>
      </div>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">Orders</h2>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between bg-bg -mx-4 px-4 py-2 text-xs font-bold text-text-muted-2 uppercase">
            <span>Order</span>
            <span>Total</span>
          </div>
          {orders.data?.map((order) => (
            <div key={order.id} className="flex flex-col gap-1 px-3 py-2 border-b border-border last:border-0">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text font-semibold">
                  {ORDER_TYPE_LABEL[order.type] ?? order.type}
                  {order.table && ` · ${order.table.label}`}
                  <span className="text-text-muted font-normal ml-2">
                    {new Date(order.createdAt).toLocaleString('id-ID')}
                  </span>
                </span>
                <span className="text-text font-bold">Rp {Number(order.total).toLocaleString('id-ID')}</span>
              </div>
              <div className="text-xs text-text-muted">
                {order.items.map((item) => `${item.menuItem.name} ×${item.qty}`).join(', ')}
              </div>
            </div>
          ))}
          {orders.data?.length === 0 && (
            <p className="text-text-muted text-sm text-center py-6">No orders in this range.</p>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Inventory Usage</h2>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between bg-bg -mx-4 px-4 py-2 text-xs font-bold text-text-muted-2 uppercase">
            <span>Ingredient</span>
            <span>Movement</span>
          </div>
          {usage.data?.usage.map((m) => (
            <div key={m.id} className="flex justify-between text-sm px-3 py-1.5 border-b border-border last:border-0">
              <span className="text-text font-semibold">{m.ingredient.name}</span>
              <span className="text-text-muted">{String(m.delta)} ({m.reason})</span>
            </div>
          ))}
          {usage.data?.usage.length === 0 && (
            <p className="text-text-muted text-sm text-center py-6">No stock movements in this range.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
