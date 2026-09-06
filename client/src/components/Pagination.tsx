import { Button } from "./Button";
import { SelectField, type SelectOption } from "./SelectField";
import type { TicketPageSize } from "../tickets/api";
import "./Pagination.css";

/** The three allowed page sizes (ui-spec.md §9, AC-26). */
export type PageSizeValue = TicketPageSize;

const PAGE_SIZE_OPTIONS: SelectOption[] = [
  { value: "10", label: "10" },
  { value: "20", label: "20" },
  { value: "50", label: "50" },
];

export interface PaginationProps {
  page: number;
  pageSize: PageSizeValue;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSizeValue) => void;
  /** While a request is in flight (ui-spec.md §9 Loading row: controls disabled). */
  disabled?: boolean;
}

/**
 * My Tickets list pagination (ui-spec.md §9, AC-26): "Showing a-b of
 * total", Prev/Next (disabled at the ends), numbered pages, and a
 * rows-per-page select (10/20/50).
 *
 * Every number here is read straight from the caller's `meta` — never
 * derived by counting `items.length` — so it stays correct even though
 * this component itself never sees the ticket rows. The caller only
 * mounts this alongside an actual, non-empty rendered list (see
 * MyTicketsScreen's "rows" branch); the empty / no-results / over-page
 * states replace the list (and this component) entirely.
 */
export function Pagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
  disabled = false,
}: PaginationProps) {
  const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  function handlePageSizeChange(value: string) {
    onPageSizeChange(Number(value) as PageSizeValue);
  }

  return (
    <div className="zen-pagination">
      <p className="zen-pagination__summary">
        Showing {firstItem}–{lastItem} of {totalItems}
      </p>

      <nav className="zen-pagination__pages" aria-label="Pagination">
        <Button
          variant="secondary"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || page <= 1}
        >
          ‹ Prev
        </Button>

        {pageNumbers.map((number) => (
          <Button
            key={number}
            variant={number === page ? "primary" : "tertiary"}
            className="zen-pagination__page-button"
            aria-label={`Page ${number}`}
            aria-current={number === page ? "page" : undefined}
            onClick={() => onPageChange(number)}
            disabled={disabled || number === page}
          >
            {number}
          </Button>
        ))}

        <Button
          variant="secondary"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || page >= totalPages}
        >
          Next ›
        </Button>
      </nav>

      <div className="zen-pagination__page-size">
        <SelectField
          id="my-tickets-page-size"
          label="Rows"
          value={String(pageSize)}
          onChange={handlePageSizeChange}
          options={PAGE_SIZE_OPTIONS}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
