#!/usr/bin/env python3
"""
Generación masiva de Recetas — McKenna Group
═════════════════════════════════════════════
Genera recetas de formulación para cosmética, nutrición, perfumería y hogar
usando las materias primas del catálogo. Usa Gemini.

Uso:
    source venv/bin/activate
    python3 generar_recetas_masivas.py

Genera ~40 recetas nuevas. Tiempo estimado: 25-35 minutos.
"""

import os, sys, json, time
from pathlib import Path

BASE       = Path(__file__).parent
RECETAS_JSON = BASE / "PAGINA_WEB/site/data/recetas.json"
DOTENV     = BASE / ".env"

# Cargar .env
for line in DOTENV.read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

from google import genai as google_genai
_client = google_genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

# ─── Catálogo de recetas a generar ────────────────────────────────────────────
# Formato: (cat, title, title2, descripcion_breve)
RECETAS_PLAN = [
    # ── COSMÉTICA ──────────────────────────────────────────────────────────────
    ("cosmetica", "Sérum Hialurónico",        "Ultra Hidratante",
     "Sérum de hidratación profunda con ácido hialurónico de alto y bajo peso molecular."),

    ("cosmetica", "Tónico Niacinamida 5%",    "Poros y Luminosidad",
     "Tónico acuoso con niacinamida para reducir poros dilatados y unificar el tono."),

    ("cosmetica", "Crema de Noche Retinol",   "Renovación Celular",
     "Crema nocturna con retinol y vitamina E para estimular la renovación celular."),

    ("cosmetica", "Gel Limpiador Facial",     "Piel Grasa y Mixta",
     "Limpiador en gel con betaína de coco y ácido cítrico para piel grasa y mixta."),

    ("cosmetica", "Sérum Despigmentante",     "Alfa-Arbutina + Niacinamida",
     "Sérum combinado de alfa-arbutina y niacinamida para manchas y tono desigual."),

    ("cosmetica", "Crema Solar FPS 30",       "Óxido de Zinc",
     "Protector solar mineral con óxido de zinc, seguro para piel sensible."),

    ("cosmetica", "Exfoliante AHA 5%",        "Renovación Suave",
     "Exfoliante químico suave con ácido glicólico al 5% para renovar la piel sin irritar."),

    ("cosmetica", "Contorno de Ojos Cafeína", "Antibolsas y Ojeras",
     "Gel suave para el contorno de ojos con cafeína anhidra para reducir bolsas y ojeras."),

    ("cosmetica", "Bálsamo Labial",           "Manteca de Cacao",
     "Bálsamo nutritivo para labios con manteca de cacao, cera de abejas y vitamina E."),

    ("cosmetica", "Champú Sólido",            "SCI Suave",
     "Barra de champú sólido con SCI (Sodium Cocoyl Isethionate) para todo tipo de cabello."),

    ("cosmetica", "Acondicionador Capilar",   "BTMS-50 Reparador",
     "Acondicionador de enjuague con BTMS-50 y aceite de argán para cabello seco y dañado."),

    ("cosmetica", "Crema Corporal",           "Karité y Glicerina",
     "Crema hidratante corporal ligera con manteca de karité y glicerina vegetal."),

    ("cosmetica", "Desodorante Natural",      "Bicarbonato y Karité",
     "Desodorante en crema sin aluminio con bicarbonato de sodio y manteca de karité."),

    ("cosmetica", "Gel Antiacné",             "Ácido Salicílico 2%",
     "Gel de tratamiento localizado con ácido salicílico al 2% para acné activo."),

    ("cosmetica", "Aceite Facial Seco",       "Rosa Mosqueta y Argán",
     "Aceite facial seco de rápida absorción con aceite de rosa mosqueta y argán."),

    ("cosmetica", "Mascarilla Iluminadora",   "Vitamina C y Aloe",
     "Mascarilla gel iluminadora con ácido ascórbico estabilizado y aloe vera."),

    ("cosmetica", "Tónico Ácido Cítrico",     "Piel Opaca y Poros",
     "Tónico exfoliante suave con ácido cítrico para piel opaca, poros y exceso de grasa."),

    ("cosmetica", "Loción Corporal DMSO",     "Penetración Intensiva",
     "Loción con DMSO para maximizar la penetración de activos cosméticos en piel gruesa."),

    ("cosmetica", "Emulsión Colágeno",        "Antienvejecimiento",
     "Emulsión O/W con colágeno hidrolizado y aceite de semilla de uva para piel madura."),

    ("cosmetica", "Mascarilla Facial Arcilla","Árbol de Té Purificante",
     "Mascarilla detox con aceite esencial de árbol de té para piel grasa y propensa al acné."),

    # ── NUTRICIÓN ──────────────────────────────────────────────────────────────
    ("nutricion", "Pre-Entreno Casero",       "Creatina y Arginina",
     "Mezcla en polvo pre-entreno con creatina monohidratada y L-arginina para rendimiento."),

    ("nutricion", "Polvo Recovery",           "Glutamina y Vitamina C",
     "Bebida de recuperación post-entrenamiento con L-glutamina y vitamina C."),

    ("nutricion", "Electrolitos Caseros",     "Citrato de Potasio",
     "Bebida isotónica natural con citrato de potasio y magnesio para reposición de sales."),

    ("nutricion", "Cápsulas Vitamina B12",    "Energía y Sistema Nervioso",
     "Encapsulado básico de vitamina B12 en polvo para suplementación diaria."),

    ("nutricion", "Bebida L-Arginina",        "Flujo Sanguíneo",
     "Bebida funcional con L-arginina para apoyar la circulación y el óxido nítrico."),

    ("nutricion", "Polvo de Magnesio",        "Relajación Muscular",
     "Suplemento de citrato de magnesio en polvo para calambres y relajación muscular."),

    ("nutricion", "Cápsulas Aloe Vera",       "Digestión y Tránsito",
     "Encapsulado de aloe vera en polvo para apoyar la salud digestiva y el tránsito intestinal."),

    ("nutricion", "Gel Energético",           "Creatina + Glucosa",
     "Gel de carbohidratos y creatina para consumir durante el ejercicio de alta intensidad."),

    # ── PERFUMERÍA ──────────────────────────────────────────────────────────────
    ("perfumeria", "Eau de Toilette Cítrica",  "Bergamota y Menta",
     "Fragancia fresca unisex con notas de bergamota y menta sobre base amaderada."),

    ("perfumeria", "Agua de Colonia",          "Eucalipto y Árbol de Té",
     "Colonia terapéutica refrescante con eucalipto y árbol de té para el cuerpo y el hogar."),

    ("perfumeria", "Perfume Amaderado",        "Unisex Contemporáneo",
     "Fragancia unisex con aceites esenciales sobre base de aceite de jojoba y alcohol."),

    ("perfumeria", "Roll-on Aromático",        "Menta y Bergamota",
     "Perfume roll-on concentrado para muñecas y cuello con aceites esenciales puros."),

    ("perfumeria", "Splash Corporal",          "Floral Ligero",
     "Splash corporal suave con aceite esencial de rosa mosqueta y bergamota."),

    ("perfumeria", "Velas Aromáticas",         "Cera de Abejas y Eucalipto",
     "Velas naturales de cera de abejas con aceite esencial de eucalipto para aromaterapia."),

    # ── HOGAR ───────────────────────────────────────────────────────────────────
    ("hogar", "Suavizante Natural",           "Glicerina y Lavanda",
     "Suavizante de ropa natural con glicerina vegetal y aceite esencial de lavanda."),

    ("hogar", "Desinfectante de Superficies", "Árbol de Té y Ácido Cítrico",
     "Desinfectante natural para superficies con árbol de té y ácido cítrico, sin cloro."),

    ("hogar", "Vela de Cera de Carnauba",     "Premium Larga Duración",
     "Vela de acabado premium con cera de carnauba y aceite esencial de menta."),

    ("hogar", "Jabón Artesanal en Barra",     "Neem y Árbol de Té",
     "Jabón de barra para acné corporal y piel con problemas con aceite de neem."),

    ("hogar", "Ambientador en Spray",         "Eucalipto y Mentol",
     "Spray refrescante para el hogar con mentol cristal y eucalipto."),

    ("hogar", "Cera para Muebles",            "Carnauba Natural",
     "Cera protectora y brillante para muebles de madera con cera de carnauba."),
]


