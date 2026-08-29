import { describe, expect, it } from "vitest";
import { aboutThisRecord, highlights, sameSong } from "./evidence.js";

describe("sameSong", () => {
  it("matches a plain title", () => {
    expect(sameSong("Maggot Brain", "Maggot Brain")).toBe(true);
  });

  it("ignores case and punctuation", () => {
    expect(sameSong("A LOVE SUPREME, PT. I", "a love supreme pt i")).toBe(true);
  });

  it("sees through a remaster suffix", () => {
    expect(sameSong("Alive (Remastered 2011)", "Alive")).toBe(true);
    expect(sameSong("Teardrop [Single Version]", "Teardrop")).toBe(true);
  });

  it("accepts a title that extends the one asked for", () => {
    expect(sameSong("Pyramid Song", "Pyramid Song (Live)")).toBe(true);
  });

  it("rejects a different song — the case that poisoned the credits", () => {
    expect(sameSong("Worrywort", "Pyramid Song")).toBe(false);
    expect(sameSong("Better Man (Pearl Jam song)", "Alive")).toBe(false);
  });

  it("matches titles in scripts other than Latin", () => {
    expect(sameSong("על כל אלה", "על כל אלה")).toBe(true);
    expect(sameSong("プラスチックラブ", "プラスチックラブ")).toBe(true);
    expect(sameSong("Кино", "Кино")).toBe(true);
  });

  it("still tells two different non-Latin titles apart", () => {
    expect(sameSong("על כל אלה", "ירושלים של זהב")).toBe(false);
  });

  it("sees through a parenthetical on a Hebrew title", () => {
    expect(sameSong("על כל אלה (גרסה חיה)", "על כל אלה")).toBe(true);
  });

  it("rejects rather than guessing when either side is missing", () => {
    expect(sameSong(undefined, "Alive")).toBe(false);
    expect(sameSong("Alive", "")).toBe(false);
    expect(sameSong("!!!", "Alive")).toBe(false);
  });
});

describe("highlights", () => {
  const filler = (word: string, n: number) => Array(n).fill(`${word} sentence here.`).join(" ");

  it("keeps the sections a song's life is written down in, whole", () => {
    const article = [
      "The song was released in 1991.",
      "",
      "== Recording ==",
      filler("desk", 200),
      "",
      "== In popular culture ==",
      "It was played at the 1996 Olympics and parodied by Weird Al in 1992.",
      "",
      "== Personnel ==",
      filler("engineer", 200),
    ].join("\n");

    const kept = highlights(article, 900);
    expect(kept).toContain("Weird Al");
    expect(kept).toContain("In popular culture");
  });

  it("takes the named sections before it ranks anything by keyword", () => {
    const article = [
      "Opening paragraph about the song itself.",
      "",
      "== Trivia ==",
      "The band sued, and the lawsuit was settled in court after the accusation.",
      "",
      "== Legacy ==",
      "Whitney Houston's version became the one everybody knows.",
    ].join("\n");

    const kept = highlights(article, 260);
    expect(kept).toContain("Whitney Houston");
  });

  it("leaves a short article exactly as it found it", () => {
    expect(highlights("Short and complete.", 500)).toBe("Short and complete.");
  });
});

describe("highlights, ranked by what a section holds", () => {
  const filler = (word: string, n: number) => Array(n).fill(`${word} sentence here.`).join(" ");

  it("keeps a story filed under a heading nobody would have listed", () => {
    // Stairway to Heaven files its most repeated myth under "Claims of backmasking",
    // which no hand-written list of section names was ever going to contain.
    const article = [
      "The song was released in 1971.",
      "",
      "== Composition ==",
      filler("desk", 300),
      "",
      "== Claims of backmasking ==",
      "Played backward the line was purported to contain references to Satan, and a trial followed after broadcasters accused the band of subliminal messages.",
      "",
      "== Personnel ==",
      filler("engineer", 300),
    ].join("\n");

    const kept = highlights(article, 1200);
    expect(kept).toContain("backward");
  });

  it("does not let another artist's version outrank the record itself", () => {
    // Five cover sections were pushing the song's own recording out of the budget.
    const article = [
      "A protest song from 1971.",
      "",
      "== Cover versions ==",
      "Many artists covered it and released their versions on tribute albums over the years.",
      "",
      "== Recording ==",
      "The label head refused to release it, telling him it was the worst thing he had ever heard, and the singer went on strike until they relented.",
    ].join("\n");

    const kept = highlights(article, 380);
    expect(kept).toContain("worst thing");
  });

  it("reaches a story buried at the end of a long section", () => {
    const article = [
      "Opening.",
      "",
      "== Recording ==",
      filler("microphone", 200),
      "",
      "The label head called it the worst thing he had ever heard and refused to release it.",
    ].join("\n");

    const kept = highlights(article, 700);
    expect(kept).toContain("worst thing");
  });

  it("never spends a character on a chart table", () => {
    const article = [
      "Opening.",
      "",
      "== Charts ==",
      filler("peak position", 200),
      "",
      "== Controversy ==",
      "It was banned by the BBC after a complaint and the band sued.",
    ].join("\n");

    const kept = highlights(article, 500);
    expect(kept).toContain("banned");
    expect(kept).not.toContain("peak position");
  });
});

describe("aboutThisRecord", () => {
  it("takes an article that names the artist", () => {
    expect(aboutThisRecord("Creep is a song by the English rock band Radiohead.", "Radiohead")).toBe(true);
  });

  it("takes an article that reads like music writing even without the name", () => {
    expect(aboutThisRecord("The single was recorded in 1971 and released as a 7-inch.", "Nobody")).toBe(true);
    expect(aboutThisRecord("זהו שיר שהוקלט בשנת 1980 ויצא כסינגל.", "מישהו")).toBe(true);
  });

  it("refuses the weather", () => {
    // "יורה" is a Shlomo Artzi song and the Hebrew word for the first rain of autumn.
    // The encyclopedia article is about rainfall, and its title matches exactly.
    const weather =
      "היורה הוא הגשם הראשון היורד בארץ ישראל בסתיו, לאחר עונת הקיץ היבשה. " +
      "הוא מציין את תחילת עונת הגשמים ומופיע במקורות כברכה חקלאית.";
    expect(aboutThisRecord(weather, "שלמה ארצי")).toBe(false);
  });

  it("refuses an article about the animal, not the record", () => {
    const bird = "The blackbird is a species of true thrush found across Europe and Asia.";
    expect(aboutThisRecord(bird, "The Beatles")).toBe(false);
  });
});
