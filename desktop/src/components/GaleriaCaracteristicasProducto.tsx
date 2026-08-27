import React from "react";

export interface CaracteristicaProducto {
  id: string;
  titulo: string;
  descripcionAccesible: string;
  /** SVG en JSX o componente de icono */
  icono: React.ReactNode;
}

interface Props {
  /** Lista opcional de características (usa las 8 por defecto si no se pasa) */
  items?: CaracteristicaProducto[];
  /** Color principal para trazos, bordes y textos (por defecto #351477) */
  colorPrincipal?: string;
  /** Fondo general del contenedor (por defecto #FFFFFF) */
  colorFondo?: string;
  /** Título opcional superior de la sección */
  tituloSeccion?: string;
  /** Subtítulo descriptivo */
  subtituloSeccion?: string;
  /** Clases CSS adicionales para el contenedor */
  className?: string;
}

/* ==========================================================================
   ICONOS VECTORIALES CONSISTENTES (Línea pura, stroke-width: 2.6-2.8, stroke-linecap: round)
   ========================================================================== */

export const ICONO_ESPUMA_CREMOSA = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Nube de espuma esponjosa principal */}
    <path d="M26 66 C20 66 18 57 23 51 C20 42 29 36 38 38 C42 30 55 28 63 35 C72 33 80 40 77 49 C83 54 82 64 74 66 Z" />
    {/* Burbujas flotantes de distintos calibres */}
    <circle cx="36" cy="23" r="5" strokeWidth="2.6" />
    <circle cx="67" cy="21" r="4" strokeWidth="2.4" />
    <circle cx="23" cy="38" r="3" strokeWidth="2.2" />
    <circle cx="79" cy="35" r="3" strokeWidth="2.2" />
    {/* Destellos internos de cremosidad */}
    <path d="M43 47 Q48 43 54 44" strokeWidth="2.2" />
    <path d="M63 53 Q67 51 69 55" strokeWidth="2.2" />
  </svg>
);

export const ICONO_LIMPIEZA_SUAVE = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Gota exterior fluida */}
    <path d="M50 16 C50 16 26 44 26 62 C26 76 37 84 50 84 C63 84 74 76 74 62 C74 44 50 16 50 16 Z" />
    {/* Hoja botánica orgánica grabada en el interior */}
    <path d="M40 68 C38 52 46 38 62 34 C60 52 52 66 40 68 Z" strokeWidth="2.4" />
    <path d="M41 66 Q52 50 61 36" strokeWidth="2" />
    <path d="M48 54 Q56 52 58 46" strokeWidth="1.8" />
  </svg>
);

export const ICONO_FACIL_DISPERSION = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Vaso de precipitado / recipiente de laboratorio */}
    <path d="M24 24 L28 24 L32 74 C33 78 37 80 42 80 L58 80 C63 80 67 78 68 74 L72 24 L76 24" />
    <path d="M28 24 L22 24" />
    {/* Nivel de solución líquida con menisco */}
    <path d="M30 48 Q50 44 70 48" strokeWidth="2.2" />
    {/* Partículas activas integrándose y dispersándose */}
    <circle cx="50" cy="30" r="3.5" strokeWidth="2.4" />
    <circle cx="39" cy="36" r="2.8" strokeWidth="2.2" />
    <circle cx="61" cy="36" r="2.8" strokeWidth="2.2" />
    <circle cx="44" cy="58" r="3" strokeWidth="2.2" />
    <circle cx="56" cy="62" r="3" strokeWidth="2.2" />
    <circle cx="50" cy="71" r="2.4" strokeWidth="2" />
    {/* Ondas / flechas de dispersión homogénea */}
    <path d="M37 66 Q42 63 45 66" strokeWidth="1.8" />
    <path d="M55 52 Q58 55 63 52" strokeWidth="1.8" />
  </svg>
);

export const ICONO_SUAVIDAD = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Pluma estilizada con cáliz curvado y suave */}
    <path d="M22 80 C36 78 50 64 64 48 C76 34 82 20 80 18 C78 16 64 22 50 34 C34 48 20 62 18 76 L22 80 Z" />
    {/* Raquis / eje central de la pluma */}
    <path d="M20 78 C38 60 56 42 78 20" strokeWidth="2.4" />
    {/* Barbas de suavidad en ambos lados */}
    <path d="M48 36 Q38 42 34 50" strokeWidth="2" />
    <path d="M38 46 Q28 52 24 60" strokeWidth="2" />
    <path d="M62 26 Q68 36 64 44" strokeWidth="2" />
    <path d="M52 36 Q58 46 54 54" strokeWidth="2" />
  </svg>
);

