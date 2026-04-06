#!/usr/bin/env python3
"""
Generación masiva de Guías de Uso — McKenna Group
══════════════════════════════════════════════════
Genera guías técnicas en 7 secciones estructuradas para todos los
ingredientes del catálogo. Usa PubMed + ArXiv + Gemini.

Uso:
    source venv/bin/activate
    python3 generar_guias_masivas.py

Genera ~62 guías. Tiempo estimado: 45-90 minutos.
"""

import os, sys, re, json, time, unicodedata, requests
from datetime import datetime
from pathlib import Path

# ─── Rutas ────────────────────────────────────────────────────────────────────
BASE        = Path(__file__).parent
GUIAS_JSON  = BASE / "PAGINA_WEB/site/data/guias.json"
DOTENV      = BASE / ".env"

# Cargar .env
for line in DOTENV.read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

# ─── Catálogo de ingredientes a generar ───────────────────────────────────────
INGREDIENTES = [
    # ── ÁCIDOS ──────────────────────────────────────────────────────────────
    {
        "tema":            "Ácido Ascórbico cosmético vitamina C",
        "titulo":          "Guía de Uso — Ácido Ascórbico (Vitamina C)",
        "title_short":     "Ácido Ascórbico",
        "slug":            "acido-ascorbico",
        "desc":            "Protocolo técnico para la formulación con Ácido Ascórbico: estabilización, pH, compatibilidad y concentraciones para productos despigmentantes y antioxidantes.",
        "category":        "Ácidos y Activos",
        "icon":            "sun",
        "color":           "#143D36",
        "tags":            ["Vitamina C", "Antioxidante", "Despigmentante", "Colágeno"],
        "producto_slug":   "acdasc250g",
        "producto_nombre": "Ácido Ascórbico 250g — McKenna Group",
        "producto_precio": "$15.865",
        "producto_foto":   "https://http2.mlstatic.com/D_768732-MCO84095565990_052025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1578787577",
    },
    {
        "tema":            "Ácido Cítrico cosmético conservante acidulante",
        "titulo":          "Guía de Uso — Ácido Cítrico",
        "title_short":     "Ácido Cítrico",
        "slug":            "acido-citrico",
        "desc":            "Manual técnico del Ácido Cítrico como acidulante, quelante y conservante en formulaciones cosméticas y alimentarias.",
        "category":        "Ácidos y Conservantes",
        "icon":            "drop",
        "color":           "#1E5C51",
        "tags":            ["Acidulante", "Quelante", "pH", "Conservante"],
        "producto_slug":   "acdctr250g",
        "producto_nombre": "Ácido Cítrico 250g — McKenna Group",
        "producto_precio": "$7.874",
        "producto_foto":   "https://http2.mlstatic.com/D_860987-MLA81567398311_122024-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-891097860",
    },
    {
        "tema":            "Ácido Málico cosmético exfoliante AHA",
        "titulo":          "Guía de Uso — Ácido Málico",
        "title_short":     "Ácido Málico",
        "slug":            "acido-malico",
        "desc":            "Guía técnica del Ácido Málico como AHA suave: exfoliación, hidratación y formulación en peelings y serums.",
        "category":        "Ácidos y Activos",
        "icon":            "flask",
        "color":           "#143D36",
        "tags":            ["AHA", "Exfoliante", "Hidratación", "Peel"],
        "producto_slug":   "acdmlc100g",
        "producto_nombre": "Ácido Málico 100g — McKenna Group",
        "producto_precio": "$9.519",
        "producto_foto":   "https://http2.mlstatic.com/D_639982-MCO72514484402_102023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-918703993",
    },
    {
        "tema":            "Ácido Azelaico cosmético acné hiperpigmentación",
        "titulo":          "Guía de Uso — Ácido Azelaico",
        "title_short":     "Ácido Azelaico",
        "slug":            "acido-azelaico",
        "desc":            "Protocolo técnico del Ácido Azelaico: acción antimicrobiana, antiinflamatoria y despigmentante en tratamientos de acné y rosácea.",
        "category":        "Ácidos y Activos",
        "icon":            "shield-check",
        "color":           "#1E5C51",
        "tags":            ["Acné", "Antimicrobiano", "Despigmentante", "Rosácea"],
        "producto_slug":   "acdazl10g",
        "producto_nombre": "Ácido Azelaico 10g — McKenna Group",
        "producto_precio": "$14.863",
        "producto_foto":   "https://http2.mlstatic.com/D_901365-MCO86958477129_062025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1609304141",
    },
    {
        "tema":            "Ácido Esteárico emulsionante cosmético",
        "titulo":          "Guía de Uso — Ácido Esteárico",
        "title_short":     "Ácido Esteárico",
        "slug":            "acido-estearico",
        "desc":            "Manual técnico del Ácido Esteárico como emulsionante, espesante y agente de consistencia en cremas y lociones.",
        "category":        "Ácidos Grasos",
        "icon":            "drop-half",
        "color":           "#143D36",
        "tags":            ["Emulsionante", "Espesante", "Cremas", "Lípidos"],
        "producto_slug":   "acdestlb",
        "producto_nombre": "Ácido Esteárico 500g — McKenna Group",
        "producto_precio": "$14.362",
        "producto_foto":   "https://http2.mlstatic.com/D_803650-MCO72605573562_112023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-566617437",
    },
    {
        "tema":            "Ácido Glicólico 50% peeling cosmético AHA",
        "titulo":          "Guía de Uso — Ácido Glicólico 50%",
        "title_short":     "Ácido Glicólico",
        "slug":            "acido-glicolico",
        "desc":            "Protocolo profesional del Ácido Glicólico al 50%: peeling químico, renovación celular, neutralización y seguridad en formulaciones AHA.",
        "category":        "Ácidos y Activos",
        "icon":            "flask",
        "color":           "#2E8B7A",
        "tags":            ["AHA", "Peeling", "Renovación Celular", "Exfoliante"],
        "producto_slug":   "acdglc50p30ml",
        "producto_nombre": "Ácido Glicólico 50% 30ml — McKenna Group",
        "producto_precio": "$20.792",
        "producto_foto":   "https://http2.mlstatic.com/D_603324-MCO93972017683_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-859831102",
    },
    {
        "tema":            "Ácido Hialurónico cosmético hidratación bajo peso molecular",
        "titulo":          "Guía de Uso — Ácido Hialurónico",
        "title_short":     "Ácido Hialurónico",
        "slug":            "acido-hialuronico",
        "desc":            "Manual técnico del Ácido Hialurónico: pesos moleculares, hidratación profunda, formulación en serums y cremas, concentraciones y compatibilidad.",
        "category":        "Humectantes y Activos",
        "icon":            "drop",
        "color":           "#143D36",
        "tags":            ["Hidratación", "Relleno", "Serum", "Antiedad"],
        "producto_slug":   "acdhlrbjps30ml",
        "producto_nombre": "Ácido Hialurónico 30ml — McKenna Group",
        "producto_precio": "$19.122",
        "producto_foto":   "https://http2.mlstatic.com/D_978630-MCO94097384399_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-2829965506",
    },
    {
        "tema":            "Ácido Láctico 85% cosmético exfoliante AHA hidratación",
        "titulo":          "Guía de Uso — Ácido Láctico 85%",
        "title_short":     "Ácido Láctico",
        "slug":            "acido-lactico",
        "desc":            "Protocolo del Ácido Láctico al 85%: exfoliación suave, hidratación natural del factor NMF, ajuste de pH y formulación segura.",
        "category":        "Ácidos y Activos",
        "icon":            "flask",
        "color":           "#1E5C51",
        "tags":            ["AHA", "Hidratación", "NMF", "Peeling Suave"],
        "producto_slug":   "acdlct30ml",
        "producto_nombre": "Ácido Láctico 85% 30ml — McKenna Group",
        "producto_precio": "$17.118",
        "producto_foto":   "https://http2.mlstatic.com/D_888663-MCO93552645844_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-587471185",
    },
    {
        "tema":            "Ácido Salicílico 20% peeling BHA acné cosmético",
        "titulo":          "Guía de Uso — Ácido Salicílico 20%",
        "title_short":     "Ácido Salicílico",
        "slug":            "acido-salicilico",
        "desc":            "Protocolo profesional del Ácido Salicílico al 20%: peeling BHA, tratamiento del acné, compatibilidad y seguridad en formulaciones cosméticas.",
        "category":        "Ácidos y Activos",
        "icon":            "flask",
        "color":           "#143D36",
        "tags":            ["BHA", "Acné", "Peeling", "Comedones"],
        "producto_slug":   "acdslc20p30ml",
        "producto_nombre": "Ácido Salicílico 20% 30ml — McKenna Group",
        "producto_precio": "$24.966",
        "producto_foto":   "https://http2.mlstatic.com/D_807100-MCO82378380845_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1262287931",
    },
    # ── ACEITES ESENCIALES ──────────────────────────────────────────────────
    {
        "tema":            "Aceite esencial de Eucalipto cosmético aromaterpia",
        "titulo":          "Guía de Uso — Aceite Esencial de Eucalipto",
        "title_short":     "Aceite de Eucalipto",
        "slug":            "aceite-esencial-eucalipto",
        "desc":            "Protocolo de uso del Aceite Esencial de Eucalipto: aromaterapia, propiedades antimicrobianas, dilución y formulación en productos respiratorios y corporales.",
        "category":        "Aceites Esenciales",
        "icon":            "leaf",
        "color":           "#1E5C51",
        "tags":            ["Aromaterapia", "Antimicrobiano", "Respiratorio", "Expectorante"],
        "producto_slug":   "oilesneuc5ml",
        "producto_nombre": "Aceite Esencial Eucalipto 5ml — McKenna Group",
        "producto_precio": "$14.612",
        "producto_foto":   "https://http2.mlstatic.com/D_776086-MCO54789011620_042023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1278677373",
    },
    {
        "tema":            "Aceite esencial árbol de té tea tree antimicrobiano cosmético",
        "titulo":          "Guía de Uso — Aceite Esencial de Árbol de Té",
        "title_short":     "Árbol de Té",
        "slug":            "aceite-esencial-arbol-te",
        "desc":            "Manual técnico del Aceite de Árbol de Té (Tea Tree): actividad antimicrobiana, antifúngica, concentraciones seguras y formulación en cosméticos para acné.",
        "category":        "Aceites Esenciales",
        "icon":            "leaf",
        "color":           "#143D36",
        "tags":            ["Tea Tree", "Antimicrobiano", "Acné", "Antifúngico"],
        "producto_slug":   "oilesnat5ml",
        "producto_nombre": "Aceite Esencial Árbol de Té 5ml — McKenna Group",
        "producto_precio": "$14.612",
        "producto_foto":   "https://http2.mlstatic.com/D_787114-MCO54788950076_042023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1278699815",
    },
    {
        "tema":            "Aceite esencial de menta piperita cosmético aromaterapia",
        "titulo":          "Guía de Uso — Aceite Esencial de Menta",
        "title_short":     "Aceite de Menta",
        "slug":            "aceite-esencial-menta",
        "desc":            "Protocolo técnico del Aceite Esencial de Menta Piperita: mentol, efecto refrescante, analgésico tópico, dilución y formulación cosmética.",
        "category":        "Aceites Esenciales",
        "icon":            "leaf",
        "color":           "#2E8B7A",
        "tags":            ["Mentol", "Refrescante", "Analgésico", "Aromaterapia"],
        "producto_slug":   "oilesnmnt5ml",
        "producto_nombre": "Aceite Esencial Menta 5ml — McKenna Group",
        "producto_precio": "$14.612",
        "producto_foto":   "https://http2.mlstatic.com/D_862890-MCO54785282821_042023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1394642716",
    },
    {
        "tema":            "Aceite Rosa Mosqueta cosmético cicatrizante vitamina C",
        "titulo":          "Guía de Uso — Aceite de Rosa Mosqueta",
        "title_short":     "Rosa Mosqueta",
        "slug":            "aceite-rosa-mosqueta",
        "desc":            "Manual técnico del Aceite de Rosa Mosqueta: ácidos grasos esenciales, regeneración cutánea, cicatrices y formulación en serums antiedad.",
        "category":        "Aceites Vegetales",
        "icon":            "flower",
        "color":           "#1E5C51",
        "tags":            ["Cicatrizante", "Antiedad", "Ácidos Grasos", "Regenerador"],
        "producto_slug":   "oilesnrsm5ml",
        "producto_nombre": "Aceite de Rosa Mosqueta 5ml — McKenna Group",
        "producto_precio": "$11.440",
        "producto_foto":   "https://http2.mlstatic.com/D_775835-MCO54789324362_042023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1278656139",
    },
    {
        "tema":            "Aceite esencial de bergamota cosmético aromaterapia citrus",
        "titulo":          "Guía de Uso — Aceite Esencial de Bergamota",
        "title_short":     "Bergamota",
        "slug":            "aceite-esencial-bergamota",
        "desc":            "Protocolo del Aceite Esencial de Bergamota: fotosensibilidad, aromaterapia, equilibrio emocional y formulación en perfumería y cosméticos.",
        "category":        "Aceites Esenciales",
        "icon":            "orange",
        "color":           "#143D36",
        "tags":            ["Citrus", "Aromaterapia", "Fotosensible", "Perfumería"],
        "producto_slug":   "oilesnbrg5ml",
        "producto_nombre": "Aceite Esencial Bergamota 5ml — McKenna Group",
        "producto_precio": "$14.612",
        "producto_foto":   "https://http2.mlstatic.com/D_819839-MCO54784985183_042023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1278663695",
    },
    # ── ACEITES VEGETALES ───────────────────────────────────────────────────
    {
        "tema":            "Aceite de argán cosmético hidratación cabello piel",
        "titulo":          "Guía de Uso — Aceite de Argán",
        "title_short":     "Aceite de Argán",
        "slug":            "aceite-argan",
        "desc":            "Manual técnico del Aceite de Argán 100% puro: ácidos grasos, vitamina E, hidratación capilar y facial, y formulación en cosméticos premium.",
        "category":        "Aceites Vegetales",
        "icon":            "drop-half",
        "color":           "#1E5C51",
        "tags":            ["Hidratación", "Cabello", "Vitamina E", "Antioxidante"],
        "producto_slug":   "oilarg50ml",
        "producto_nombre": "Aceite de Argán 50ml — McKenna Group",
        "producto_precio": "$24.132",
        "producto_foto":   "https://http2.mlstatic.com/D_936385-MCO89016504772_082025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-594012281",
    },
    {
        "tema":            "Aceite de neem insecticida cosmético antifúngico",
        "titulo":          "Guía de Uso — Aceite de Neem",
        "title_short":     "Aceite de Neem",
        "slug":            "aceite-neem",
        "desc":            "Protocolo técnico del Aceite de Neem: azadirachtina, actividad insecticida, antifúngica y antibacteriana en formulaciones cosméticas y agrícolas.",
        "category":        "Aceites Vegetales",
        "icon":            "leaf",
        "color":           "#143D36",
        "tags":            ["Insecticida", "Antifúngico", "Agrícola", "Antibacteriano"],
        "producto_slug":   "oilnm60ml",
        "producto_nombre": "Aceite de Neem 60ml — McKenna Group",
        "producto_precio": "$13.861",
        "producto_foto":   "https://http2.mlstatic.com/D_875873-MCO48245779302_112021-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-577630387",
    },
    {
        "tema":            "Aceite de ricino castor cosmético cabello crecimiento",
        "titulo":          "Guía de Uso — Aceite de Ricino",
        "title_short":     "Aceite de Ricino",
        "slug":            "aceite-ricino",
        "desc":            "Manual del Aceite de Ricino (Castor Oil): ácido ricinoleico, crecimiento capilar, hidratación de cejas y formulación en productos capilares.",
        "category":        "Aceites Vegetales",
        "icon":            "drop",
        "color":           "#2E8B7A",
        "tags":            ["Cabello", "Crecimiento", "Hidratación", "Ricinoleico"],
        "producto_slug":   "oilrcn250ml",
        "producto_nombre": "Aceite de Ricino 250ml — McKenna Group",
        "producto_precio": "$12.108",
        "producto_foto":   "https://http2.mlstatic.com/D_883525-MCO72652014203_112023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1636834856",
    },
    {
        "tema":            "Aceite de semilla de uva cosmético antioxidante",
        "titulo":          "Guía de Uso — Aceite de Semilla de Uva",
        "title_short":     "Semilla de Uva",
        "slug":            "aceite-semilla-uva",
        "desc":            "Protocolo del Aceite de Semilla de Uva: proantocianidinas, ligereza, antioxidante y formulación en serums y productos faciales para piel mixta.",
        "category":        "Aceites Vegetales",
        "icon":            "drop-half",
        "color":           "#1E5C51",
        "tags":            ["Antioxidante", "Ligero", "Piel Mixta", "OPC"],
        "producto_slug":   "oilsmlu120ml",
        "producto_nombre": "Aceite Semilla de Uva 120ml — McKenna Group",
        "producto_precio": "$25.050",
        "producto_foto":   "https://http2.mlstatic.com/D_870105-MCO93551086090_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-591008771",
    },
    {
        "tema":            "Vaselina petrolatum cosmético barrera emoliente",
        "titulo":          "Guía de Uso — Vaselina Pura",
        "title_short":     "Vaselina Pura",
        "slug":            "vaselina-pura",
        "desc":            "Manual técnico de la Vaselina (Petrolatum) USP: efecto barrera, oclusivo, emoliente y formulación en ungüentos, bálsamos y productos labiales.",
        "category":        "Emolientes",
        "icon":            "jar",
        "color":           "#143D36",
        "tags":            ["Barrera", "Oclusivo", "Emoliente", "USP"],
        "producto_slug":   "vsl400g",
        "producto_nombre": "Vaselina Pura 400g — McKenna Group",
        "producto_precio": "$21.710",
        "producto_foto":   "https://http2.mlstatic.com/D_981971-MLA75701459532_042024-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1278511487",
    },
    # ── CERAS Y MANTECAS ────────────────────────────────────────────────────
    {
        "tema":            "Manteca de cacao cosmético hidratación piel",
        "titulo":          "Guía de Uso — Manteca de Cacao",
        "title_short":     "Manteca de Cacao",
        "slug":            "manteca-cacao",
        "desc":            "Protocolo técnico de la Manteca de Cacao: ácidos grasos, punto de fusión, hidratación profunda y formulación en cremas corporales y barras sólidas.",
        "category":        "Ceras y Mantecas",
        "icon":            "jar",
        "color":           "#1E5C51",
        "tags":            ["Hidratación", "Emoliente", "Piel Seca", "Barra Sólida"],
        "producto_slug":   "mntccrflb",
        "producto_nombre": "Manteca de Cacao 500g — McKenna Group",
        "producto_precio": "$14.112",
        "producto_foto":   "https://http2.mlstatic.com/D_861141-MCO89986938011_082025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-566619739",
    },
    {
        "tema":            "Manteca de karité shea butter cosmético hidratación",
        "titulo":          "Guía de Uso — Manteca de Karité",
        "title_short":     "Manteca de Karité",
        "slug":            "manteca-karite",
        "desc":            "Manual técnico de la Manteca de Karité sin refinar: triterpenos, vitaminas A y E, cicatrización y formulación en cremas, bálsamos y cosméticos naturales.",
        "category":        "Ceras y Mantecas",
        "icon":            "jar",
        "color":           "#143D36",
        "tags":            ["Shea Butter", "Cicatrizante", "Hidratación Profunda", "Natural"],
        "producto_slug":   "mntk250g",
        "producto_nombre": "Manteca de Karité 250g — McKenna Group",
        "producto_precio": "$51.686",
        "producto_foto":   "https://http2.mlstatic.com/D_786647-MLA71698002234_092023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-572516617",
    },
    {
        "tema":            "Cera de abejas cosmética emulsionante consistencia",
        "titulo":          "Guía de Uso — Cera de Abejas",
        "title_short":     "Cera de Abejas",
        "slug":            "cera-abejas",
        "desc":            "Protocolo técnico de la Cera de Abejas: espesante natural, agente consistencia, formulación en bálsamos labiales, cremas y cosméticos sólidos.",
        "category":        "Ceras y Mantecas",
        "icon":            "hexagon",
        "color":           "#2E8B7A",
        "tags":            ["Espesante", "Natural", "Bálsamos", "Sólidos"],
        "producto_slug":   "crabjrflb",
        "producto_nombre": "Cera de Abejas 500g — McKenna Group",
        "producto_precio": "$21.042",
        "producto_foto":   "https://http2.mlstatic.com/D_687742-MCO71022994443_082023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-590695436",
    },
    {
        "tema":            "Cera carnauba cosmética brillo consistencia vegana",
        "titulo":          "Guía de Uso — Cera Carnauba",
        "title_short":     "Cera Carnauba",
        "slug":            "cera-carnauba",
        "desc":            "Manual técnico de la Cera Carnauba: dureza, brillo, vegana, alternativa a cera de abejas y formulación en barras labiales, gloss y cosméticos naturales.",
        "category":        "Ceras y Mantecas",
        "icon":            "leaf",
        "color":           "#1E5C51",
        "tags":            ["Vegana", "Brillo", "Dureza", "Natural"],
        "producto_slug":   "crcrn250g",
        "producto_nombre": "Cera Carnauba 250g — McKenna Group",
        "producto_precio": "$18.704",
        "producto_foto":   "https://http2.mlstatic.com/D_892883-MCO89543335197_082025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-837454367",
    },
    {
        "tema":            "Mentol cristal cosmético refrescante analgésico",
        "titulo":          "Guía de Uso — Mentol Cristal",
        "title_short":     "Mentol Cristal",
        "slug":            "mentol-cristal",
        "desc":            "Protocolo técnico del Mentol Cristal: efecto refrescante, analgésico tópico, concentraciones seguras y formulación en geles, cremas y productos deportivos.",
        "category":        "Activos Refrescantes",
        "icon":            "snowflake",
        "color":           "#143D36",
        "tags":            ["Refrescante", "Analgésico", "Deportivo", "TRPM8"],
        "producto_slug":   "mntl100g",
        "producto_nombre": "Mentol Cristal 100g — McKenna Group",
        "producto_precio": "$29.225",
        "producto_foto":   "https://http2.mlstatic.com/D_971227-MCO94065518055_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1146475504",
    },
    {
        "tema":            "Lanolina cosmética emoliente barrera protectora",
        "titulo":          "Guía de Uso — Lanolina Pura",
        "title_short":     "Lanolina",
        "slug":            "lanolina",
        "desc":            "Manual de la Lanolina Pura: emoliente de alta penetración, barrera protectora, formulación en ungüentos, cremas para pezones y cuidado intensivo.",
        "category":        "Emolientes",
        "icon":            "jar",
        "color":           "#2E8B7A",
        "tags":            ["Emoliente", "Barrera", "Pezones", "Piel Seca"],
        "producto_slug":   "lnln40g",
        "producto_nombre": "Lanolina Pura 40g — McKenna Group",
        "producto_precio": "$14.946",
        "producto_foto":   "https://http2.mlstatic.com/D_656153-MCO108580515163_032026-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-600431364",
    },
    # ── EMULSIONANTES Y SURFACTANTES ────────────────────────────────────────
    {
        "tema":            "Alcohol cetílico emulsionante espesante cosmético",
        "titulo":          "Guía de Uso — Alcohol Cetílico",
        "title_short":     "Alcohol Cetílico",
        "slug":            "alcohol-cetilico",
        "desc":            "Protocolo técnico del Alcohol Cetílico: emulsionante O/W, espesante, estabilizador y formulación en cremas, lociones y acondicionadores capilares.",
        "category":        "Emulsionantes y Surfactantes",
        "icon":            "beaker",
        "color":           "#143D36",
        "tags":            ["Emulsionante", "Espesante", "O/W", "Capilar"],
        "producto_slug":   "alcctllb",
        "producto_nombre": "Alcohol Cetílico 500g — McKenna Group",
        "producto_precio": "$21.710",
        "producto_foto":   "https://http2.mlstatic.com/D_952648-MCO72474333460_102023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-581495025",
    },
    {
        "tema":            "Betaína de coco surfactante suave cosmético champú",
        "titulo":          "Guía de Uso — Betaína de Coco",
        "title_short":     "Betaína de Coco",
        "slug":            "betaina-coco",
        "desc":            "Manual del Cocamidopropyl Betaine (Betaína de Coco): surfactante anfótero, suave, espumante y formulación en champús, jabones líquidos y limpiadores.",
        "category":        "Emulsionantes y Surfactantes",
        "icon":            "waves",
        "color":           "#1E5C51",
        "tags":            ["Surfactante", "Espumante", "Suave", "Champú"],
        "producto_slug":   "btncc250ml",
        "producto_nombre": "Betaína de Coco 250ml — McKenna Group",
        "producto_precio": "$11.440",
        "producto_foto":   "https://http2.mlstatic.com/D_931059-MCO72580361696_112023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-595871388",
    },
    {
        "tema":            "BTMS 50 emulsionante acondicionador cationico capilar",
        "titulo":          "Guía de Uso — BTMS 50 (Emulsionante Catiónico)",
        "title_short":     "BTMS 50",
        "slug":            "btms-50",
        "desc":            "Protocolo técnico del BTMS 50: emulsionante catiónico, acondicionador capilar autoemulsionante, formulación en cremas de acondicionamiento sin aclarado.",
        "category":        "Emulsionantes y Surfactantes",
        "icon":            "beaker",
        "color":           "#2E8B7A",
        "tags":            ["Catiónico", "Acondicionador", "Capilar", "Autoemulsionante"],
        "producto_slug":   "btms125g",
        "producto_nombre": "BTMS 50 Emulsionante 125g — McKenna Group",
        "producto_precio": "$24.966",
        "producto_foto":   "https://http2.mlstatic.com/D_786608-MCO72678757627_112023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1330892037",
    },
    {
        "tema":            "Cera Lanette emulsionante estabilizador cosmético",
        "titulo":          "Guía de Uso — Cera Lanette",
        "title_short":     "Cera Lanette",
        "slug":            "cera-lanette",
        "desc":            "Manual técnico de la Cera Lanette: mezcla de alcohol cetílico y cetearil, emulsionante O/W estable y formulación en cremas y lociones clásicas.",
        "category":        "Emulsionantes y Surfactantes",
        "icon":            "beaker",
        "color":           "#143D36",
        "tags":            ["O/W", "Estabilizador", "Cremas", "Cetearil"],
        "producto_slug":   "crlnt250g",
        "producto_nombre": "Cera Lanette 250g — McKenna Group",
        "producto_precio": "$11.690",
        "producto_foto":   "https://http2.mlstatic.com/D_829129-MCO73291155814_122023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1338921587",
    },
    {
        "tema":            "Polisorbato 20 Tween 20 solubilizante cosmético",
        "titulo":          "Guía de Uso — Polisorbato 20 (Tween 20)",
        "title_short":     "Polisorbato 20",
        "slug":            "polisorbato-20",
        "desc":            "Protocolo del Polisorbato 20 (Tween 20) USP: solubilizante de aceites esenciales, emulsionante O/W y formulación en tónicos, aguas micelares y serums.",
        "category":        "Emulsionantes y Surfactantes",
        "icon":            "beaker",
        "color":           "#1E5C51",
        "tags":            ["Solubilizante", "Tween 20", "Aceites Esenciales", "O/W"],
        "producto_slug":   "pls20250ml",
        "producto_nombre": "Polisorbato 20 USP 250ml — McKenna Group",
        "producto_precio": "$22.128",
        "producto_foto":   "https://http2.mlstatic.com/D_880010-MCO71749595655_092023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1910972470",
    },
    {
        "tema":            "SCI tensoactivo sólido champú barra cosmético",
        "titulo":          "Guía de Uso — SCI Tensoactivo Sólido",
        "title_short":     "SCI Tensoactivo",
        "slug":            "sci-tensoactivo",
        "desc":            "Manual del SCI (Sodium Cocoyl Isethionate): tensoactivo sólido suave, biodegradable, formulación en champús en barra, pastillas limpiadoras y limpiadores sólidos.",
        "category":        "Emulsionantes y Surfactantes",
        "icon":            "waves",
        "color":           "#143D36",
        "tags":            ["Sólido", "Biodegradable", "Champú Barra", "Suave"],
        "producto_slug":   "tsci250g",
        "producto_nombre": "SCI Tensoactivo 250g — McKenna Group",
        "producto_precio": "$39.162",
        "producto_foto":   "https://http2.mlstatic.com/D_692927-MCO84659963517_052025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-605848736",
    },
    # ── HUMECTANTES ─────────────────────────────────────────────────────────
    {
        "tema":            "Glicerina vegetal USP cosmética humectante",
        "titulo":          "Guía de Uso — Glicerina Vegetal USP",
        "title_short":     "Glicerina Vegetal",
        "slug":            "glicerina-vegetal",
        "desc":            "Protocolo técnico de la Glicerina Vegetal USP: humectante, cosolvent, estabilizador de espuma y formulación en jabones, cremas y serums hidratantes.",
        "category":        "Humectantes",
        "icon":            "drop",
        "color":           "#2E8B7A",
        "tags":            ["Humectante", "USP", "Jabones", "Higroscopico"],
        "producto_slug":   "glc250ml",
        "producto_nombre": "Glicerina Vegetal USP 250ml — McKenna Group",
        "producto_precio": "$10.020",
        "producto_foto":   "https://http2.mlstatic.com/D_951229-MCO72580074562_112023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1636912880",
    },
    {
        "tema":            "Urea cosmética hidratación queratólisis exfoliante",
        "titulo":          "Guía de Uso — Urea Cosmética",
        "title_short":     "Urea Cosmética",
        "slug":            "urea-cosmetica",
        "desc":            "Manual técnico de la Urea Cosmética: humectante, queratólítico, concentraciones por indicación y formulación en cremas para talones, manos y cuero cabelludo.",
        "category":        "Humectantes",
        "icon":            "drop-half",
        "color":           "#143D36",
        "tags":            ["Queratólítico", "Talones", "Hidratación Profunda", "NMF"],
        "producto_slug":   "urcsm250g",
        "producto_nombre": "Urea Cosmética 250g — McKenna Group",
        "producto_precio": "$14.320",
        "producto_foto":   "https://http2.mlstatic.com/D_900784-MCO83154149221_032025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-820157855",
    },
    {
        "tema":            "Sorbitol humectante cosmético alimento edulcorante",
        "titulo":          "Guía de Uso — Sorbitol",
        "title_short":     "Sorbitol",
        "slug":            "sorbitol",
        "desc":            "Protocolo del Sorbitol: humectante de alto rendimiento, plastificante en pastas dentales y formulación en productos de cuidado bucal y cosmética.",
        "category":        "Humectantes",
        "icon":            "drop",
        "color":           "#1E5C51",
        "tags":            ["Humectante", "Dental", "Plastificante", "Higroscópico"],
        "producto_slug":   "srb500ml",
        "producto_nombre": "Sorbitol 500ml — McKenna Group",
        "producto_precio": "$10.772",
        "producto_foto":   "https://http2.mlstatic.com/D_708207-MCO50294295121_062022-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-908318006",
    },
    {
        "tema":            "Dipropilenglicol DPG solvente cosmético fragancia",
        "titulo":          "Guía de Uso — Dipropilenglicol (DPG)",
        "title_short":     "DPG",
        "slug":            "dipropilenglicol",
        "desc":            "Manual técnico del Dipropilenglicol USP: solvente de fragancias, humectante, vehículo de activos y formulación en perfumes, lociones y serums.",
        "category":        "Humectantes y Solventes",
        "icon":            "flask",
        "color":           "#2E8B7A",
        "tags":            ["Solvente", "Fragancias", "Vehículo", "Humectante"],
        "producto_slug":   "dprp500ml",
        "producto_nombre": "DPG USP 500ml — McKenna Group",
        "producto_precio": "$25.050",
        "producto_foto":   "https://http2.mlstatic.com/D_744018-MCO89972444603_082025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-581504092",
    },
    # ── VITAMINAS ───────────────────────────────────────────────────────────
    {
        "tema":            "Niacinamida vitamina B3 cosmética poros acné",
        "titulo":          "Guía de Uso — Niacinamida (Vitamina B3)",
        "title_short":     "Niacinamida",
        "slug":            "niacinamida",
        "desc":            "Protocolo técnico de la Niacinamida: reducción de poros, control de sebo, despigmentación y formulación en serums, cremas y tónicos cosméticos.",
        "category":        "Vitaminas y Activos",
        "icon":            "star",
        "color":           "#143D36",
        "tags":            ["Poros", "Sebo", "Despigmentante", "B3"],
        "producto_slug":   "vtmb3100g",
        "producto_nombre": "Niacinamida 100g — McKenna Group",
        "producto_precio": "$69.222",
        "producto_foto":   "https://http2.mlstatic.com/D_790737-MCO93973054053_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-880824875",
    },
    {
        "tema":            "Vitamina E tocoferol cosmético antioxidante",
        "titulo":          "Guía de Uso — Vitamina E (Tocoferol)",
        "title_short":     "Vitamina E",
        "slug":            "vitamina-e",
        "desc":            "Manual de la Vitamina E (d-alfa-Tocoferol): antioxidante lipofílico, protección de fórmulas, cicatrización y formulación en aceites, serums y cremas.",
        "category":        "Vitaminas y Activos",
        "icon":            "shield",
        "color":           "#1E5C51",
        "tags":            ["Antioxidante", "Tocoferol", "Cicatrización", "Lipofílico"],
        "producto_slug":   "vtme30ml",
        "producto_nombre": "Vitamina E 30ml — McKenna Group",
        "producto_precio": "$18.203",
        "producto_foto":   "https://http2.mlstatic.com/D_893847-MCO82374494951_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-587476373",
    },
    {
        "tema":            "Vitamina B12 cianocobalamina suplemento cosmético",
        "titulo":          "Guía de Uso — Vitamina B12 (Cianocobalamina)",
        "title_short":     "Vitamina B12",
        "slug":            "vitamina-b12",
        "desc":            "Protocolo de la Vitamina B12 Cianocobalamina: función neurológica, formulación en suplementos, solubilidad y compatibilidad en matrices acuosas.",
        "category":        "Vitaminas y Activos",
        "icon":            "sparkle",
        "color":           "#143D36",
        "tags":            ["Neurológico", "Energía", "Suplemento", "Cobalamina"],
        "producto_slug":   "vtmb12100gr",
        "producto_nombre": "Vitamina B12 100g — McKenna Group",
        "producto_precio": "$56.780",
        "producto_foto":   "https://http2.mlstatic.com/D_670127-MCO94112598659_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1349248285",
    },
    # ── PRINCIPIOS ACTIVOS ──────────────────────────────────────────────────
    {
        "tema":            "Alfa arbutina despigmentante cosmético blanqueador",
        "titulo":          "Guía de Uso — Alfa Arbutina",
        "title_short":     "Alfa Arbutina",
        "slug":            "alfa-arbutina",
        "desc":            "Manual técnico de la Alfa Arbutina: inhibidor de tirosinasa, comparativa con beta-arbutina y Ácido Kójico, concentraciones INVIMA y formulación en serums despigmentantes.",
        "category":        "Principios Activos Despigmentantes",
        "icon":            "drop-half",
        "color":           "#1E5C51",
        "tags":            ["Despigmentante", "Tirosinasa", "Manchas", "Inhibidor"],
        "producto_slug":   "alfarb10g",
        "producto_nombre": "Alfa Arbutina 10g — McKenna Group",
        "producto_precio": "$19.122",
        "producto_foto":   "https://http2.mlstatic.com/D_817699-MCO105506900096_012026-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1817885111",
    },
    {
        "tema":            "Retinol vitamina A cosmético antiedad renovación celular",
        "titulo":          "Guía de Uso — Retinol 5%",
        "title_short":     "Retinol 5%",
        "slug":            "retinol",
        "desc":            "Protocolo técnico del Retinol al 5%: mecanismo de acción, fotosensibilidad, introducción gradual y formulación en productos antiedad nocturnos.",
        "category":        "Retinoides y Activos",
        "icon":            "moon",
        "color":           "#143D36",
        "tags":            ["Antiedad", "Vitamina A", "Noche", "Fotosensible"],
        "producto_slug":   "rtn5p30ml",
        "producto_nombre": "Retinol 5% 30ml — McKenna Group",
        "producto_precio": "$37.492",
        "producto_foto":   "https://http2.mlstatic.com/D_752424-MCO82116288472_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-971453450",
    },
    {
        "tema":            "Óxido de zinc cosmético protector solar antibacteriano",
        "titulo":          "Guía de Uso — Óxido de Zinc",
        "title_short":     "Óxido de Zinc",
        "slug":            "oxido-zinc",
        "desc":            "Manual del Óxido de Zinc: filtro solar físico de amplio espectro, acción antibacteriana, cicatrizante y formulación en protectores solares y cremas para bebés.",
        "category":        "Principios Activos",
        "icon":            "sun",
        "color":           "#2E8B7A",
        "tags":            ["Filtro Solar", "Físico", "Bebés", "Cicatrizante"],
        "producto_slug":   "oxdzn250g",
        "producto_nombre": "Óxido de Zinc 250g — McKenna Group",
        "producto_precio": "$23.130",
        "producto_foto":   "https://http2.mlstatic.com/D_730332-MCO82622577993_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-866834790",
    },
    {
        "tema":            "DMSO dimetilsulfóxido penetrador activos farmacéutico",
        "titulo":          "Guía de Uso — DMSO (Dimetilsulfóxido)",
        "title_short":     "DMSO",
        "slug":            "dmso",
        "desc":            "Protocolo técnico del DMSO: vehículo penetrador transdérmico, propiedades antiinflamatorias, concentraciones seguras y aplicaciones farmacéuticas y veterinarias.",
        "category":        "Excipientes y Vehículos",
        "icon":            "flask",
        "color":           "#1E5C51",
        "tags":            ["Penetrador", "Transdérmico", "Antiinflamatorio", "Vehículo"],
        "producto_slug":   "dmso30ml",
        "producto_nombre": "DMSO 30ml — McKenna Group",
        "producto_precio": "$13.778",
        "producto_foto":   "https://http2.mlstatic.com/D_637551-MCO54415911762_032023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1262063261",
    },
    # ── CONSERVANTES ────────────────────────────────────────────────────────
    {
        "tema":            "Sorbato de potasio conservante cosmético alimentos",
        "titulo":          "Guía de Uso — Sorbato de Potasio",
        "title_short":     "Sorbato de Potasio",
        "slug":            "sorbato-potasio",
        "desc":            "Manual técnico del Sorbato de Potasio: conservante antifúngico de amplio espectro, concentraciones INVIMA, pH de actividad y formulación en cosméticos y alimentos.",
        "category":        "Conservantes",
        "icon":            "shield-check",
        "color":           "#143D36",
        "tags":            ["Conservante", "Antifúngico", "GRAS", "Alimentos"],
        "producto_slug":   "srbk250g",
        "producto_nombre": "Sorbato de Potasio 250g — McKenna Group",
        "producto_precio": "$11.690",
        "producto_foto":   "https://http2.mlstatic.com/D_796241-MCO71861815744_092023-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1341843191",
    },
    {
        "tema":            "Benzoato de sodio conservante antimicrobiano cosmético",
        "titulo":          "Guía de Uso — Benzoato de Sodio",
        "title_short":     "Benzoato de Sodio",
        "slug":            "benzoato-sodio",
        "desc":            "Protocolo del Benzoato de Sodio: conservante antibacteriano, pH de actividad óptimo, combinaciones con Sorbato y formulación en bebidas, cosméticos y farmacéuticos.",
        "category":        "Conservantes",
        "icon":            "shield-check",
        "color":           "#1E5C51",
        "tags":            ["Conservante", "Antibacteriano", "pH Ácido", "GRAS"],
        "producto_slug":   "bnznalb",
        "producto_nombre": "Benzoato de Sodio 500g — McKenna Group",
        "producto_precio": "$13.944",
        "producto_foto":   "https://http2.mlstatic.com/D_640336-MCO93552885092_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-848321516",
    },
    {
        "tema":            "Metabisulfito de sodio antioxidante conservante vinos",
        "titulo":          "Guía de Uso — Metabisulfito de Sodio",
        "title_short":     "Metabisulfito de Sodio",
        "slug":            "metabisulfito-sodio",
        "desc":            "Manual técnico del Metabisulfito de Sodio: antioxidante, conservante, usos en formulaciones cosméticas con Ácido Kójico, vinos y alimentos.",
        "category":        "Conservantes y Antioxidantes",
        "icon":            "shield",
        "color":           "#143D36",
        "tags":            ["Antioxidante", "Conservante", "Vinos", "Ácido Kójico"],
        "producto_slug":   "mtbslfnalb",
        "producto_nombre": "Metabisulfito de Sodio 500g — McKenna Group",
        "producto_precio": "$30.644",
        "producto_foto":   "https://http2.mlstatic.com/D_626855-MCO49000121667_022022-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-954636783",
    },
    {
        "tema":            "Sharomix 705 conservante cosmético amplio espectro",
        "titulo":          "Guía de Uso — Sharomix 705",
        "title_short":     "Sharomix 705",
        "slug":            "sharomix-705",
        "desc":            "Protocolo técnico del Sharomix 705: conservante de amplio espectro para cosméticos, concentraciones, pH de uso y compatibilidad con surfactantes.",
        "category":        "Conservantes",
        "icon":            "shield-check",
        "color":           "#2E8B7A",
        "tags":            ["Amplio Espectro", "Cosméticos", "Sin Parabenos", "ECOCERT"],
        "producto_slug":   "shrx250ml",
        "producto_nombre": "Sharomix 705 250ml — McKenna Group",
        "producto_precio": "$45.925",
        "producto_foto":   "https://http2.mlstatic.com/D_925139-MCO81453983183_122024-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1591252977",
    },
    # ── SALES MINERALES ─────────────────────────────────────────────────────
    {
        "tema":            "Bicarbonato de sodio cosmético exfoliante neutralizante",
        "titulo":          "Guía de Uso — Bicarbonato de Sodio",
        "title_short":     "Bicarbonato de Sodio",
        "slug":            "bicarbonato-sodio",
        "desc":            "Manual técnico del Bicarbonato de Sodio: neutralizante de peelings ácidos, exfoliante suave, desodorante y formulación en cosméticos naturales.",
        "category":        "Sales Minerales",
        "icon":            "flask",
        "color":           "#143D36",
        "tags":            ["Neutralizante", "Exfoliante", "Desodorante", "Alcalino"],
        "producto_slug":   "bcarnalb",
        "producto_nombre": "Bicarbonato de Sodio 500g — McKenna Group",
        "producto_precio": "$6.680",
        "producto_foto":   "https://http2.mlstatic.com/D_802937-MCO82274574402_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-557974228",
    },
    {
        "tema":            "Cloruro de magnesio suplemento transdérmico sales baño",
        "titulo":          "Guía de Uso — Cloruro de Magnesio",
        "title_short":     "Cloruro de Magnesio",
        "slug":            "cloruro-magnesio",
        "desc":            "Protocolo del Cloruro de Magnesio: absorción transdérmica, sales de baño, aceite de magnesio y formulación en productos para recuperación muscular.",
        "category":        "Sales Minerales",
        "icon":            "waves",
        "color":           "#1E5C51",
        "tags":            ["Transdérmico", "Muscular", "Sales de Baño", "Deficiencia"],
        "producto_slug":   "clrmgkg",
        "producto_nombre": "Cloruro de Magnesio 1kg — McKenna Group",
        "producto_precio": "$28.306",
        "producto_foto":   "https://http2.mlstatic.com/D_613491-MLA82557694121_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-581493122",
    },
    {
        "tema":            "Citrato de magnesio suplemento digestión relajante",
        "titulo":          "Guía de Uso — Citrato de Magnesio",
        "title_short":     "Citrato de Magnesio",
        "slug":            "citrato-magnesio",
        "desc":            "Manual del Citrato de Magnesio: alta biodisponibilidad, relajación muscular, función digestiva y formulación en suplementos y polvos efervescentes.",
        "category":        "Sales Minerales",
        "icon":            "flask",
        "color":           "#143D36",
        "tags":            ["Biodisponible", "Muscular", "Digestivo", "Efervescente"],
        "producto_slug":   "ctmg250g",
        "producto_nombre": "Citrato de Magnesio 250g — McKenna Group",
        "producto_precio": "$22.462",
        "producto_foto":   "https://http2.mlstatic.com/D_904764-MCO82589016015_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-2729976162",
    },
    {
        "tema":            "Citrato de potasio suplemento alcalinizante electrolito",
        "titulo":          "Guía de Uso — Citrato de Potasio",
        "title_short":     "Citrato de Potasio",
        "slug":            "citrato-potasio",
        "desc":            "Protocolo del Citrato de Potasio: alcalinizante urinario, electrolito, formulación en suplementos deportivos y polvos alcalinos.",
        "category":        "Sales Minerales",
        "icon":            "flask",
        "color":           "#2E8B7A",
        "tags":            ["Electrolito", "Alcalinizante", "Deportivo", "Renal"],
        "producto_slug":   "ctk250g",
        "producto_nombre": "Citrato de Potasio 250g — McKenna Group",
        "producto_precio": "$15.782",
        "producto_foto":   "https://http2.mlstatic.com/D_640425-MCO89727330344_082025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1572732833",
    },
    # ── EXCIPIENTES ─────────────────────────────────────────────────────────
    {
        "tema":            "Extracto de aloe vera cosmético hidratación calmante",
        "titulo":          "Guía de Uso — Extracto de Aloe Vera 92%",
        "title_short":     "Aloe Vera",
        "slug":            "aloe-vera",
        "desc":            "Manual técnico del Extracto de Aloe Vera al 92%: polisacáridos, acemanano, propiedades calmantes y formulación en serums, geles y lociones.",
        "category":        "Excipientes y Activos",
        "icon":            "leaf",
        "color":           "#1E5C51",
        "tags":            ["Calmante", "Hidratación", "Acemanano", "Natural"],
        "producto_slug":   "extalvr30ml",
        "producto_nombre": "Extracto Aloe Vera 30ml — McKenna Group",
        "producto_precio": "$11.440",
        "producto_foto":   "https://http2.mlstatic.com/D_820898-MCO82096368514_022025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-627419803",
    },
    {
        "tema":            "Goma xanthan espesante cosmético estabilizador",
        "titulo":          "Guía de Uso — Goma Xanthan",
        "title_short":     "Goma Xanthan",
        "slug":            "goma-xanthan",
        "desc":            "Protocolo técnico de la Goma Xanthan: espesante pseudoplástico, estabilizador de emulsiones, concentraciones y formulación en geles, cremas y alimentos.",
        "category":        "Espesantes y Gelificantes",
        "icon":            "beaker",
        "color":           "#143D36",
        "tags":            ["Espesante", "Gelificante", "Pseudoplástico", "Estabilizador"],
        "producto_slug":   "gmxnt500g",
        "producto_nombre": "Goma Xanthan 500g — McKenna Group",
        "producto_precio": "$30.812",
        "producto_foto":   "https://http2.mlstatic.com/D_817267-MCO84095807188_052025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-2863567646",
    },
    {
        "tema":            "Goma guar espesante cosmético farmacéutico",
        "titulo":          "Guía de Uso — Goma Guar",
        "title_short":     "Goma Guar",
        "slug":            "goma-guar",
        "desc":            "Manual de la Goma Guar: espesante natural de galactomanano, acondicionador capilar catiónico, formulación en champús, cremas y alimentos.",
        "category":        "Espesantes y Gelificantes",
        "icon":            "beaker",
        "color":           "#1E5C51",
        "tags":            ["Galactomanano", "Espesante", "Capilar", "Natural"],
        "producto_slug":   "gmgr500g",
        "producto_nombre": "Goma Guar 500g — McKenna Group",
        "producto_precio": "$15.782",
        "producto_foto":   "https://http2.mlstatic.com/D_778633-MCO84096125514_052025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-1578762435",
    },
    {
        "tema":            "Lecitina de soya emulsionante liposomas cosmético",
        "titulo":          "Guía de Uso — Lecitina de Soya",
        "title_short":     "Lecitina de Soya",
        "slug":            "lecitina-soya",
        "desc":            "Protocolo técnico de la Lecitina de Soya: fosfatidilcolina, emulsionante natural, formación de liposomas y formulación en cosméticos y suplementos.",
        "category":        "Emulsionantes Naturales",
        "icon":            "beaker",
        "color":           "#2E8B7A",
        "tags":            ["Fosfatidilcolina", "Liposomas", "Emulsionante", "Natural"],
        "producto_slug":   "lctsylb",
        "producto_nombre": "Lecitina de Soya 500g — McKenna Group",
        "producto_precio": "$24.716",
        "producto_foto":   "https://http2.mlstatic.com/D_606346-MCO93547587442_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-896116153",
    },
    {
        "tema":            "Cafeína anhidra cosmético reductora anti-celulitis",
        "titulo":          "Guía de Uso — Cafeína Anhidra",
        "title_short":     "Cafeína Anhidra",
        "slug":            "cafeina-anhidra",
        "desc":            "Manual técnico de la Cafeína Anhidra: lipolisis, reducción de celulitis, vasoconstrición en ojeras y formulación en cremas reductoras y oculares.",
        "category":        "Principios Activos",
        "icon":            "lightning",
        "color":           "#143D36",
        "tags":            ["Celulitis", "Lipolisis", "Reductora", "Contorno de Ojos"],
        "producto_slug":   "cfnlb",
        "producto_nombre": "Cafeína Anhidra 500g — McKenna Group",
        "producto_precio": "$171.175",
        "producto_foto":   "https://http2.mlstatic.com/D_774066-MCO93973681397_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-610805503",
    },
    {
        "tema":            "Dióxido de titanio filtro solar físico cosméticos",
        "titulo":          "Guía de Uso — Dióxido de Titanio",
        "title_short":     "Dióxido de Titanio",
        "slug":            "dioxido-titanio",
        "desc":            "Protocolo del Dióxido de Titanio: filtro solar inorgánico UVA/UVB, opacificante, agente blanqueante y formulación en protectores y cosméticos decorativos.",
        "category":        "Filtros Solares y Pigmentos",
        "icon":            "sun",
        "color":           "#1E5C51",
        "tags":            ["Filtro Solar", "UVA/UVB", "Opacificante", "Inorgánico"],
        "producto_slug":   "dxdtlb",
        "producto_nombre": "Dióxido de Titanio 500g — McKenna Group",
        "producto_precio": "$22.044",
        "producto_foto":   "https://http2.mlstatic.com/D_877099-MCO93548168170_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-581503445",
    },
    # ── SUPLEMENTARIOS ──────────────────────────────────────────────────────
    {
        "tema":            "Colágeno hidrolizado cosmético suplemento piel articulaciones",
        "titulo":          "Guía de Uso — Colágeno Hidrolizado",
        "title_short":     "Colágeno Hidrolizado",
        "slug":            "colageno-hidrolizado",
        "desc":            "Manual técnico del Colágeno Hidrolizado: péptidos bioactivos, tipos I y III, formulación en suplementos, bebidas funcionales y cosméticos tópicos.",
        "category":        "Suplementarios",
        "icon":            "dna",
        "color":           "#143D36",
        "tags":            ["Péptidos", "Piel", "Articulaciones", "Tipo I y III"],
        "producto_slug":   "clgnhdlb",
        "producto_nombre": "Colágeno Hidrolizado 500g — McKenna Group",
        "producto_precio": "$61.372",
        "producto_foto":   "https://http2.mlstatic.com/D_605879-MCO93543847584_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-845640667",
    },
    {
        "tema":            "L-Arginina aminoácido óxido nítrico suplemento",
        "titulo":          "Guía de Uso — L-Arginina",
        "title_short":     "L-Arginina",
        "slug":            "l-arginina",
        "desc":            "Protocolo técnico de la L-Arginina: precursor de óxido nítrico, vasodilatación, rendimiento deportivo y formulación en suplementos deportivos.",
        "category":        "Aminoácidos",
        "icon":            "lightning",
        "color":           "#2E8B7A",
        "tags":            ["Óxido Nítrico", "Deportivo", "Vasodilatador", "Aminoácido"],
        "producto_slug":   "larg100g",
        "producto_nombre": "L-Arginina 100g — McKenna Group",
        "producto_precio": "$18.286",
        "producto_foto":   "https://http2.mlstatic.com/D_768972-MCO89786501507_082025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-876313054",
    },
    {
        "tema":            "Creatina monohidrato suplemento fuerza rendimiento",
        "titulo":          "Guía de Uso — Creatina Monohidrato",
        "title_short":     "Creatina Monohidrato",
        "slug":            "creatina-monohidrato",
        "desc":            "Manual técnico de la Creatina Monohidrato: síntesis de ATP, ganancia de fuerza, protocolos de carga, solubilidad y formulación en suplementos deportivos.",
        "category":        "Suplementarios",
        "icon":            "lightning",
        "color":           "#143D36",
        "tags":            ["ATP", "Fuerza", "Deportivo", "Masa Muscular"],
        "producto_slug":   "crtnmnh100g",
        "producto_nombre": "Creatina Monohidrato 100g — McKenna Group",
        "producto_precio": "$38.326",
        "producto_foto":   "https://http2.mlstatic.com/D_820431-MCO93967590283_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-862333529",
    },
    {
        "tema":            "L-Glutamina aminoácido intestino inmunidad suplemento",
        "titulo":          "Guía de Uso — L-Glutamina",
        "title_short":     "L-Glutamina",
        "slug":            "l-glutamina",
        "desc":            "Protocolo de la L-Glutamina: aminoácido condicionalmente esencial, salud intestinal, inmunidad, recuperación post-ejercicio y formulación en suplementos.",
        "category":        "Aminoácidos",
        "icon":            "heart",
        "color":           "#1E5C51",
        "tags":            ["Intestinal", "Inmunidad", "Recuperación", "Condicionalmente Esencial"],
        "producto_slug":   "lglt100g",
        "producto_nombre": "L-Glutamina 100g — McKenna Group",
        "producto_precio": "$19.372",
        "producto_foto":   "https://http2.mlstatic.com/D_963726-MCO93544037372_102025-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-876339306",
    },
    {
        "tema":            "Almidón de yuca tapioca excipiente farmacéutico alimento",
        "titulo":          "Guía de Uso — Almidón de Yuca",
        "title_short":     "Almidón de Yuca",
        "slug":            "almidon-yuca",
        "desc":            "Manual del Almidón de Yuca (Tapioca): excipiente farmacéutico, desintegrante de tabletas, espesante alimentario y formulación en cápsulas y comprimidos.",
        "category":        "Excipientes Farmacéuticos",
        "icon":            "flask",
        "color":           "#143D36",
        "tags":            ["Tapioca", "Desintegrante", "Excipiente", "Comprimidos"],
        "producto_slug":   "almyckg",
        "producto_nombre": "Almidón de Yuca 1kg — McKenna Group",
        "producto_precio": "$16.533",
        "producto_foto":   "https://http2.mlstatic.com/D_932949-MCO49101264923_022022-O.jpg",
        "meli_url":        "https://articulo.mercadolibre.com.co/MCO-581501262",
    },
]


