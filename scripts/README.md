# The eval

```bash
node scripts/eval.mjs                  # the whole panel, against production
node scripts/eval.mjs "Hey Jude"       # one record
node scripts/eval.mjs --at http://…    # somewhere else
```

Ten records whose stories are famous enough that a miss is not a matter of taste, each
with the facts a person who loves the record would certainly mention. One request per
song against whatever key pool the target is using.

## Reading the number

**A single run is a noisy measurement.** The model varies between calls on identical
input: Hotel California has produced the satanism myth on one run and not the next, same
prompt, same evidence. Treat ±1 fact as nothing. Only a repeated result, or a movement
of several facts, is signal.

**A miss means one of two things** — the app did not say it, or `panel.json` spelled it a
way the app did not. Check which before touching the prompt. The video's cost on November
Rain was scored missing for a whole session while the app was saying "$1.5 million".

**Failures corrupt the comparison.** A record that fails to parse contributes no facts
*and* drops out of the denominator, so the percentage is no longer measuring the same
thing. Never compare a run with failures against one without.

## Where it has been

| | facts | failures | notes | placed |
|---|---|---|---|---|
| before Songfacts | 27/31 (87%) | 0 | 55 | 17 |
| Songfacts, before the JSON retry | 22/28 (79%) | 1 | 47 | 11 |
| Songfacts, complete run | 26/31 (84%) | 0 | 52 | 15 |

The middle row is the cautionary one. Those runs looked like Songfacts had cost four
famous stories, and the case for cutting it seemed strong. It was the parse failures all
along: once records stopped dropping out, the difference came back to a single fact —
inside the run-to-run variance above. A confounded measurement is worse than none,
because it is persuasive.

## Adding to the panel

Whenever the app misses something it should have had, add it here. That is what turns a
disappointment into a regression test.
