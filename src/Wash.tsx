import type { CSSProperties } from "react";
import type { Swatch } from "./palette";

/**
 * The background a phone puts behind lyrics: not the sleeve, and not a flat tint —
 * the sleeve's own colours as slow-moving fields of light, so the screen keeps the
 * record's mood without ever showing the picture.
 *
 * The blurred artwork sits underneath as a floor, because four gradients can only
 * approximate a photograph and a real sleeve has texture no gradient does.
 */
export function Wash({ art, colors }: { art?: string; colors: Swatch[] }) {
  return (
    <div className="wash" aria-hidden="true">
      {/* Always present, art or not: the blobs are positioned by their place among
          these children, and a missing sleeve must not shift all four of them. */}
      <div className="wash-art" style={art ? { backgroundImage: `url("${art}")` } : undefined} />
      {colors.map((c, i) => (
        <span
          key={`${c.h}-${i}`}
          className="wash-blob"
          style={{ "--c": `${c.h} ${c.s}% ${c.l}%`, "--i": i } as CSSProperties}
        />
      ))}
      <div className="wash-veil" />
    </div>
  );
}
