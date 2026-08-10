import type { AlignFrame, AlignGuide } from "../../lib/studioAlignmentGuides";

/** Líneas magenta de alineación sobre el papel (borde/centro + espacios). */
export function AlignmentGuidesOverlay({
  guides,
  frame,
}: {
  guides: AlignGuide[];
  frame?: AlignFrame;
}) {
  if (!guides.length) return null;
  const fw = frame?.width ?? 0;
  const fh = frame?.height ?? 0;
  return (
    <div className="pointer-events-none absolute inset-0 z-50" data-studio-guides aria-hidden>
      {guides.map((g, i) => {
        const gap = g.kind === "gap";
        const color = gap ? "#c026d3" : "#f12dd0";
        if (g.axis === "x") {
          return (
            <div key={`x-${i}-${g.pos}-${g.kind || "e"}`}>
              {fh > 0 && (
                <div
                  className="absolute"
                  style={{
                    left: g.pos,
                    top: 0,
                    width: gap ? 2 : 1,
                    height: fh,
                    background: color,
                    opacity: 0.28,
                  }}
                />
              )}
              <div
                className="absolute"
                style={{
                  left: g.pos,
                  top: Math.min(g.start, g.end),
                  width: gap ? 2 : 1,
                  height: Math.max(8, Math.abs(g.end - g.start)),
                  background: color,
                  boxShadow: "0 0 0 1px rgba(255,255,255,.55)",
                }}
              />
            </div>
          );
        }
        return (
          <div key={`y-${i}-${g.pos}-${g.kind || "e"}`}>
            {fw > 0 && (
              <div
                className="absolute"
                style={{
                  top: g.pos,
                  left: 0,
                  height: gap ? 2 : 1,
                  width: fw,
                  background: color,
                  opacity: 0.28,
                }}
              />
            )}
            <div
              className="absolute"
              style={{
                top: g.pos,
                left: Math.min(g.start, g.end),
                height: gap ? 2 : 1,
                width: Math.max(8, Math.abs(g.end - g.start)),
                background: color,
                boxShadow: "0 0 0 1px rgba(255,255,255,.55)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
