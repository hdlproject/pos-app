'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
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
        <DataTable
          columns={[
            {
              header: 'Order',
              render: (order) => (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-text font-semibold">
                    {ORDER_TYPE_LABEL[order.type] ?? order.type}
                    {order.table && ` · ${order.table.label}`}
                    <span className="text-text-muted font-normal ml-2">
                      {new Date(order.createdAt).toLocaleString('id-ID')}
                    </span>
                  </span>
                  <span className="text-xs text-text-muted">
                    {order.items.map((item) => `${item.menuItem.name} ×${item.qty}`).join(', ')}
                  </span>
                </div>
              ),
            },
            {
              header: 'Total',
              width: 'w-32',
              align: 'right',
              render: (order) => <span className="text-sm text-text font-bold">Rp {Number(order.total).toLocaleString('id-ID')}</span>,
            },
          ]}
          rows={orders.data}
          rowKey={(order) => order.id}
          emptyMessage="No orders in this range."
        />
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Inventory Usage</h2>
        <DataTable
          columns={[
            { header: 'Ingredient', render: (m) => <span className="text-sm text-text font-semibold">{m.ingredient?.name}</span> },
            {
              header: 'Movement',
              align: 'right',
              render: (m) => <span className="text-sm text-text-muted">{String(m.totalDelta)} {m.ingredient?.unit}</span>,
            },
          ]}
          rows={usage.data?.usage}
          rowKey={(m) => m.ingredientId}
          emptyMessage="No stock movements in this range."
        />
      </Card>
    </div>
  );
}
