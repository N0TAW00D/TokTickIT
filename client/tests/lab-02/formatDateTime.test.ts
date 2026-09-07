import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatDateTimeWithYear,
} from "../../src/tickets/formatDateTime.ts";

// Covers specification.md BR-04/A-11 ("stored in UTC ... displayed in
// Asia/Bangkok") and the ui-spec.md mockups that spell out the exact
// rendered string: §10 Ticket Date ("1 Sep 2026, 15:14", with year) and §9
// My Tickets / the §10 removed-attachment line ("1 Sep, 09:14" /
// "Removed 1 Sep, 09:02", without year).
//
// These assert LITERAL expected strings for known instants rather than
// calling formatDateTime/formatDateTimeWithYear to build their own
// expectation — a test that derives its expectation from the function under
// test can never fail no matter how wrong that function is (this is exactly
// how a UTC-instead-of-Bangkok regression, and a "Sept"-instead-of-"Sep"
// regression, previously survived review undetected).

describe("formatDateTimeWithYear", () => {
  it("converts a UTC instant to Asia/Bangkok (UTC+7) and includes the year", () => {
    // 2026-09-01T08:14:00Z + 7h = 2026-09-01 15:14 Bangkok.
    expect(formatDateTimeWithYear("2026-09-01T08:14:00Z")).toBe(
      "1 Sep 2026, 15:14",
    );
  });

  it("abbreviates September as the 3-letter 'Sep', not the locale-default 'Sept'", () => {
    expect(formatDateTimeWithYear("2026-09-01T08:14:00Z")).toContain(" Sep ");
    expect(formatDateTimeWithYear("2026-09-01T08:14:00Z")).not.toContain(
      "Sept",
    );
  });

  it("rolls the date and year forward across the UTC+7 midnight boundary", () => {
    // 2025-12-31T17:00:00Z + 7h = 2026-01-01 00:00 Bangkok: both the day
    // AND the year change relative to the UTC instant's own date/year.
    expect(formatDateTimeWithYear("2025-12-31T17:00:00Z")).toBe(
      "1 Jan 2026, 00:00",
    );
  });
});

describe("formatDateTime (no year)", () => {
  it("converts a UTC instant to Asia/Bangkok (UTC+7) without a year", () => {
    // 2026-09-01T02:14:00Z + 7h = 2026-09-01 09:14 Bangkok
    // (ui-spec.md §9 My Tickets list row: "1 Sep, 09:14").
    expect(formatDateTime("2026-09-01T02:14:00.000Z")).toBe("1 Sep, 09:14");
  });

  it("omits the year entirely", () => {
    expect(formatDateTime("2026-09-01T02:14:00.000Z")).not.toMatch(/2026/);
  });

  it("abbreviates September as 'Sep', not 'Sept'", () => {
    expect(formatDateTime("2026-09-01T02:14:00.000Z")).not.toContain("Sept");
  });

  it("rolls the date forward across the UTC+7 midnight boundary", () => {
    // 2025-12-31T17:00:00Z + 7h = 2026-01-01 00:00 Bangkok.
    expect(formatDateTime("2025-12-31T17:00:00Z")).toBe("1 Jan, 00:00");
  });
});
