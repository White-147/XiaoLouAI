import { describe, expect, it } from "vitest";
import {
  assertSyntheticFixtureBoundary,
  createSyntheticMediaScope,
  parseJsonBody,
  SYNTHETIC_ACTOR_ID,
} from "./synthetic-fixtures";

describe("synthetic fixture helpers", () => {
  it("builds synthetic account media scope and parses JSON request bodies", () => {
    expect(createSyntheticMediaScope()).toEqual({
      accountOwnerType: "user",
      accountOwnerId: SYNTHETIC_ACTOR_ID,
      regionCode: "CN",
      currency: "CNY",
    });
    expect(
      parseJsonBody({
        path: "synthetic-request",
        init: {
          body: JSON.stringify({
            fixture: "synthetic",
          }),
        },
      }),
    ).toEqual({
      fixture: "synthetic",
    });
  });

  it("rejects high-signal real material markers in shared fixtures", () => {
    expect(() =>
      assertSyntheticFixtureBoundary({
        path: "deploy/local-secrets/legacy/.env",
      }),
    ).toThrow("Synthetic fixture boundary rejected real-material marker");

    expect(() =>
      parseJsonBody({
        path: "synthetic-request",
        init: {
          body: JSON.stringify({
            key: "-----BEGIN PRIVATE KEY-----",
          }),
        },
      }),
    ).toThrow("Synthetic fixture boundary rejected real-material marker");
  });
});
