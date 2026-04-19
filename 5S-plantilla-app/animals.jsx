/* global React */
// Cute animated animals — simple, friendly SVGs
const { useState: uAS } = React;

function Fox({ size = 56 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="wiggle">
      <ellipse cx="50" cy="82" rx="22" ry="5" fill="rgba(0,0,0,0.08)" />
      {/* ears */}
      <polygon points="22,38 30,18 38,34" fill="#e58c5a" />
      <polygon points="78,38 70,18 62,34" fill="#e58c5a" />
      <polygon points="26,33 30,22 34,31" fill="#fff" />
      <polygon points="74,33 70,22 66,31" fill="#fff" />
      {/* head */}
      <ellipse cx="50" cy="52" rx="28" ry="26" fill="#f0a070" />
      {/* cheeks white */}
      <ellipse cx="50" cy="66" rx="20" ry="12" fill="#fff8ee" />
      {/* eyes */}
      <g className="blink" style={{transformOrigin: "40px 52px"}}>
        <ellipse cx="40" cy="52" rx="3.5" ry="4.5" fill="#1a1a1f" />
        <circle cx="41" cy="50" r="1" fill="#fff" />
      </g>
      <g className="blink" style={{transformOrigin: "60px 52px"}}>
        <ellipse cx="60" cy="52" rx="3.5" ry="4.5" fill="#1a1a1f" />
        <circle cx="61" cy="50" r="1" fill="#fff" />
      </g>
      {/* nose */}
      <ellipse cx="50" cy="64" rx="3" ry="2" fill="#1a1a1f" />
      {/* smile */}
      <path d="M46 70 Q50 74 54 70" stroke="#1a1a1f" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Bunny({ size = 56 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="float">
      <ellipse cx="50" cy="88" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      {/* ears */}
      <ellipse cx="38" cy="22" rx="6" ry="18" fill="#f5f1e6" stroke="#dbd1b4" strokeWidth="1.5" />
      <ellipse cx="38" cy="22" rx="3" ry="13" fill="#f4b8b8" />
      <ellipse cx="62" cy="22" rx="6" ry="18" fill="#f5f1e6" stroke="#dbd1b4" strokeWidth="1.5" />
      <ellipse cx="62" cy="22" rx="3" ry="13" fill="#f4b8b8" />
      {/* head */}
      <circle cx="50" cy="58" r="26" fill="#f5f1e6" stroke="#dbd1b4" strokeWidth="1.5" />
      {/* eyes */}
      <g className="blink" style={{transformOrigin: "40px 56px"}}>
        <circle cx="40" cy="56" r="3" fill="#1a1a1f" />
        <circle cx="41" cy="55" r="0.8" fill="#fff" />
      </g>
      <g className="blink" style={{transformOrigin: "60px 56px"}}>
        <circle cx="60" cy="56" r="3" fill="#1a1a1f" />
        <circle cx="61" cy="55" r="0.8" fill="#fff" />
      </g>
      {/* blush */}
      <circle cx="34" cy="64" r="3" fill="#f4b8b8" opacity="0.7" />
      <circle cx="66" cy="64" r="3" fill="#f4b8b8" opacity="0.7" />
      {/* nose + mouth */}
      <path d="M48 66 L50 68 L52 66 Z" fill="#e58c8c" />
      <path d="M50 68 L50 71 M50 71 Q46 73 44 71 M50 71 Q54 73 56 71" stroke="#1a1a1f" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Cat({ size = 56 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="wiggle">
      <ellipse cx="50" cy="84" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      {/* ears */}
      <polygon points="22,40 28,15 40,38" fill="#4a4a56" />
      <polygon points="78,40 72,15 60,38" fill="#4a4a56" />
      <polygon points="26,35 29,22 34,34" fill="#f4b8b8" />
      <polygon points="74,35 71,22 66,34" fill="#f4b8b8" />
      {/* head */}
      <ellipse cx="50" cy="55" rx="27" ry="25" fill="#4a4a56" />
      {/* eyes green */}
      <g className="blink" style={{transformOrigin: "40px 54px"}}>
        <ellipse cx="40" cy="54" rx="4" ry="5" fill="#7cb86f" />
        <ellipse cx="40" cy="54" rx="1.2" ry="4.5" fill="#1a1a1f" />
      </g>
      <g className="blink" style={{transformOrigin: "60px 54px"}}>
        <ellipse cx="60" cy="54" rx="4" ry="5" fill="#7cb86f" />
        <ellipse cx="60" cy="54" rx="1.2" ry="4.5" fill="#1a1a1f" />
      </g>
      {/* nose + mouth */}
      <path d="M47 64 L50 66 L53 64 Z" fill="#f4b8b8" />
      <path d="M50 66 L50 68 M50 68 Q47 70 45 68 M50 68 Q53 70 55 68" stroke="#f5f1e6" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      {/* whiskers */}
      <line x1="32" y1="64" x2="22" y2="62" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
      <line x1="32" y1="66" x2="22" y2="68" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
      <line x1="68" y1="64" x2="78" y2="62" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
      <line x1="68" y1="66" x2="78" y2="68" stroke="#f5f1e6" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function Bear({ size = 56 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="float">
      <ellipse cx="50" cy="86" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      {/* ears */}
      <circle cx="26" cy="30" r="10" fill="#a67848" />
      <circle cx="74" cy="30" r="10" fill="#a67848" />
      <circle cx="26" cy="30" r="5" fill="#d9ae7a" />
      <circle cx="74" cy="30" r="5" fill="#d9ae7a" />
      {/* head */}
      <circle cx="50" cy="56" r="28" fill="#a67848" />
      {/* muzzle */}
      <ellipse cx="50" cy="66" rx="16" ry="11" fill="#e8d0a8" />
      {/* eyes */}
      <g className="blink" style={{transformOrigin: "40px 50px"}}>
        <circle cx="40" cy="50" r="3" fill="#1a1a1f" />
        <circle cx="41" cy="49" r="0.8" fill="#fff" />
      </g>
      <g className="blink" style={{transformOrigin: "60px 50px"}}>
        <circle cx="60" cy="50" r="3" fill="#1a1a1f" />
        <circle cx="61" cy="49" r="0.8" fill="#fff" />
      </g>
      {/* nose */}
      <ellipse cx="50" cy="62" rx="4" ry="3" fill="#1a1a1f" />
      {/* smile */}
      <path d="M46 68 Q50 72 54 68" stroke="#1a1a1f" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Owl({ size = 56 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="wiggle">
      <ellipse cx="50" cy="88" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      {/* body */}
      <ellipse cx="50" cy="55" rx="28" ry="30" fill="#a68bc8" />
      {/* belly */}
      <ellipse cx="50" cy="62" rx="16" ry="20" fill="#e8d8ed" />
      {/* eye patches */}
      <circle cx="40" cy="48" r="10" fill="#f5f1e6" />
      <circle cx="60" cy="48" r="10" fill="#f5f1e6" />
      <g className="blink" style={{transformOrigin: "40px 48px"}}>
        <circle cx="40" cy="48" r="5" fill="#1a1a1f" />
        <circle cx="41" cy="46" r="1.5" fill="#fff" />
      </g>
      <g className="blink" style={{transformOrigin: "60px 48px"}}>
        <circle cx="60" cy="48" r="5" fill="#1a1a1f" />
        <circle cx="61" cy="46" r="1.5" fill="#fff" />
      </g>
      {/* beak */}
      <polygon points="48,56 52,56 50,62" fill="#f4c44d" />
      {/* tufts */}
      <polygon points="30,26 34,22 36,30" fill="#8a6fb0" />
      <polygon points="70,26 66,22 64,30" fill="#8a6fb0" />
    </svg>
  );
}

function Dog({ size = 56 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="wiggle">
      <ellipse cx="50" cy="86" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      {/* ears floppy */}
      <ellipse cx="22" cy="45" rx="8" ry="18" fill="#8a6a44" transform="rotate(-15 22 45)" />
      <ellipse cx="78" cy="45" rx="8" ry="18" fill="#8a6a44" transform="rotate(15 78 45)" />
      {/* head */}
      <circle cx="50" cy="55" r="26" fill="#d9ae7a" />
      {/* spot */}
      <ellipse cx="62" cy="44" rx="10" ry="8" fill="#8a6a44" />
      {/* muzzle */}
      <ellipse cx="50" cy="65" rx="14" ry="10" fill="#f0dbb8" />
      {/* eyes */}
      <g className="blink" style={{transformOrigin: "40px 52px"}}>
        <circle cx="40" cy="52" r="3" fill="#1a1a1f" />
        <circle cx="41" cy="51" r="0.8" fill="#fff" />
      </g>
      <g className="blink" style={{transformOrigin: "60px 52px"}}>
        <circle cx="60" cy="52" r="3" fill="#1a1a1f" />
        <circle cx="61" cy="51" r="0.8" fill="#fff" />
      </g>
      {/* nose */}
      <ellipse cx="50" cy="62" rx="3.5" ry="2.5" fill="#1a1a1f" />
      {/* tongue */}
      <path d="M48 70 Q50 76 52 70" fill="#e58c8c" />
    </svg>
  );
}

function Penguin({ size = 56 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="float">
      <ellipse cx="50" cy="88" rx="22" ry="4" fill="rgba(0,0,0,0.08)" />
      {/* body */}
      <ellipse cx="50" cy="55" rx="26" ry="30" fill="#2a3340" />
      {/* belly white */}
      <ellipse cx="50" cy="60" rx="18" ry="24" fill="#f5f1e6" />
      {/* eyes */}
      <g className="blink" style={{transformOrigin: "42px 44px"}}>
        <circle cx="42" cy="44" r="3" fill="#1a1a1f" />
        <circle cx="43" cy="43" r="0.8" fill="#fff" />
      </g>
      <g className="blink" style={{transformOrigin: "58px 44px"}}>
        <circle cx="58" cy="44" r="3" fill="#1a1a1f" />
        <circle cx="59" cy="43" r="0.8" fill="#fff" />
      </g>
      {/* beak */}
      <polygon points="46,50 54,50 50,58" fill="#f4c44d" />
      {/* feet */}
      <ellipse cx="42" cy="84" rx="6" ry="3" fill="#f4c44d" />
      <ellipse cx="58" cy="84" rx="6" ry="3" fill="#f4c44d" />
    </svg>
  );
}

const ANIMALS = {
  fox: Fox, bunny: Bunny, cat: Cat, bear: Bear, owl: Owl, dog: Dog, penguin: Penguin,
};

// Map categories to animal mascots
const CAT_ANIMAL = {
  diseno: "fox",
  alimentacion: "bear",
  mantenimiento: "owl",
  mascotas: "dog",
  finanzas: "penguin",
  ingenieria: "cat",
};

function Animal({ kind, size = 56 }) {
  const C = ANIMALS[kind] || Fox;
  return <C size={size} />;
}

window.Animal = Animal;
window.CAT_ANIMAL = CAT_ANIMAL;
