import { describe, expect, it } from "vitest";
import { factsFrom, slug } from "./songfacts.js";

describe("slug", () => {
  it("builds the address Songfacts actually uses", () => {
    expect(slug("Guns N' Roses")).toBe("guns-n-roses");
    expect(slug("November Rain")).toBe("november-rain");
    expect(slug("The Beatles")).toBe("the-beatles");
  });

  it("spells out an ampersand rather than dropping it", () => {
    expect(slug("Simon & Garfunkel")).toBe("simon-n-garfunkel");
  });

  it("flattens accents and punctuation", () => {
    expect(slug("Björk")).toBe("bjork");
    expect(slug("Don't Stop Me Now")).toBe("dont-stop-me-now");
    expect(slug("What's Going On")).toBe("whats-going-on");
  });
});

describe("factsFrom", () => {
  const long = (word: string) => Array(14).fill(`${word} words in a sentence.`).join(" ");

  it("takes the entries and leaves the furniture", () => {
    const html = `<ul><li>Home</li><li>${long("A real fact")}</li></ul>`;
    const facts = factsFrom(html);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toContain("A real fact");
  });

  it("leaves the page's own JSON out of the evidence", () => {
    const html = `<li>{ "@context": "http://schema.org", "headline": "${long("x")}" }</li>`;
    expect(factsFrom(html)).toEqual([]);
  });

  it("stops before the comments, which are readers arguing", () => {
    const html = `<li>${long("An entry")}</li><div id="comments"><li>${long("A reader")}</li></div>`;
    const facts = factsFrom(html);
    expect(facts.join(" ")).toContain("An entry");
    expect(facts.join(" ")).not.toContain("A reader");
  });

  it("unpicks the entities so a quote reads as a quote", () => {
    const html = `<li>He said: &quot;${long("I was trying")}&quot;</li>`;
    expect(factsFrom(html)[0]).toContain('"I was trying');
  });

  it("says nothing when the page is not a song page", () => {
    expect(factsFrom("<html><body><p>Page not found</p></body></html>")).toEqual([]);
  });
});