export const ICONO_ALTA_PUREZA = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Boca y cuello del matraz Erlenmeyer */}
    <line x1="43" y1="20" x2="57" y2="20" />
    <path d="M46 20 L46 32 L26 70 C24 74 27 78 32 78 L68 78 C73 78 76 74 74 70 L54 32 L54 20" />
    {/* Línea de líquido puro con graduación */}
    <path d="M33 58 Q50 54 67 58" strokeWidth="2.2" />
    <line x1="42" y1="44" x2="47" y2="44" strokeWidth="2" />
    <line x1="39" y1="52" x2="45" y2="52" strokeWidth="2" />
    {/* Estrella / destello de pureza analítica superior */}
    <path
      d="M78 18 Q82 18 82 14 Q82 18 86 18 Q82 18 82 22 Q82 18 78 18 Z"
      strokeWidth="2.2"
    />
    <circle cx="48" cy="68" r="2.5" strokeWidth="1.8" />
    <circle cx="58" cy="65" r="2" strokeWidth="1.8" />
  </svg>
);

export const ICONO_USO_COSMETICO = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Base del tarro / caja cosmética cilíndrica */}
    <path d="M24 50 C24 70 76 70 76 50 L24 50 Z" />
    {/* Borde superior y reborde del envase */}
    <line x1="20" y1="50" x2="80" y2="50" strokeWidth="3" />
    {/* Espiral / pompa de crema cosmética densa que sobresale */}
    <path d="M30 50 C30 36 44 30 50 30 C56 30 70 36 70 50" strokeWidth="2.6" />
    <path d="M43 30 C43 23 57 23 57 30" strokeWidth="2.4" />
    {/* Destello de formulación profesional */}
    <path d="M34 58 Q42 61 50 61" strokeWidth="2.2" />
  </svg>
);

export const ICONO_FORMULAS_SOLIDAS = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Barra cosmética sólida / stick en perspectiva estilizada */}
    <rect x="32" y="34" width="36" height="46" rx="8" />
    {/* Cúpula o bisel superior de la barra sólida */}
    <path d="M32 44 C32 32 68 32 68 44" strokeWidth="2.6" />
    <line x1="32" y1="64" x2="68" y2="64" strokeWidth="2.2" />
    {/* Pequeña burbuja / gota de pureza flotando al lado */}
    <circle cx="74" cy="28" r="4.5" strokeWidth="2.4" />
    <circle cx="26" cy="30" r="2.8" strokeWidth="2" />
    {/* Destello sutil */}
    <path d="M42 52 Q46 54 50 54" strokeWidth="2" />
  </svg>
);

export const ICONO_MATERIA_PRIMA = (
  <svg
    viewBox="0 0 100 100"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-full w-full"
    aria-hidden="true"
  >
    {/* Enlaces químicos / estructura molecular hexagonal estilizada */}
    <line x1="50" y1="26" x2="72" y2="38" strokeWidth="2.8" />
    <line x1="72" y1="38" x2="72" y2="62" strokeWidth="2.8" />
    <line x1="72" y1="62" x2="50" y2="74" strokeWidth="2.8" />
    <line x1="50" y1="74" x2="28" y2="62" strokeWidth="2.8" />
    <line x1="28" y1="62" x2="28" y2="38" strokeWidth="2.8" />
    <line x1="28" y1="38" x2="50" y2="26" strokeWidth="2.8" />
    {/* Nodos atómicos circulares */}
    <circle cx="50" cy="26" r="5" strokeWidth="2.8" fill="#ffffff" />
    <circle cx="72" cy="38" r="5" strokeWidth="2.8" fill="#ffffff" />
    <circle cx="72" cy="62" r="5" strokeWidth="2.8" fill="#ffffff" />
    <circle cx="50" cy="74" r="5" strokeWidth="2.8" fill="#ffffff" />
    <circle cx="28" cy="62" r="5" strokeWidth="2.8" fill="#ffffff" />
    <circle cx="28" cy="38" r="5" strokeWidth="2.8" fill="#ffffff" />
    {/* Núcleo de resonancia o enlace central */}
    <circle cx="50" cy="50" r="3.5" strokeWidth="2.2" />
  </svg>
);

/* ==========================================================================
   ARREGLO DE DATOS PRINCIPAL
   ========================================================================== */

