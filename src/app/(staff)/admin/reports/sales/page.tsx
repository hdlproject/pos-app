'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { SearchSortToolbar } from '@/components/ui/SearchSortToolbar';
import { Pagination } from '@/components/ui/Pagination';
import { normalizeForSearch } from '@/lib/normalizeForSearch';

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
};

const PAGE_SIZE = 10;

type OrderSortField = 'date' | 'total';
type UsageSortField = 'name' | 'movement';
type SortOrder = 'asc' | 'desc';

export default function SalesDetailPage() {
  const [from, setFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const range = {
    from: new Date(from).toISOString(),
    to: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString(),
  };

  const orders = trpc.report.salesDetail.useQuery(range);
  const usage = trpc.report.inventoryUsage.useQuery(range);

  const [orderSearch, setOrderSearch] = useState('');
  const [orderTypeFilter, setOrderTypeFilter] = useState('all');
  const [orderSortField, setOrderSortField] = useState<OrderSortField>('date');
  const [orderSortOrder, setOrderSortOrder] = useState<SortOrder>('desc');
  const [orderPage, setOrderPage] = useState(1);

  const [usageSearch, setUsageSearch] = useState('');
  const [usageSortField, setUsageSortField] = useState<UsageSortField>('movement');
  const [usageSortOrder, setUsageSortOrder] = useState<SortOrder>('asc');
  const [usagePage, setUsagePage] = useState(1);

  const normalizedOrderSearch = normalizeForSearch(orderSearch);
  const filteredOrders = (orders.data ?? [])
    .filter((order) => orderTypeFilter === 'all' || order.type === orderTypeFilter)
    .filter((order) => {
      if (!normalizedOrderSearch) return true;
      const haystack = [
        order.table?.label ?? '',
        ORDER_TYPE_LABEL[order.type] ?? order.type,
        ...order.items.map((item) => item.menuItem.name),
      ].join(' ');
      return normalizeForSearch(haystack).includes(normalizedOrderSearch);
    });
  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const diff = orderSortField === 'date'
      ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      : Number(a.total) - Number(b.total);
    return orderSortOrder === 'asc' ? diff : -diff;
  });
  const orderTotalPages = Math.max(1, Math.ceil(sortedOrders.length / PAGE_SIZE));
  const orderCurrentPage = Math.min(orderPage, orderTotalPages);
  const paginatedOrders = sortedOrders.slice((orderCurrentPage - 1) * PAGE_SIZE, orderCurrentPage * PAGE_SIZE);

  const normalizedUsageSearch = normalizeForSearch(usageSearch);
  const filteredUsage = (usage.data?.usage ?? [])
    .filter((m) => !normalizedUsageSearch || normalizeForSearch(m.ingredient?.name ?? '').includes(normalizedUsageSearch));
  const sortedUsage = [...filteredUsage].sort((a, b) => {
    const diff = usageSortField === 'name'
      ? (a.ingredient?.name ?? '').localeCompare(b.ingredient?.name ?? '')
      : Number(a.totalDelta) - Number(b.totalDelta);
    return usageSortOrder === 'asc' ? diff : -diff;
  });
  const usageTotalPages = Math.max(1, Math.ceil(sortedUsage.length / PAGE_SIZE));
  const usageCurrentPage = Math.min(usagePage, usageTotalPages);
  const paginatedUsage = sortedUsage.slice((usageCurrentPage - 1) * PAGE_SIZE, usageCurrentPage * PAGE_SIZE);

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
        <SearchSortToolbar
          search={orderSearch}
          onSearchChange={(v) => { setOrderSearch(v); setOrderPage(1); }}
          searchPlaceholder="Search orders…"
          sortOptions={[
            { value: 'date', label: 'Date' },
            { value: 'total', label: 'Total' },
          ]}
          sortField={orderSortField}
          onSortFieldChange={(v) => { setOrderSortField(v as OrderSortField); setOrderPage(1); }}
          sortOrder={orderSortOrder}
          onSortOrderChange={(v) => { setOrderSortOrder(v); setOrderPage(1); }}
          filter={{
            label: 'Type',
            value: orderTypeFilter,
            onChange: (v) => { setOrderTypeFilter(v); setOrderPage(1); },
            options: [
              { value: 'all', label: 'All types' },
              { value: 'DINE_IN', label: 'Dine-in' },
              { value: 'TAKEAWAY', label: 'Takeaway' },
              { value: 'DELIVERY', label: 'Delivery' },
            ],
          }}
        />
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
          rows={paginatedOrders}
          rowKey={(order) => order.id}
          emptyMessage="No orders match your filters."
        />
        {sortedOrders.length > 0 && (
          <Pagination page={orderPage} pageSize={PAGE_SIZE} totalItems={sortedOrders.length} onPageChange={setOrderPage} itemLabel="order" />
        )}
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Inventory Usage</h2>
        <SearchSortToolbar
          search={usageSearch}
          onSearchChange={(v) => { setUsageSearch(v); setUsagePage(1); }}
          searchPlaceholder="Search ingredients…"
          sortOptions={[
            { value: 'movement', label: 'Movement' },
            { value: 'name', label: 'Ingredient' },
          ]}
          sortField={usageSortField}
          onSortFieldChange={(v) => { setUsageSortField(v as UsageSortField); setUsagePage(1); }}
          sortOrder={usageSortOrder}
          onSortOrderChange={(v) => { setUsageSortOrder(v); setUsagePage(1); }}
        />
        <DataTable
          columns={[
            { header: 'Ingredient', render: (m) => <span className="text-sm text-text font-semibold">{m.ingredient?.name}</span> },
            {
              header: 'Movement',
              align: 'right',
              render: (m) => <span className="text-sm text-text-muted">{Math.abs(Number(m.totalDelta))} {m.ingredient?.unit}</span>,
            },
          ]}
          rows={paginatedUsage}
          rowKey={(m) => m.ingredientId}
          emptyMessage="No stock movements match your filters."
        />
        {sortedUsage.length > 0 && (
          <Pagination page={usagePage} pageSize={PAGE_SIZE} totalItems={sortedUsage.length} onPageChange={setUsagePage} itemLabel="ingredient" />
        )}
      </Card>
    </div>
  );
}
