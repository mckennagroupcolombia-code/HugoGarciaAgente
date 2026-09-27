"""Studio → Árbol del producto: une el taller de combos con Canales del producto."""

from app.services import arbol_producto, canales_producto, mapa_producto


def _combo(ref, nombre, familia, linea="Conservantes", etiqueta=None, pres=""):
    ok = {"estado": "ok", "titulo": "", "detalle": ""}
    return {
        "ref": ref, "nombre": nombre, "familia": familia, "presentacion": pres, "linea": linea,
        "precio_lista": 1000, "foto": None, "foto_estado": "ok", "foto_motivo": "",
        "componentes": [{"codigo": familia, "nombre": "SORBATO", "casilla": "materia_prima"}],
        "eslabones": {
            "receta": dict(ok, detalle="1 MP + 6 emp."),
            "etiqueta_fisica": ok,
            "documento": dict(ok, doc_titulo="SORBATO DE POTASIO", archivo="x.yaml"),
            "ean": dict(ok, codigo="7700000000000"),
            "etiqueta": etiqueta or dict(ok, etiqueta_id="e1", png="ETIQUETAS STUDIO/Conservantes/A.png",
                                         png_digital="PUBLICACIONES DIGITALES/Conservantes/A_digital.png"),
            "publicacion": dict(ok, meli_id="MCO1"),
        },
    }


def _fila(sku, facturable="si", meli="publicado", web=True):
    return {
        "sku": sku,
        "clasificacion": "completo",
        "canales": {
            "alegra": {"estado": "ok", "tipo": "kit"},
            "facturable": {"estado": facturable, "alias_destino": ""},
            "meli": {"estado": meli, "meli_id": "MCO1", "permalink": "", "pausada_por_cese": False},
            "web": {"estado": "publicado" if web else "falta", "buyable": True, "cat": "Conservantes"},
        },
    }


def test_arbol_agrupa_por_categoria_y_familia(monkeypatch):
    combos = [
        _combo("C-SORPOTKg", "SORBATO POTASIO KG", "SORPOTg"),
        _combo("C-SORPOT250g", "SORBATO POTASIO 250g", "SORPOTg", pres="250g"),
        _combo("C-SORPOT100g", "SORBATO POTASIO 100g", "SORPOTg",
               etiqueta={"estado": "ok", "etiqueta_id": "e2", "png": "ETIQUETAS STUDIO/Aditivos alimentarios/B.png",
                         "png_digital": ""}),
    ]
    monkeypatch.setattr(mapa_producto, "anatomia_combos", lambda refrescar=False: {"combos": combos, "generado": "x"})
    monkeypatch.setattr(canales_producto, "tabla_maestra", lambda refrescar=False: {"filas": [
        _fila("C-SORPOTKg", meli="falta", web=False), _fila("C-SORPOT250g"), _fila("C-SORPOT100g", facturable="no"),
    ]})

    d = arbol_producto.arbol()
    assert [c["nombre"] for c in d["categorias"]] == ["Conservantes"]
    fam = d["categorias"][0]["familias"][0]
    assert fam["nombre"] == "SORBATO DE POTASIO"
    # Ordenadas por tamaño: 100 g < 250 g < 1 kg.
    assert [p["ref"] for p in fam["presentaciones"]] == ["C-SORPOT100g", "C-SORPOT250g", "C-SORPOTKg"]
    p100, p250, pkg = fam["presentaciones"]
    assert p250["listas"] == 6 and fam["completas"] == 1
    # Sin la variante desenfocada, el par está a medias; y el SKU que Alegra no factura, falta.
    assert p100["piezas"]["etiquetas"]["estado"] == "aviso"
    assert p100["piezas"]["factura"]["estado"] == "falta"
    assert pkg["piezas"]["web"]["estado"] == "aviso" and pkg["piezas"]["meli"]["estado"] == "aviso"
    assert "Aditivos alimentarios" in fam["carpetas_png"]


def test_arbol_sigue_sin_canales(monkeypatch):
    monkeypatch.setattr(mapa_producto, "anatomia_combos",
                        lambda refrescar=False: {"combos": [_combo("C-X1", "X 100g", "")], "generado": "x"})

    def roto(refrescar=False):
        raise RuntimeError("sin caché")

    monkeypatch.setattr(canales_producto, "tabla_maestra", roto)
    d = arbol_producto.arbol()
    assert d["sin_senal"] and d["sin_senal"][0]["fuente"] == "Canales del producto"
    fam = d["categorias"][0]["familias"][0]
    assert fam["clave"] == "solo:C-X1"
    assert fam["presentaciones"][0]["piezas"]["factura"]["estado"] == "aviso"
