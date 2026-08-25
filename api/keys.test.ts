import { describe, expect, it } from "vitest";
import { cooldownFrom, isBadKey, isExhausted, keyPool, withKey } from "./keys.js";

const quota = (message: string, status = 429) =>
  Object.assign(new Error(message), { status });

describe("classifying a failure", () => {
  it("treats 429 as exhaustion whatever it says", () => {
    expect(isExhausted(429, "slow down")).toBe(true);
  });

  it("treats a 403 about quota as exhaustion, but not any 403", () => {
    expect(isExhausted(403, "quota exceeded for metric")).toBe(true);
    expect(isExhausted(403, "the caller does not have permission")).toBe(true);
    expect(isExhausted(403, "model not found")).toBe(false);
  });

  it("separates a typo'd key from a spent one", () => {
    expect(isBadKey(400, "API key not valid. Please pass a valid API key.")).toBe(true);
    expect(isBadKey(429, "quota exceeded")).toBe(false);
    expect(isExhausted(400, "API key not valid")).toBe(false);
  });
});

describe("cooldown length", () => {
  it("believes Google's retry hint", () => {
    expect(cooldownFrom("Please retry in 43.5s.")).toBe(43_500);
  });

  it("refuses a hint so short it would just spin", () => {
    expect(cooldownFrom("Please retry in 2s.")).toBe(30_000);
  });

  it("caps a hint that would park a key for hours", () => {
    expect(cooldownFrom("Please retry in 9999s.")).toBe(20 * 60_000);
  });

  it("falls back when there is no hint at all", () => {
    expect(cooldownFrom("quota exceeded")).toBe(90_000);
  });
});

describe("the key pool", () => {
  it("puts keys pasted in the app before the environment's", () => {
    process.env.GEMINI_API_KEY = "env-one";
    expect(keyPool("GEMINI", ["user-one"])).toEqual(["user-one", "env-one"]);
  });

  it("reads a key numbered _1, which is the obvious way to name a first one", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY_1 = "first";
    process.env.GEMINI_API_KEY_2 = "second";
    expect(keyPool("GEMINI")).toEqual(["first", "second"]);
    delete process.env.GEMINI_API_KEY_1;
    delete process.env.GEMINI_API_KEY_2;
  });

  it("does not hand back the same key twice", () => {
    process.env.GEMINI_API_KEY = "same";
    expect(keyPool("GEMINI", ["same"])).toEqual(["same"]);
  });
});

describe("withKey", () => {
  it("moves to the next key when one is spent", async () => {
    process.env.GEMINI_API_KEY = "spent";
    process.env.GEMINI_API_KEY_2 = "good";
    const seen: string[] = [];
    const out = await withKey(
      "GEMINI",
      async (key) => {
        seen.push(key);
        if (key === "spent") throw quota("quota exceeded. Please retry in 60s.");
        return "answered";
      },
      [],
      `rotate-${Math.random()}`,
    );
    expect(out).toBe("answered");
    expect(seen).toContain("good");
  });

  it("skips a typo'd key instead of failing the whole request", async () => {
    delete process.env.GEMINI_API_KEY_2;
    process.env.GEMINI_API_KEY = "working";
    const out = await withKey(
      "GEMINI",
      async (key) => {
        if (key === "typo") throw Object.assign(new Error("API key not valid."), { status: 400 });
        return "answered";
      },
      ["typo"],
      `badkey-${Math.random()}`,
    );
    expect(out).toBe("answered");
  });

  it("does not swallow a real error — only quota and bad keys are survivable", async () => {
    process.env.GEMINI_API_KEY = "working";
    await expect(
      withKey("GEMINI", async () => {
        throw Object.assign(new Error("model is on fire"), { status: 500 });
      }, [], `fatal-${Math.random()}`),
    ).rejects.toThrow(/on fire/);
  });

  it("says so plainly when there is no key at all", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY_2;
    delete process.env.GEMINI_API_KEYS;
    await expect(withKey("GEMINI", async () => "x", [], "empty")).rejects.toThrow(/No GEMINI key/);
  });

  it("reports a spent pool as a quota problem the caller can fall back from", async () => {
    process.env.GEMINI_API_KEY = "spent-a";
    process.env.GEMINI_API_KEY_2 = "spent-b";
    await expect(
      withKey("GEMINI", async () => {
        throw quota("quota exceeded. Please retry in 40s.");
      }, [], `allspent-${Math.random()}`),
    ).rejects.toThrow(/^QUOTA:/);
  });
});