export const CARACTERISTICAS_PRODUCTO_DEFAULT: CaracteristicaProducto[] = [
  {
    id: "espuma-cremosa",
    titulo: "ESPUMA CREMOSA",
    descripcionAccesible: "Icono de espuma cremosa: nube de espuma esponjosa con burbujas alrededor",
    icono: ICONO_ESPUMA_CREMOSA,
  },
  {
    id: "limpieza-suave",
    titulo: "LIMPIEZA SUAVE",
    descripcionAccesible: "Icono de limpieza suave: gota de agua con una hoja botánica en su interior",
    icono: ICONO_LIMPIEZA_SUAVE,
  },
  {
    id: "facil-dispersion",
    titulo: "FÁCIL DISPERSIÓN",
    descripcionAccesible: "Icono de fácil dispersión: partículas integrándose y disolviéndose en un recipiente",
    icono: ICONO_FACIL_DISPERSION,
  },
  {
    id: "suavidad",
    titulo: "SUAVIDAD",
    descripcionAccesible: "Icono de suavidad: pluma estilizada y ligera con curvas suaves",
    icono: ICONO_SUAVIDAD,
  },
  {
    id: "alta-pureza",
    titulo: "ALTA PUREZA",
    descripcionAccesible: "Icono de alta pureza: matraz de laboratorio analítico con destello de estrella",
    icono: ICONO_ALTA_PUREZA,
  },
  {
    id: "uso-cosmetico",
    titulo: "USO COSMÉTICO",
    descripcionAccesible: "Icono de uso cosmético: tarro cosmético minimalista con emulsión densa",
    icono: ICONO_USO_COSMETICO,
  },
  {
    id: "formulas-solidas",
    titulo: "FÓRMULAS SÓLIDAS",
    descripcionAccesible: "Icono de fórmulas sólidas: barra cosmética estilizada con micro-burbuja",
    icono: ICONO_FORMULAS_SOLIDAS,
  },
  {
    id: "materia-prima",
    titulo: "MATERIA PRIMA",
    descripcionAccesible: "Icono de materia prima: red de enlaces moleculares químicos conectados",
    icono: ICONO_MATERIA_PRIMA,
  },
];

/* ==========================================================================
   COMPONENTE PRINCIPAL: GALERÍA RESPONSIVE
   ========================================================================== */

export default function GaleriaCaracteristicasProducto({
  items = CARACTERISTICAS_PRODUCTO_DEFAULT,
  colorPrincipal = "#351477",
  colorFondo = "#FFFFFF",
  tituloSeccion,
  subtituloSeccion,
  className = "",
}: Props) {
  return (
    <section
      className={`w-full py-8 px-4 sm:px-6 lg:px-8 transition-colors ${className}`}
      style={{ backgroundColor: colorFondo }}
      aria-label="Características y beneficios destacados del producto"
    >
      <div className="mx-auto max-w-6xl">
        {/* Cabecera opcional de la sección */}
        {(tituloSeccion || subtituloSeccion) && (
          <div className="mb-10 text-center">
            {tituloSeccion && (
              <h2
                className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight uppercase"
                style={{
                  color: colorPrincipal,
                  fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif",
                }}
              >
                {tituloSeccion}
              </h2>
            )}
            {subtituloSeccion && (
              <p
                className="mt-2 text-sm sm:text-base font-medium opacity-80 max-w-2xl mx-auto"
                style={{ color: colorPrincipal }}
              >
                {subtituloSeccion}
              </p>
            )}
          </div>
        )}

        {/* 
          Cuadrícula Responsive:
          - Computadores (lg): 4 columnas (grid-cols-4)
          - Tabletas (md/sm): 2 columnas (sm:grid-cols-2 lg:grid-cols-4)
          - Móviles: 1 o 2 columnas según pantalla (grid-cols-2)
          - Espaciado amplio y uniforme
        */}
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10 sm:gap-x-8 sm:gap-y-12 lg:gap-x-10 lg:gap-y-14 justify-items-center">
          {items.map((item) => (
            <article
              key={item.id}
              className="group flex flex-col items-center text-center w-full max-w-[190px]"
              role="figure"
              aria-label={item.descripcionAccesible}
            >
              {/* 
                Círculo perfecto:
                - aspect-square + w-24 sm:w-28 lg:w-32
                - Borde uniforme con el color principal
                - Icono centrado sin rellenos, sombras ni 3D
              */}
              <div
                className="relative flex aspect-square w-24 sm:w-28 lg:w-32 items-center justify-center rounded-full p-5 sm:p-6 transition-transform duration-200 group-hover:scale-105"
                style={{
                  borderColor: colorPrincipal,
                  borderWidth: "2.5px",
                  borderStyle: "solid",
                  backgroundColor: "transparent",
                  color: colorPrincipal,
                }}
              >
                <div
                  className="h-full w-full flex items-center justify-center"
                  role="img"
                  aria-label={item.descripcionAccesible}
                >
                  {item.icono}
                </div>
              </div>

              {/* 
                Nombre de la característica fuera del círculo:
                - En mayúsculas
                - Centrado
                - Montserrat Bold o sans-serif fuerte
                - Máximo 2 líneas (con altura fija/mínima para alineación perfecta)
              */}
              <h3
                className="mt-3.5 sm:mt-4 text-xs sm:text-sm font-bold uppercase tracking-wider text-center leading-snug line-clamp-2 min-h-[2.5rem] flex items-center justify-center"
                style={{
                  color: colorPrincipal,
                  fontFamily: "'Montserrat', system-ui, -apple-system, sans-serif",
                }}
              >
                {item.titulo}
              </h3>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
