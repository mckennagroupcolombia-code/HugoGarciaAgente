import { useCallback, useEffect, useState } from "react";

/**
 * Pantalla completa de verdad, la del navegador (Fullscreen API) — la misma que
 * usa un videojuego, no un «modo sin barras» pintado con CSS.
 *
 * Se pide sobre `documentElement` y no sobre el panel de turno a propósito: los
 * emergentes de la app (taller, etiquetas, temas) se montan con portales en
 * `document.body`, y si el elemento en pantalla completa fuera el panel, esos
 * emergentes quedarían FUERA y por lo tanto invisibles. Con el documento entero
 * adentro no hay nada que se pueda salir.
 *
 * F11 se intercepta para que haga lo mismo que el botón. El navegador también
 * tiene su propio F11, pero el suyo no deja a la app enterarse de en qué estado
 * quedó, y entonces el botón del cabezote mostraba lo contrario de lo que había.
 * Salir con Escape sigue siendo del navegador y `fullscreenchange` lo reporta.
 */
export function usePantallaCompleta() {
  const [activa, setActiva] = useState(
    () => typeof document !== "undefined" && Boolean(document.fullscreenElement),
  );

  useEffect(() => {
    const cambio = () => setActiva(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", cambio);
    return () => document.removeEventListener("fullscreenchange", cambio);
  }, []);

  const alternar = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Safari en iOS y algunos modos kiosco no lo permiten. No es algo que el
      // usuario haya hecho mal, así que no se le avisa: el botón simplemente no
      // hace nada y se queda como estaba.
    }
  }, []);

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key !== "F11" || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      ev.preventDefault();
      void alternar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [alternar]);

  return { activa, alternar };
}

export function soportaPantallaCompleta(): boolean {
  return typeof document !== "undefined" && Boolean(document.documentElement.requestFullscreen);
}
