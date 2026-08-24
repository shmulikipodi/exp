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
