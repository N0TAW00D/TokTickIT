/**
 * Saves an already-fetched `Blob` to the user's downloads as `filename`,
 * via a transient `<a download>` element.
 *
 * The attachment bytes come from an authenticated `fetch`
 * (`credentials: "include"`, api-spec.md §1.2) rather than a plain
 * `<a href>` pointing at the API endpoint, so the download doesn't navigate
 * the single-page app away to a bare API response. Instead the caller
 * downloads the bytes itself and hands the resulting `Blob` here. The
 * object URL is revoked immediately after the click is dispatched (the
 * browser has already captured the data by then).
 */
export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
