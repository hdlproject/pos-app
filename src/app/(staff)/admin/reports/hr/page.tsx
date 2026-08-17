'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
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
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between bg-surface-input rounded-lg px-3 py-2 text-xs font-bold text-text-muted-2 uppercase">
            <span>Staff</span>
            <span>Orders / Total</span>
          </div>
          {shift.data?.map((s) => (
            <div key={s.name} className="flex justify-between text-sm px-3 py-1.5 border-b border-border last:border-0">
              <span className="text-text font-semibold">{s.name}</span>
              <span className="text-text-muted">{s.orderCount} orders, Rp {s.total.toLocaleString('id-ID')} collected</span>
            </div>
          ))}
          {shift.data?.length === 0 && (
            <p className="text-text-muted text-sm text-center py-6">No shifts in this range.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
