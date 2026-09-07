/**
 * Human-readable file size, e.g. "243 KB" / "5.0 MB" (ui-spec.md §8/§10
 * attachment rows: "battery-report.pdf   243 KB"). Shared by
 * `AttachmentUploader` (queued-file rows) and `AttachmentList` (Ticket
 * Detail rows) so the two never drift apart on rounding/units.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
