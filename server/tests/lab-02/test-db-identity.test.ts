import { describe, expect, it } from "vitest";
import {
  parseDatabaseIdentity,
  sameDatabase,
} from "../../scripts/test-db.lib.js";

// Regression tests for the trailing-slash defect raised in PR #22 review
// round 2: `parseDatabaseIdentity()` used to strip only the *leading*
// slash from the URL path, so "postgresql://h/toktickit_test" and
// "postgresql://h/toktickit_test/" parsed to different database names
// ("toktickit_test" vs "toktickit_test/") and were treated as different
// databases — silently defeating the dev/test same-database safety check
// in `resolveTestDatabaseUrl()`. These exercise the parsing/comparison
// logic directly, rather than only indirectly through .env file
// manipulation, per the review request.

describe("parseDatabaseIdentity / sameDatabase (PR #22 review round 2, point 2)", () => {
  it("treats a trailing slash as equivalent to no trailing slash", () => {
    const noSlash = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const trailingSlash = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test/"
    );

    expect(noSlash.database).toBe("toktickit_test");
    expect(trailingSlash.database).toBe("toktickit_test");
    expect(sameDatabase(noSlash, trailingSlash)).toBe(true);
  });

  it("collapses repeated trailing slashes too", () => {
    const noSlash = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const doubleSlash = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test//"
    );

    expect(doubleSlash.database).toBe("toktickit_test");
    expect(sameDatabase(noSlash, doubleSlash)).toBe(true);
  });

  it("treats localhost, 127.0.0.1 and [::1] as the same host", () => {
    const viaHostname = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const viaIPv4Loopback = parseDatabaseIdentity(
      "postgresql://user:pass@127.0.0.1:5432/toktickit_test"
    );
    const viaIPv6Loopback = parseDatabaseIdentity(
      "postgresql://user:pass@[::1]:5432/toktickit_test"
    );

    expect(sameDatabase(viaHostname, viaIPv4Loopback)).toBe(true);
    expect(sameDatabase(viaHostname, viaIPv6Loopback)).toBe(true);
    expect(sameDatabase(viaIPv4Loopback, viaIPv6Loopback)).toBe(true);
  });

  it("treats an explicit default port the same as an omitted port", () => {
    const explicitPort = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const omittedPort = parseDatabaseIdentity(
      "postgresql://user:pass@localhost/toktickit_test"
    );

    expect(explicitPort.port).toBe(5432);
    expect(omittedPort.port).toBe(5432);
    expect(sameDatabase(explicitPort, omittedPort)).toBe(true);
  });

  it("ignores a ?schema=public query suffix", () => {
    const withoutSchema = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const withSchema = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test?schema=public"
    );

    expect(sameDatabase(withoutSchema, withSchema)).toBe(true);
  });

  it("ignores differing credentials", () => {
    const asAlice = parseDatabaseIdentity(
      "postgresql://alice:secret1@localhost:5432/toktickit_test"
    );
    const asBob = parseDatabaseIdentity(
      "postgresql://bob:secret2@localhost:5432/toktickit_test"
    );

    expect(sameDatabase(asAlice, asBob)).toBe(true);
  });

  it("does NOT treat a genuinely different database name as the same database", () => {
    const testDb = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const devDb = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_dev"
    );

    expect(sameDatabase(testDb, devDb)).toBe(false);
  });

  it("does NOT treat a genuinely different host as the same database", () => {
    const local = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const remote = parseDatabaseIdentity(
      "postgresql://user:pass@db.example.com:5432/toktickit_test"
    );

    expect(sameDatabase(local, remote)).toBe(false);
  });

  it("does NOT treat a genuinely different port as the same database", () => {
    const defaultPort = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5432/toktickit_test"
    );
    const otherPort = parseDatabaseIdentity(
      "postgresql://user:pass@localhost:5433/toktickit_test"
    );

    expect(sameDatabase(defaultPort, otherPort)).toBe(false);
  });

  it("throws on a URL with no database name", () => {
    expect(() =>
      parseDatabaseIdentity("postgresql://user:pass@localhost:5432/")
    ).toThrow(/no database name/);
  });

  it("throws on an unparseable URL", () => {
    expect(() => parseDatabaseIdentity("not a url")).toThrow(
      /Could not parse database URL/
    );
  });
});
