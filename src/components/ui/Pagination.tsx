import { Button } from './Button';

type PaginationProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
};

// Page/Previous/Next footer shared by every paginated admin list --
// centralized so the "Page X of Y (N items)" math and controls don't
// drift out of sync across pages.
export function Pagination({ page, pageSize, totalItems, onPageChange, itemLabel = 'item' }: PaginationProps) {
  if (totalItems === 0) return null;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);

  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
      <span className="text-xs text-text-muted">
        Page {currentPage} of {totalPages} ({totalItems} {itemLabel}{totalItems === 1 ? '' : 's'})
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
