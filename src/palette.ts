// The record picks the colour. Sample the sleeve, find the hue it actually leans on,
// then pin saturation and lightness so the accent stays legible on a dark page no
// matter how murky the artwork is.

const BUCKETS = 18;

function hue(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (255 - Math.abs(max + min - 255));
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

export async function accentFrom(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();

    const size = 40;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    // Weight each hue by how saturated it is — a small vivid patch on a grey sleeve
    // is the colour a person would name, even though grey covers more pixels. Plenty of
    // covers are near-monochrome, so a strict pass is followed by a forgiving one
    // rather than giving up and going default.
    const sample = (minSat: number, minL: number, maxL: number) => {
      const weights = new Array(BUCKETS).fill(0);
      for (let i = 0; i < data.length; i += 4) {
        const [h, s, l] = hue(data[i], data[i + 1], data[i + 2]);
        if (s < minSat || l < minL || l > maxL) continue;
        weights[Math.floor(h / (360 / BUCKETS)) % BUCKETS] += s * s;
      }
      const top = weights.indexOf(Math.max(...weights));
      return weights[top] > 0 ? top : -1;
    };

    // Ran the strict pass twice: once to test it, once to use it — two full sweeps of
    // the bitmap on every track change, for one answer.
    const strict = sample(0.22, 0.12, 0.93);
    const best = strict >= 0 ? strict : sample(0.08, 0.05, 0.97);
    if (best < 0) return null;
    return `${Math.round((best + 0.5) * (360 / BUCKETS))}`;
  } catch {
    return null; // tainted canvas or a dead image URL — fall back to the default
  }
}

// ---------------------------------------------------------------------------
// The lyrics view wants more than one number. A phone's lyric screen is not a
// tinted panel — it is three or four colours lifted off the sleeve, drifting past
// each other. So: the same bitmap, read for a small palette instead of one hue.

export type Swatch = { h: number; s: number; l: number };

const SPREAD = 26; // degrees two swatches must differ by to count as different colours

/**
 * Pick up to `want` distinct, vivid colours out of raw RGBA pixels.
 *
 * Kept free of the canvas so it can be tested with a handful of made-up pixels.
 * Bins are 15° of hue by quarter of saturation: fine enough to tell a red sleeve's
 * orange from its crimson, coarse enough that noise in a JPEG doesn't fragment
 * one colour into six.
 */
export function dominant(data: ArrayLike<number>, want = 4): Swatch[] {
  const bins = new Map<number, { w: number; h: number; s: number; l: number }>();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [h, s, l] = hue(data[i], data[i + 1], data[i + 2]);
    if (l < 0.05 || l > 0.97) continue; // pure black and pure white name no colour
    const key = Math.floor(h / 15) * 4 + Math.min(3, Math.floor(s * 4));
    // A vivid pixel counts for much more than a muddy one, but not for everything:
    // near-monochrome sleeves have to yield something rather than nothing.
    const w = 0.2 + s * s;
    const bin = bins.get(key) ?? { w: 0, h: 0, s: 0, l: 0 };
    bin.w += w;
    bin.h += h * w;
    bin.s += s * w;
    bin.l += l * w;
    bins.set(key, bin);
  }

  const ranked = [...bins.values()]
    .sort((a, b) => b.w - a.w)
    .map((b) => ({ h: b.h / b.w, s: b.s / b.w, l: b.l / b.w }));

  const picked: Swatch[] = [];
  for (const c of ranked) {
    if (picked.length >= want) break;
    const near = picked.some((p) => {
      const d = Math.abs(p.h - c.h);
      return Math.min(d, 360 - d) < SPREAD;
    });
    if (near) continue;
    // Whatever the sleeve's own saturation and lightness were, the words have to
    // stay readable over the result — so the range is pinned, and only the hue
    // carries through untouched.
    picked.push({
      h: Math.round(c.h),
      s: Math.round(Math.min(0.86, Math.max(0.42, c.s)) * 100),
      l: Math.round(Math.min(0.62, Math.max(0.34, c.l)) * 100),
    });
  }

  // A sleeve that gave up only one or two colours still needs a field to drift in.
  // Rotating what it did give beats inventing a colour it doesn't contain.
  while (picked.length && picked.length < want) {
    const seed = picked[0];
    picked.push({ h: (seed.h + 42 * picked.length) % 360, s: seed.s, l: seed.l });
  }
  return picked;
}

export async function paletteFrom(url: string, want = 4): Promise<Swatch[]> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();

    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, size, size);
    return dominant(ctx.getImageData(0, 0, size, size).data, want);
  } catch {
    return []; // tainted canvas or a dead image URL — the veil alone still works
  }
}
