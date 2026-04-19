import type { FC } from "react";

/**
 * Mascotas SVG (animación suave) — portadas desde `5S-plantilla-app/animals.jsx`.
 */
export type CincoSAnimalKind = "fox" | "bunny" | "cat" | "bear" | "owl" | "dog" | "penguin";

const w = "cinco-s-mascot-wiggle";
const f = "cinco-s-mascot-float";
const b = "cinco-s-mascot-blink";

function Fox({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={w} aria-hidden>
      <ellipse cx="50" cy="82" rx="22" ry="5" fill="rgba(0,0,0,0.08)" />
      <polygon points="22,38 30,18 38,34" fill="#e58c5a" />
      <polygon points="78,38 70,18 62,34" fill="#e58c5a" />
      <polygon points="26,33 30,22 34,31" fill="#fff" />
      <polygon points="74,33 70,22 66,31" fill="#fff" />
      <ellipse cx="50" cy="52" rx="28" ry="26" fill="#f0a070" />
      <ellipse cx="50" cy="66" rx="20" ry="12" fill="#fff8ee" />
      <g className={b} style={{ transformOrigin: "40px 52px" }}>
        <ellipse cx="40" cy="52" rx="3.5" ry="4.5" fill="#1a1a1f" />
        <circle cx="41" cy="50" r="1" fill="#fff" />
      </g>
      <g className={b} style={{ transformOrigin: "60px 52px" }}>
        <ellipse cx="60" cy="52" rx="3.5" ry="4.5" fill="#1a1a1f" />
        <circle cx="61" cy="50" r="1" fill="#fff" />
      </g>
      <ellipse cx="50" cy="64" rx="3" ry="2" fill="#1a1a1f" />
      <path d="M46 70 Q50 74 54 70" stroke="#1a1a1f" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Bunny({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={f} aria-hidden>
      <ellipse cx="50" cy="88" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      <ellipse cx="38" cy="22" rx="6" ry="18" fill="#f5f1e6" stroke="#dbd1b4" strokeWidth="1.5" />
      <ellipse cx="38" cy="22" rx="3" ry="13" fill="#f4b8b8" />
      <ellipse cx="62" cy="22" rx="6" ry="18" fill="#f5f1e6" stroke="#dbd1b4" strokeWidth="1.5" />
      <ellipse cx="62" cy="22" rx="3" ry="13" fill="#f4b8b8" />
      <circle cx="50" cy="58" r="26" fill="#f5f1e6" stroke="#dbd1b4" strokeWidth="1.5" />
      <g className={b} style={{ transformOrigin: "40px 56px" }}>
        <circle cx="40" cy="56" r="3" fill="#1a1a1f" />
        <circle cx="41" cy="55" r="0.8" fill="#fff" />
      </g>
      <g className={b} style={{ transformOrigin: "60px 56px" }}>
        <circle cx="60" cy="56" r="3" fill="#1a1a1f" />
        <circle cx="61" cy="55" r="0.8" fill="#fff" />
      </g>
      <circle cx="34" cy="64" r="3" fill="#f4b8b8" opacity="0.7" />
      <circle cx="66" cy="64" r="3" fill="#f4b8b8" opacity="0.7" />
      <path d="M48 66 L50 68 L52 66 Z" fill="#e58c8c" />
      <path d="M50 68 L50 71 M50 71 Q46 73 44 71 M50 71 Q54 73 56 71" stroke="#1a1a1f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Cat({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={w} aria-hidden>
      <ellipse cx="50" cy="84" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      <polygon points="22,40 28,15 40,38" fill="#4a4a56" />
      <polygon points="78,40 72,15 60,38" fill="#4a4a56" />
      <polygon points="26,35 29,22 34,34" fill="#f4b8b8" />
      <polygon points="74,35 71,22 66,34" fill="#f4b8b8" />
      <ellipse cx="50" cy="55" rx="27" ry="25" fill="#4a4a56" />
      <g className={b} style={{ transformOrigin: "40px 54px" }}>
        <ellipse cx="40" cy="54" rx="4" ry="5" fill="#7cb86f" />
        <ellipse cx="40" cy="54" rx="1.2" ry="4.5" fill="#1a1a1f" />
      </g>
      <g className={b} style={{ transformOrigin: "60px 54px" }}>
        <ellipse cx="60" cy="54" rx="4" ry="5" fill="#7cb86f" />
        <ellipse cx="60" cy="54" rx="1.2" ry="4.5" fill="#1a1a1f" />
      </g>
      <path d="M47 64 L50 66 L53 64 Z" fill="#f4b8b8" />
      <path d="M50 66 L50 68 M50 68 Q47 70 45 68 M50 68 Q53 70 55 68" stroke="#f5f1e6" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <line x1="32" y1="64" x2="22" y2="62" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
      <line x1="32" y1="66" x2="22" y2="68" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
      <line x1="68" y1="64" x2="78" y2="62" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
      <line x1="68" y1="66" x2="78" y2="68" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function Bear({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={f} aria-hidden>
      <ellipse cx="50" cy="86" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      <circle cx="26" cy="30" r="10" fill="#a67848" />
      <circle cx="74" cy="30" r="10" fill="#a67848" />
      <circle cx="26" cy="30" r="5" fill="#d9ae7a" />
      <circle cx="74" cy="30" r="5" fill="#d9ae7a" />
      <circle cx="50" cy="56" r="28" fill="#a67848" />
      <ellipse cx="50" cy="66" rx="16" ry="11" fill="#e8d0a8" />
      <g className={b} style={{ transformOrigin: "40px 50px" }}>
        <circle cx="40" cy="50" r="3" fill="#1a1a1f" />
        <circle cx="41" cy="49" r="0.8" fill="#fff" />
      </g>
      <g className={b} style={{ transformOrigin: "60px 50px" }}>
        <circle cx="60" cy="50" r="3" fill="#1a1a1f" />
        <circle cx="61" cy="49" r="0.8" fill="#fff" />
      </g>
      <ellipse cx="50" cy="62" rx="4" ry="3" fill="#1a1a1f" />
      <path d="M46 68 Q50 72 54 68" stroke="#1a1a1f" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Owl({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={w} aria-hidden>
      <ellipse cx="50" cy="88" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      <ellipse cx="50" cy="55" rx="28" ry="30" fill="#a68bc8" />
      <ellipse cx="50" cy="62" rx="16" ry="20" fill="#e8d8ed" />
      <circle cx="40" cy="48" r="10" fill="#f5f1e6" />
      <circle cx="60" cy="48" r="10" fill="#f5f1e6" />
      <g className={b} style={{ transformOrigin: "40px 48px" }}>
        <circle cx="40" cy="48" r="5" fill="#1a1a1f" />
        <circle cx="41" cy="46" r="1.5" fill="#fff" />
      </g>
      <g className={b} style={{ transformOrigin: "60px 48px" }}>
        <circle cx="60" cy="48" r="5" fill="#1a1a1f" />
        <circle cx="61" cy="46" r="1.5" fill="#fff" />
      </g>
      <polygon points="48,56 52,56 50,62" fill="#f4c44d" />
      <polygon points="30,26 34,22 36,30" fill="#8a6fb0" />
      <polygon points="70,26 66,22 64,30" fill="#8a6fb0" />
    </svg>
  );
}

function Dog({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={w} aria-hidden>
      <ellipse cx="50" cy="86" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      <ellipse cx="22" cy="45" rx="8" ry="18" fill="#8a6a44" transform="rotate(-15 22 45)" />
      <ellipse cx="78" cy="45" rx="8" ry="18" fill="#8a6a44" transform="rotate(15 78 45)" />
      <circle cx="50" cy="55" r="26" fill="#d9ae7a" />
      <ellipse cx="62" cy="44" rx="10" ry="8" fill="#8a6a44" />
      <ellipse cx="50" cy="65" rx="14" ry="10" fill="#f0dbb8" />
      <g className={b} style={{ transformOrigin: "40px 52px" }}>
        <circle cx="40" cy="52" r="3" fill="#1a1a1f" />
        <circle cx="41" cy="51" r="0.8" fill="#fff" />
      </g>
      <g className={b} style={{ transformOrigin: "60px 52px" }}>
        <circle cx="60" cy="52" r="3" fill="#1a1a1f" />
        <circle cx="61" cy="51" r="0.8" fill="#fff" />
      </g>
      <ellipse cx="50" cy="62" rx="3.5" ry="2.5" fill="#1a1a1f" />
      <path d="M48 70 Q50 76 52 70" fill="#e58c8c" />
    </svg>
  );
}

function Penguin({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={f} aria-hidden>
      <ellipse cx="50" cy="88" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      <ellipse cx="50" cy="55" rx="26" ry="30" fill="#2a3340" />
      <ellipse cx="50" cy="60" rx="18" ry="24" fill="#f5f1e6" />
      <g className={b} style={{ transformOrigin: "42px 44px" }}>
        <circle cx="42" cy="44" r="3" fill="#1a1a1f" />
        <circle cx="43" cy="43" r="0.8" fill="#fff" />
      </g>
      <g className={b} style={{ transformOrigin: "58px 44px" }}>
        <circle cx="58" cy="44" r="3" fill="#1a1a1f" />
        <circle cx="59" cy="43" r="0.8" fill="#fff" />
      </g>
      <polygon points="46,50 54,50 50,58" fill="#f4c44d" />
      <ellipse cx="42" cy="84" rx="6" ry="3" fill="#f4c44d" />
      <ellipse cx="58" cy="84" rx="6" ry="3" fill="#f4c44d" />
    </svg>
  );
}

const ANIMALS: Record<CincoSAnimalKind, FC<{ size?: number }>> = {
  fox: Fox,
  bunny: Bunny,
  cat: Cat,
  bear: Bear,
  owl: Owl,
  dog: Dog,
  penguin: Penguin,
};

/** Mascota según `category_id` del workspace 5S (McKenna). */
export function animalForCategoryId(categoryId: string): CincoSAnimalKind {
  const id = categoryId.toLowerCase();
  if (id.includes("alimentacion")) return "bear";
  if (id.includes("mascotas")) return "dog";
  if (id.includes("diseno")) return "fox";
  if (id.includes("finanzas")) return "penguin";
  if (id.includes("ingenieria")) return "cat";
  if (id.includes("limpieza")) return "owl";
  if (id.includes("entrenamientos")) return "bunny";
  if (id.includes("jardineria")) return "owl";
  if (id.includes("gestion")) return "penguin";
  return "fox";
}

type RoutineMascotProps = {
  categoryId: string;
  size?: number;
  className?: string;
};

export function RoutineMascot({ categoryId, size = 56, className = "" }: RoutineMascotProps) {
  const kind = animalForCategoryId(categoryId);
  const C = ANIMALS[kind];
  return (
    <span className={`inline-flex select-none ${className}`} title="Mascota del área">
      <C size={size} />
    </span>
  );
}