# ─── Funciones de búsqueda científica (de knowledge_agent.py) ────────────────
sys.path.insert(0, str(BASE))

def buscar_pubmed(termino, max_results=4):
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    try:
        r = requests.get(f"{base}/esearch.fcgi",
            params={"db":"pubmed","term":termino,"retmax":max_results,"sort":"relevance","retmode":"json"},
            timeout=12)
        ids = r.json().get("esearchresult",{}).get("idlist",[])
        if not ids:
            return []
        rf = requests.get(f"{base}/efetch.fcgi",
            params={"db":"pubmed","id":",".join(ids),"retmode":"xml","rettype":"abstract"},
            timeout=15)
        xml = rf.text
        pmids     = re.findall(r'<PMID[^>]*>(\d+)</PMID>', xml)
        titulos   = re.findall(r'<ArticleTitle>(.*?)</ArticleTitle>', xml, re.DOTALL)
        abstracts = re.findall(r'<AbstractText[^>]*>(.*?)</AbstractText>', xml, re.DOTALL)
        años      = re.findall(r'<PubDate>.*?<Year>(\d{4})</Year>', xml, re.DOTALL)
        out = []
        for i, pmid in enumerate(pmids[:max_results]):
            out.append({
                "pmid":    pmid,
                "titulo":  re.sub(r'<[^>]+>','', titulos[i] if i < len(titulos) else '').strip(),
                "abstract":re.sub(r'<[^>]+>','', abstracts[i] if i < len(abstracts) else '').strip()[:1500],
                "año":     años[i] if i < len(años) else '?',
                "fuente":  "PubMed",
                "url":     f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            })
        return out
    except Exception as e:
        print(f"    ⚠️  PubMed: {e}")
        return []


