const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Bangkok",
});

/**
 * Renders a response timestamp for display in Asia/Bangkok (api-spec.md
 * §1.1). Its own module (rather than living in a screen file) so screen
 * files can stay component-only exports.
 */
export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMATTER.format(new Date(iso));
}
