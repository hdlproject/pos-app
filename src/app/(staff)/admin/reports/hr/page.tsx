'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { DateRangePicker } from '@/components/ui/DateRangePicker';

export default function HrReportPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = {
    from: new Date(from).toISOString(),
    to: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };

  const shift = trpc.report.shiftSummary.useQuery(range);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="font-display text-2xl text-text">Staff / HR</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/admin/reports">
            <Button variant="outline" size="sm">Back to Reports</Button>
          </Link>
          <DateRangePicker from={from} to={to} onChange={({ from, to }) => { setFrom(from); setTo(to); }} />
        </div>
      </div>

      <Card>
        <h2 className="font-bold text-text mb-3">Shift Summary</h2>
        <DataTable
          columns={[
            { header: 'Staff', render: (s) => <span className="text-sm text-text font-semibold">{s.name}</span> },
            {
              header: 'Orders / Total',
              align: 'right',
              render: (s) => <span className="text-sm text-text-muted">{s.orderCount} orders, Rp {s.total.toLocaleString('id-ID')} collected</span>,
            },
          ]}
          rows={shift.data}
          rowKey={(s) => s.name}
          emptyMessage="No shifts in this range."
        />
      </Card>
    </div>
  );
}
