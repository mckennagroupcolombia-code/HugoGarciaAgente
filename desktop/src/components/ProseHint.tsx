/** Nota discreta bajo campos de redacción. */
export function ProseHint({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-muted/80 ${className}`.trim()}>
      Corrector ortográfico activo (español) · Mayúscula automática después de punto
    </p>
  );
}