def _slug(texto):
    s = unicodedata.normalize("NFD", texto.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    return re.sub(r'[\s]+', '-', s.strip())[:60]


def generar_guia_estructurada(tema: str, conocimiento: str) -> dict | None:
    """Llama a Gemini para generar 7 secciones en JSON estructurado."""
    try:
        from google import genai
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        prompt = f"""Eres el equipo técnico de McKenna Group S.A.S. (Bogotá, Colombia), proveedor de materias primas farmacéuticas y cosméticas.

Genera una GUÍA TÉCNICA DE USO PROFESIONAL para "{tema}" dirigida a formuladores, laboratoristas y fabricantes colombianos.

Devuelve ÚNICAMENTE un JSON válido (sin markdown, sin ```) con esta estructura exacta:
{{
  "desc": "Descripción de 1-2 oraciones de la guía y el ingrediente.",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "secciones": [
    {{"num": "01", "titulo": "Descripción técnica del ingrediente", "contenido": "<p>...</p><ul><li>...</li></ul>"}},
    {{"num": "02", "titulo": "Concentraciones de uso recomendadas", "contenido": "<table><thead><tr><th>Aplicación</th><th>Concentración</th><th>Tipo</th></tr></thead><tbody><tr><td>...</td><td>...</td><td>...</td></tr></tbody></table>"}},
    {{"num": "03", "titulo": "Compatibilidad e incompatibilidades", "contenido": "<p>...</p>"}},
    {{"num": "04", "titulo": "Instrucciones de incorporación", "contenido": "<ol><li>...</li></ol>"}},
    {{"num": "05", "titulo": "Condiciones de almacenamiento", "contenido": "<p>...</p>"}},
    {{"num": "06", "titulo": "Normativa INVIMA / regulatoria aplicable", "contenido": "<p>...</p>"}},
    {{"num": "07", "titulo": "Preguntas frecuentes", "contenido": "<div class='faq-item'><strong>¿Pregunta?</strong><p>Respuesta.</p></div>"}}
  ],
  "referencias": [
    {{"titulo": "Título del paper", "fuente": "PubMed", "año": "2023", "url": "https://pubmed.ncbi.nlm.nih.gov/..."}},
    {{"titulo": "Otro paper", "fuente": "ArXiv", "año": "2022", "url": "..."}}
  ]
}}

Reglas:
- contenido SIEMPRE en HTML válido: <p>, <ul><li>, <ol><li>, <table>, <strong>, <em>
- Tablas con <thead> y <tbody>
- Sección 07 con class='faq-item' para cada Q&A
- Referencias: incluir los papers del conocimiento científico + agregar 2-3 referencias reales relevantes
- Lenguaje técnico colombiano, nunca genérico
- Solo datos verificados; para normativa INVIMA mencionar resoluciones reales si las conoces

CONOCIMIENTO CIENTÍFICO:
{conocimiento[:6000]}"""

        resp = client.models.generate_content(
            model='gemini-2.5-pro',
            contents=prompt,
            config={"temperature": 0.3}
        )
        texto = resp.text.strip()
        # Limpiar markdown si viene
        texto = re.sub(r'^```json\s*|^```\s*|```\s*$', '', texto, flags=re.MULTILINE).strip()
        return json.loads(texto)
    except Exception as e:
        print(f"    ❌ Gemini error: {e}")
        return None


def cargar_guias() -> list:
    if GUIAS_JSON.exists():
        with open(GUIAS_JSON, encoding='utf-8') as f:
            return json.load(f)
    return []


def guardar_guias(guias: list):
    with open(GUIAS_JSON, 'w', encoding='utf-8') as f:
        json.dump(guias, f, indent=2, ensure_ascii=False)


def slugs_existentes(guias: list) -> set:
    return {g.get("slug","") for g in guias}


# ─── PIPELINE PRINCIPAL ───────────────────────────────────────────────────────
def main():
    print("\n" + "═"*62)
    print("  GENERACIÓN MASIVA DE GUÍAS — McKenna Group")
    print(f"  {len(INGREDIENTES)} ingredientes en cola")
    print("═"*62)

    guias    = cargar_guias()
    existentes = slugs_existentes(guias)

    pendientes = [ing for ing in INGREDIENTES if ing["slug"] not in existentes]
    print(f"\n  Ya generadas: {len(existentes)}")
    print(f"  Pendientes:   {len(pendientes)}\n")

    if not pendientes:
        print("  ✅ Todas las guías ya están generadas.")
        return

    for idx, ing in enumerate(pendientes, 1):
        print(f"\n[{idx}/{len(pendientes)}] {ing['titulo']}")
        print(f"  slug: {ing['slug']}")

        # 1. PubMed
        print("  📚 PubMed...", end=" ", flush=True)
        papers = buscar_pubmed(ing["tema"], max_results=4)
        print(f"{len(papers)} artículo(s)")
        time.sleep(1)  # respetar rate limit NCBI

        # 2. Compilar conocimiento
        bloques = [f"[{p['fuente']} {p['año']}] {p['titulo']}\n{p['abstract']}" for p in papers]
        conocimiento = "\n\n---\n\n".join(bloques) or f"Conocimiento general sobre {ing['tema']}"

        # 3. Gemini → 7 secciones JSON
        print("  🤖 Gemini...", end=" ", flush=True)
        resultado = generar_guia_estructurada(ing["tema"], conocimiento)
        if not resultado:
            print("  ⚠️  Saltando (Gemini falló)")
            time.sleep(5)
            continue
        print(f"  ✅ {len(resultado.get('secciones',[]))} secciones generadas")

        # 4. Merge con referencias de PubMed + las que generó Gemini
        refs_pubmed = [{"titulo": p["titulo"], "fuente": p["fuente"], "año": p["año"], "url": p["url"]} for p in papers]
        refs_gemini = resultado.get("referencias", [])
        # Dedup por URL
        refs_urls   = {r["url"] for r in refs_pubmed}
        refs_extra  = [r for r in refs_gemini if r.get("url","") not in refs_urls]
        referencias = refs_pubmed + refs_extra

        # 5. Construir entrada para guias.json
        nuevo_id = max((g.get("id", 0) for g in guias), default=0) + 1
        fecha    = datetime.now().strftime("%Y-%m-%d")

        entrada = {
            "id":              nuevo_id,
            "slug":            ing["slug"],
            "title":           ing["titulo"],
            "title_short":     ing["title_short"],
            "desc":            resultado.get("desc") or ing["desc"],
            "category":        ing["category"],
            "icon":            ing["icon"],
            "color":           ing["color"],
            "tags":            resultado.get("tags") or ing["tags"],
            "products":        1,
            "fecha":           fecha,
            "publicada":       True,
            "meli_url":        ing.get("meli_url", ""),
            "producto_slug":   ing.get("producto_slug", ""),
            "producto_nombre": ing.get("producto_nombre", ""),
            "producto_precio": ing.get("producto_precio", ""),
            "producto_foto":   ing.get("producto_foto", ""),
            "referencias":     referencias,
            "secciones":       resultado.get("secciones", []),
        }

        guias.append(entrada)
        guardar_guias(guias)
        print(f"  💾 Guardado en guias.json (id={nuevo_id})")

        # 6. Pausa entre requests (rate limit Gemini)
        if idx < len(pendientes):
            espera = 12
            print(f"  ⏳ Esperando {espera}s...")
            time.sleep(espera)

    print("\n" + "═"*62)
    print(f"  ✅ COMPLETADO — {len(pendientes)} guías nuevas generadas")
    print(f"  Total en guias.json: {len(guias)}")
    print("═"*62 + "\n")


if __name__ == "__main__":
    main()