PROMPT_TEMPLATE = """Formulador cosmético McKenna Group (Colombia). Genera receta para: {title} — {title2} ({cat_label}).
Descripción: {desc}

Reglas: materias primas = src "McKenna Group", agua/envases = src "uso propio". Máx 7 ingredientes, 5 pasos. Pasos cortos (máx 15 palabras c/u). Tip corto (máx 20 palabras).

Devuelve SOLO JSON sin markdown:
{{"cat":"{cat}","title":"{title}","title2":"{title2}","desc":"{desc_short}","tags":["t1","t2","t3"],"base":100,"unidad":"g","ings":[{{"n":"nombre","q":10,"u":"g","src":"McKenna Group"}}],"pasos":["paso 1"],"tip":"consejo"}}

Ingredientes McKenna: Ácido Ascórbico, Cítrico, Glicólico, Hialurónico, Láctico, Salicílico, Azelaico, Esteárico | Aceites: Argán, Neem, Ricino, Semilla Uva, Rosa Mosqueta, Vaselina | Esenciales: Eucalipto, Árbol Té, Menta, Bergamota | Ceras: Cacao, Karité, Abejas, Carnauba, Lanolina | Emuls: Alcohol Cetílico, Betaína Coco, BTMS-50, Polisorbato-20, SCI | Humect: Glicerina, Urea, Sorbitol | Activos: Niacinamida, Vit-E, Alfa-Arbutina, Retinol, Óxido Zinc, DMSO, Cafeína | Conserv: Sorbato K, Benzoato Na, Sharomix 705 | Sales: Bicarbonato Na, Citrato Mg, Citrato K | Suplem: Colágeno, L-Arginina, Creatina, L-Glutamina, Vit-B12 | Otros: Aloe Vera, Goma Xanthan, Mentol, Almidón Yuca"""

