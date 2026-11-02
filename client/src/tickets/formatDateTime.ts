const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Derives the Bangkok-local calendar/time fields via Intl (never a
// hand-rolled UTC+7 offset, and never the host-local getUTC*()/get*()
// getters) so the result is correct regardless of the host's own timezone.
// `month: "numeric"` is deliberate: `en-GB`/`en-US`/etc. all abbreviate
// September as "Sept" (4 letters), which does not match the ui-spec.md
// mockups ("1 Sep 2026, 15:14" / "1 Sep, 15:14") — so the 3-letter month is
// taken from MONTH_ABBREVIATIONS instead of any locale's own short-month
// output.
const PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

interface BangkokParts {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
}

function toBangkokParts(iso: string): BangkokParts {
  const parts = PARTS_FORMATTER.formatToParts(new Date(iso));
  const lookup = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const monthIndex = Number(lookup("month")) - 1;
  // `hour: "2-digit", hour12: false` renders local midnight as "24" in some
  // ICU versions instead of "00" — normalize it so minutes never read past
  // a real day boundary.
  const hour = lookup("hour") === "24" ? "00" : lookup("hour");

  return {
    day: String(Number(lookup("day"))),
    month: MONTH_ABBREVIATIONS[monthIndex],
    year: lookup("year"),
    hour,
    minute: lookup("minute"),
  };
}

/**
 * Renders a response timestamp for display in Asia/Bangkok
 * (specification.md BR-04/A-11) without a year, e.g. "1 Sep, 15:14"
 * (ui-spec.md §9 My Tickets list, §10 removed-attachment line).
 */
export function formatDateTime(iso: string): string {
  const { day, month, hour, minute } = toBangkokParts(iso);
  return `${day} ${month}, ${hour}:${minute}`;
}

/**
 * Same as `formatDateTime` but with the year included, e.g.
 * "1 Sep 2026, 15:14" (ui-spec.md §10 Ticket Date field).
 */
export function formatDateTimeWithYear(iso: string): string {
  const { day, month, year, hour, minute } = toBangkokParts(iso);
  return `${day} ${month} ${year}, ${hour}:${minute}`;
}

/** `YYYY-MM-DDTHH:mm` in Asia/Bangkok for a `datetime-local` input, matching the
 * wall clock `formatDateTime` displays. */
export function toBangkokInputValue(date: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(typeof date === "string" ? new Date(date) : date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Inverse of `toBangkokInputValue`: the ISO instant, or `null` when the value is not a complete date-time. */
export function fromBangkokInputValue(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(`${value}${value.length === 16 ? ":00" : ""}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
