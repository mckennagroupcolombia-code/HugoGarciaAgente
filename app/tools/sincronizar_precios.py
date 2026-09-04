def sincronizar_precios_meli_sheets() -> str:
    """
    Trae el precio vivo de cada publicación activa en MeLi (referencia maestra)
    y corrige Alegra, Sheets y el catálogo web donde difieran. Antes esta función
    solo tocaba Sheets y borraba el cache web sin arreglar Alegra — como el
    catálogo web y las cotizaciones de los agentes de atención al cliente leen
    el precio en vivo de Alegra, eso dejaba las cotizaciones mal aunque MeLi
    estuviera correcto. Ver app.services.precios_canales.reconciliar_precios_meli.
    Retorna un resumen en texto de lo que se corrigió.
    """
    from app.services.precios_canales import reconciliar_precios_meli

    resultado = reconciliar_precios_meli(dry_run=False)

    if resultado.get("error"):
        return f"❌ {resultado['error']}"

    candidatos = resultado.get("candidatos") or []
    if not candidatos:
        return "✅ Precios ya están sincronizados entre MeLi, Alegra, Sheets y la web. Sin cambios."

    salida = [f"🔄 {len(candidatos)} producto(s) con precio distinto entre MeLi y Alegra:"]
    for c in candidatos:
        ok = (c.get("siigo_resultado") or {}).get("ok")
        marca = "✅" if ok else "❌"
        salida.append(
            f"{marca} {c['nombre'][:45]} (SKU {c['sku']}): "
            f"Alegra ${c['precio_siigo_antes']:,.0f} → ${c['precio_meli']:,.0f} (precio actual en MeLi)"
        )

    salida.append(f"\n✅ Aplicados en Alegra: {resultado['aplicados']}/{len(candidatos)}")
    for err in resultado.get("errores") or []:
        salida.append(f"⚠️ Error en {err.get('canal')} (SKU {err.get('sku') or '-'}): {err.get('msg')}")

    if resultado.get("web_resultado"):
        salida.append(f"\n🌐 Web: {resultado['web_resultado']}")

    return "\n".join(salida)
