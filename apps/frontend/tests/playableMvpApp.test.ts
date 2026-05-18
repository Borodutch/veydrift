import { describe, expect, test } from "bun:test";
import { infrastructureActionNoticeFor } from "../src/PlayableMvpApp";

describe("Playable MVP app display helpers", () => {
  test("does not duplicate pending infrastructure action messages", () => {
    expect(infrastructureActionNoticeFor({
      status: "pending",
      label: "Waiting for wallet confirmation",
    })).toBeUndefined();
  });

  test("keeps terminal infrastructure action notices visible", () => {
    expect(infrastructureActionNoticeFor({
      status: "error",
      label: "Building upgrade transaction failed.",
    })).toEqual({
      label: "Building upgrade transaction failed.",
      tone: "error",
    });

    expect(infrastructureActionNoticeFor({
      status: "success",
      label: "Building upgrade confirmed on-chain.",
    })).toEqual({
      label: "Building upgrade confirmed on-chain.",
      tone: "success",
    });
  });
});