CAT_LABELS = {
    "cosmetica": "Cosmética",
    "nutricion": "Nutrición",
    "perfumeria": "Perfumería",
    "hogar": "Hogar"
}


def generar_receta(plan: tuple) -> dict | None:
    cat, title, title2, desc = plan
    prompt = PROMPT_TEMPLATE.format(
        cat=cat,
        cat_label=CAT_LABELS[cat],
        title=title,
        title2=title2,
        desc=desc,
        desc_short=desc[:120]
    )
    try:
        resp = _client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=prompt,
            config={"temperature": 0.7, "max_output_tokens": 4096}
        )
        raw = resp.text.strip()
        # Limpiar markdown si viene
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        data = json.loads(raw)
        return data
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return None


def main():
    # Cargar recetas existentes
    if RECETAS_JSON.exists():
        recetas = json.loads(RECETAS_JSON.read_text(encoding="utf-8"))
    else:
        recetas = []

    titulos_existentes = {r["title"].lower() for r in recetas}
    next_id = max((r["id"] for r in recetas), default=0) + 1

    pendientes = [p for p in RECETAS_PLAN if p[1].lower() not in titulos_existentes]

    print("\n" + "═" * 60)
    print("  GENERACIÓN MASIVA DE RECETAS — McKenna Group")
    print(f"  {len(pendientes)} recetas en cola")
    print("═" * 60)
    print(f"\n  Ya generadas: {len(recetas)}")
    print(f"  Pendientes:   {len(pendientes)}\n")

    for idx, plan in enumerate(pendientes, 1):
        cat, title, title2, desc = plan
        print(f"[{idx}/{len(pendientes)}] {title} — {title2}")
        print(f"  cat: {cat}")
        print(f"  🤖 Gemini...", end=" ", flush=True)

        receta = generar_receta(plan)
        if not receta:
            print("  ⚠ Saltando...")
            time.sleep(5)
            continue

        # Asignar ID secuencial
        receta["id"] = next_id
        next_id += 1

        # Asegurar campos obligatorios
        receta.setdefault("cat", cat)
        receta.setdefault("title", title)
        receta.setdefault("title2", title2)
        receta.setdefault("desc", desc)

        recetas.append(receta)

        # Guardar inmediatamente
        RECETAS_JSON.write_text(
            json.dumps(recetas, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        print(f"✅ {len(receta.get('ings', []))} ings, {len(receta.get('pasos', []))} pasos")
        print(f"  💾 Guardado en recetas.json (id={receta['id']})")

        if idx < len(pendientes):
            print(f"  ⏳ Esperando 10s...")
            time.sleep(10)

    print("\n" + "═" * 60)
    print(f"  ✅ COMPLETADO — {len(recetas)} recetas en total")
    print("═" * 60 + "\n")


if __name__ == "__main__":
    main()
