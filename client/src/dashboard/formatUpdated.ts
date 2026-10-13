/**
 * "Updated 14:05 (Bangkok)" header text (lab-04 ui-spec.md §3.1) from the
 * payload's `generatedAt`. Time of day is derived via Intl in Asia/Bangkok,
 * never from the host's own timezone.
 */
const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatUpdated(generatedAt: string): string {
  const parts = TIME_FORMATTER.formatToParts(new Date(generatedAt));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `Updated ${hour}:${get("minute")} (Bangkok)`;
}
