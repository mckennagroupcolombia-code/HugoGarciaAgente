import type { QueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { puedeVerEtiquetasAvanzado } from "./studioVisualAccess";
import type { TicketsUser } from "../stores/ticketsAuth";

/**
 * Precarga del hub de Diseño.
 *
 * Las pestañas (Imprimir, Studio visual, Papel y tinta, Códigos EAN) se montan
 * y desmontan al cambiar de pestaña, así que sin precarga cada visita mostraba
 * el estado "Cargando…" mientras React Query pedía el catálogo. Aquí se piden
 * las mismas queries (mismas claves y mismas URL que usan los componentes) en
 * cuanto se entra a Diseño, y se les da un `gcTime` largo para que el caché
 * sobreviva mientras el operador trabaja en otra pestaña.
 *
 * Ojo: las claves deben coincidir EXACTAMENTE con las de los componentes; si
 * cambia una clave allá, hay que cambiarla aquí o la precarga deja de servir
 * (no falla, simplemente vuelve a aparecer el "Cargando…").
 */

/** Tiempo que el caché precargado sobrevive sin observadores (React Query default: 5 min). */
export const ETIQUETAS_GC_TIME = 60 * 60 * 1000;

/** Opciones a mezclar en los useQuery de Diseño para que no se descarte el caché. */
export const ETIQUETAS_CACHE_OPTS = { gcTime: ETIQUETAS_GC_TIME } as const;

type Precarga = { queryKey: unknown[]; queryFn: () => Promise<unknown>; staleTime: number };

/** Imprimir: catálogo de etiquetas (incluye la biblioteca PNG) + estado de impresora. */
function precargasImprimir(): Precarga[] {
  return [
    {
      // EtiquetasStudioCatalogo con soloArchivosPng: buscar="", soloConAi=false, soloConMeli=false
      queryKey: ["etiquetas-studio-catalogo", "", false, false],
      queryFn: () => api.get("/api/etiquetas/studio/catalogo?"),
      staleTime: 20_000,
    },
    {
      queryKey: ["etiquetas-impresora"],
      queryFn: () => api.get("/api/etiquetas/impresora"),
      staleTime: 20_000,
    },
    {
      queryKey: ["etiquetas-colores-guardados"],
      queryFn: () => api.get("/api/etiquetas/colores"),
      staleTime: 60_000,
    },
  ];
}

/** Studio visual: plantillas visuales + biblioteca PNG, ambas en la carpeta raíz. */
function precargasStudio(): Precarga[] {
  return [
    {
      queryKey: ["plantillas-visuales", "", ""],
      queryFn: () => api.get("/api/plantillas-visuales?carpeta="),
      staleTime: 15_000,
    },
    {
      queryKey: ["plantillas-visuales-carpetas"],
      queryFn: () => api.get("/api/plantillas-visuales/carpetas"),
      staleTime: 15_000,
    },
    {
      queryKey: ["etiquetas-recursos-png", ""],
      queryFn: () => api.get("/api/etiquetas/recursos-png?carpeta="),
      staleTime: 15_000,
    },
    {
      queryKey: ["etiquetas-recursos-png-carpetas"],
      queryFn: () => api.get("/api/etiquetas/recursos-png/carpetas"),
      staleTime: 15_000,
    },
    // Portada de Studio: categorías + catálogo completo de plantillas + las
    // etiquetas ya generadas. Son las tres consultas que arman las tarjetas.
    {
      queryKey: ["etiquetas-categorias"],
      queryFn: () => api.get("/api/etiquetas/categorias"),
      staleTime: 60_000,
    },
    {
      queryKey: ["plantillas-visuales", "__todas__"],
      queryFn: () => api.get("/api/plantillas-visuales?todas=1"),
      staleTime: 15_000,
    },
    {
      queryKey: ["etiquetas-recursos-png", "ETIQUETAS STUDIO"],
      queryFn: () => api.get("/api/etiquetas/recursos-png?carpeta=ETIQUETAS%20STUDIO"),
      staleTime: 15_000,
    },
  ];
}

/** Papel y tinta. */
function precargasInventario(): Precarga[] {
  return [
    {
      queryKey: ["etiquetas-inventario-consumibles"],
      queryFn: async () => api.get("/api/etiquetas/inventario-consumibles"),
      staleTime: 15_000,
    },
    {
      queryKey: ["etiquetas-niveles-tinta"],
      queryFn: () => api.get("/api/etiquetas/niveles-tinta"),
      staleTime: 30_000,
    },
  ];
}

/** Códigos EAN. */
function precargasEan(): Precarga[] {
  return [
    {
      queryKey: ["etiquetas-codigos-ean"],
      queryFn: async () => {
        const data = await api.get<{ codigos: unknown[] }>("/api/etiquetas/codigos-ean");
        return data.codigos ?? [];
      },
      staleTime: 30_000,
    },
  ];
}

/** Configurar productos (Diseño → Configurar productos): catálogo Siigo sin búsqueda. */
function precargasConfigurar(): Precarga[] {
  return [
    {
      queryKey: ["combos-siigo", ""],
      queryFn: () => api.get("/api/etiquetas/combos-siigo"),
      staleTime: 5 * 60 * 1000,
    },
  ];
}

/**
 * Deja listas en caché las etiquetas de todas las pestañas de Diseño visibles
 * para el usuario. `prefetchQuery` no vuelve a pedir lo que aún está fresco, así
 * que llamarla varias veces (al montar el hub, al pasar el mouse por una pestaña)
 * no genera tráfico extra.
 */
export function precargarDiseno(qc: QueryClient, user: TicketsUser | null | undefined): void {
  const precargas: Precarga[] = [...precargasImprimir(), ...precargasConfigurar()];
  if (puedeVerEtiquetasAvanzado(user)) {
    precargas.push(...precargasStudio(), ...precargasInventario(), ...precargasEan());
  }
  for (const p of precargas) {
    void qc.prefetchQuery({
      queryKey: p.queryKey,
      queryFn: p.queryFn,
      staleTime: p.staleTime,
      gcTime: ETIQUETAS_GC_TIME,
      retry: 1,
    });
  }
}
