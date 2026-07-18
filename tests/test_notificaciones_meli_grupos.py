"""
Tests: JIDs preventa vs postventa (sin mezclar) y que cada módulo llama a WhatsApp con el grupo correcto.
"""
import os
import unittest
from unittest.mock import MagicMock, patch


JID_PREVENTA = "120363393955474672@g.us"
JID_POSTVENTA = "120363406693905719@g.us"


class TestJidGruposWa(unittest.TestCase):
    def test_preventa_default_sin_env(self):
        from app.utils import jid_grupo_preventa_wa

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GRUPO_PREVENTA_WA", None)
            self.assertEqual(jid_grupo_preventa_wa(), JID_PREVENTA)

    def test_postventa_default_sin_env(self):
        from app.utils import jid_grupo_postventa_wa

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GRUPO_POSTVENTA_WA", None)
            self.assertEqual(jid_grupo_postventa_wa(), JID_POSTVENTA)

    def test_preventa_no_usa_postventa_cuando_solo_postventa_esta_definido(self):
        """Si falta GRUPO_PREVENTA_WA, el default sigue siendo Preventa_Meli (no el de postventa)."""
        from app.utils import jid_grupo_preventa_wa

        with patch.dict(os.environ, {"GRUPO_POSTVENTA_WA": JID_POSTVENTA}, clear=False):
            os.environ.pop("GRUPO_PREVENTA_WA", None)
            self.assertEqual(jid_grupo_preventa_wa(), JID_PREVENTA)

    def test_env_override_y_comentario_inline(self):
        from app.utils import jid_grupo_preventa_wa, jid_grupo_postventa_wa

        with patch.dict(
            os.environ,
            {
                "GRUPO_PREVENTA_WA": "111@g.us # systemd comment",
                "GRUPO_POSTVENTA_WA": "222@g.us # otro",
            },
        ):
            self.assertEqual(jid_grupo_preventa_wa(), "111@g.us")
            self.assertEqual(jid_grupo_postventa_wa(), "222@g.us")


class TestPreventaReporteIA(unittest.TestCase):
    def test_procesar_nueva_pregunta_flujo_borrador(self):
        """
        Flujo actual: procesar_nueva_pregunta delega en manejar_pregunta_preventa
        (vía analizar_y_crear_respuesta, que recibe el item_id de la pregunta) y
        NO envía reporte propio — el borrador IA se reporta dentro de
        manejar_pregunta_preventa con aprobación 'ok <sufijo>'.
        """
        import preventa_meli

        destinos = []

        def capture_enviar(texto, numero_destino=None):
            destinos.append(numero_destino)
            return True

        with patch.dict(os.environ, {"GRUPO_PREVENTA_WA": JID_PREVENTA}, clear=False):
            with patch.object(preventa_meli, "obtener_token_meli", return_value="tok"):
                with patch.object(
                    preventa_meli,
                    "obtener_detalle_pregunta",
                    return_value={"text": "¿Hay stock?", "item_id": "MCO123"},
                ):
                    with patch.object(
                        preventa_meli,
                        "obtener_nombre_producto_meli",
                        return_value="Producto Demo",
                    ):
                        with patch.object(
                            preventa_meli,
                            "analizar_y_crear_respuesta",
                            return_value=(None, False),
                        ) as mock_analizar:
                            with patch(
                                "app.utils.enviar_whatsapp_reporte",
                                side_effect=capture_enviar,
                            ):
                                preventa_meli.procesar_nueva_pregunta("131415160681")

        self.assertEqual(destinos, [], "procesar_nueva_pregunta no reporta por sí misma")
        mock_analizar.assert_called_once()
        args, kwargs = mock_analizar.call_args
        self.assertEqual(args[0], "¿Hay stock?")
        self.assertEqual(args[1], "MCO123", "debe pasar el item_id de la pregunta")

    def test_manejar_pregunta_pasa_item_id_a_otras_presentaciones(self):
        from app.services import meli_preventa

        capturado = {}

        def fake_otras(titulo, item_id_actual=""):
            capturado["item_id"] = item_id_actual
            return ""

        with patch(
            "app.services.google_services.buscar_ficha_tecnica_producto",
            return_value="ficha demo",
        ):
            with patch.object(meli_preventa, "otras_presentaciones_meli", side_effect=fake_otras):
                with patch.object(meli_preventa, "contexto_hilo_reciente", return_value=""):
                    with patch.object(
                        meli_preventa, "generar_respuesta_con_ficha", return_value="borrador"
                    ):
                        with patch.object(meli_preventa, "guardar_pregunta_pendiente", return_value=True):
                            with patch("app.utils.enviar_whatsapp_reporte", return_value=True):
                                meli_preventa.manejar_pregunta_preventa(
                                    "777", "Producto Demo 500 Gr", "¿Hay más pequeño?",
                                    item_id="MCO456",
                                )
        self.assertEqual(capturado.get("item_id"), "MCO456")


class TestMeliPreventaDelegacion(unittest.TestCase):
    def test_sin_ficha_alerta_va_a_preventa(self):
        from app.services import meli_preventa

        destinos = []

        with patch(
            "app.services.google_services.buscar_ficha_tecnica_producto",
            return_value=None,
        ):
            with patch(
                "app.utils.enviar_whatsapp_reporte",
                side_effect=lambda t, numero_destino=None: destinos.append(
                    numero_destino
                )
                or True,
            ):
                with patch.object(meli_preventa, "_guardar_pendientes"):
                    with patch.object(meli_preventa, "_leer_pendientes", return_value=[]):
                        r1, r2 = meli_preventa.manejar_pregunta_preventa(
                            "999", "X", "pregunta?"
                        )
        self.assertIsNone(r1)
        self.assertFalse(r2)
        self.assertEqual(destinos, [JID_PREVENTA])


class TestMeliPostventaTextoApi(unittest.TestCase):
    def test_texto_string(self):
        from app.utils import meli_postventa_texto_para_notif

        self.assertEqual(
            meli_postventa_texto_para_notif({"text": "  Hola  "}),
            "Hola",
        )

    def test_texto_dict_plain(self):
        from app.utils import meli_postventa_texto_para_notif

        self.assertEqual(
            meli_postventa_texto_para_notif(
                {"text": {"plain": "FACTURA POR FAVOR"}}
            ),
            "FACTURA POR FAVOR",
        )

    def test_solo_adjunto_genera_placeholder(self):
        from app.utils import meli_postventa_id_mensaje, meli_postventa_texto_para_notif

        msg = {
            "id": "abc-123",
            "attachments": [
                {"original_filename": "RUT.pdf", "size": 100},
            ],
        }
        self.assertEqual(meli_postventa_id_mensaje(msg), "abc-123")
        t = meli_postventa_texto_para_notif(msg)
        self.assertIn("RUT.pdf", t)
        self.assertIn("adjunto", t.lower())

    def test_message_id_alternativo(self):
        from app.utils import meli_postventa_id_mensaje

        self.assertEqual(
            meli_postventa_id_mensaje({"message_id": "xyz"}),
            "xyz",
        )


class TestWebhookPosventa(unittest.TestCase):
    def test_notificacion_postventa_al_grupo_postventa(self):
        import app.meli_postventa_notif as meli_pv

        destinos = []

        def cap(txt, numero_destino=None):
            destinos.append(numero_destino)

        buyer = {
            "id": "test-msg-id-xyz",
            "from": {"user_id": "888001", "name": "Comprador Test"},
            "text": "¿Cuándo despachan?",
        }

        def fake_get(url, headers=None, timeout=None, **kwargs):
            m = MagicMock()
            m.status_code = 200
            if "messages/packs/" in url and "tag=post_sale" in url:
                m.json.return_value = {"messages": [buyer]}
            elif "/orders/" in url:
                m.json.return_value = {"order_items": []}
            else:
                m.json.return_value = {}
            return m

        with patch.dict(
            os.environ,
            {"GRUPO_POSTVENTA_WA": JID_POSTVENTA, "GRUPO_PREVENTA_WA": JID_PREVENTA},
            clear=False,
        ):
            with patch.object(meli_pv, "refrescar_token_meli", return_value="t"):
                with patch.object(meli_pv, "obtener_seller_id_meli", return_value="432439187"):
                    with patch.object(meli_pv, "_requests_lib") as req_mod:
                        req_mod.get.side_effect = fake_get
                        with patch.object(
                            meli_pv, "enviar_whatsapp_reporte", side_effect=cap
                        ):
                            with patch.object(
                                meli_pv,
                                "_cargar_state_posventa",
                                return_value={"pendientes": {}, "procesados": []},
                            ):
                                with patch.object(meli_pv, "_guardar_state_posventa"):
                                    with patch("app.monitor.incrementar_metrica", MagicMock()):
                                        meli_pv.procesar_postventa_meli_desde_webhook(
                                            "/messages/packs/2000999888777/sellers/432439187"
                                        )

        self.assertEqual(destinos, [JID_POSTVENTA])
        self.assertTrue(req_mod.get.called)


class TestRoutesPosventa(unittest.TestCase):
    def test_routes_posventa_corre_sin_nameerror_y_jid_postventa(self):
        """La función de postventa vive en app.meli_postventa_notif; ambos módulos la importan."""
        import app.meli_postventa_notif as meli_pv

        destinos = []

        def cap(txt, numero_destino=None):
            destinos.append(numero_destino)

        buyer = {
            "id": "routes-msg-1",
            "from": {"user_id": "777002", "name": "Cliente R"},
            "text": "Hola desde test",
        }

        def fake_get(url, headers=None, timeout=None, **kwargs):
            m = MagicMock()
            m.status_code = 200
            if "messages/packs/" in url and "tag=post_sale" in url:
                m.json.return_value = {"messages": [buyer]}
            elif "/orders/" in url:
                m.json.return_value = {"order_items": []}
            else:
                m.json.return_value = {}
            return m

        with patch.dict(
            os.environ,
            {"GRUPO_POSTVENTA_WA": JID_POSTVENTA, "GRUPO_PREVENTA_WA": JID_PREVENTA},
            clear=False,
        ):
            with patch.object(meli_pv, "refrescar_token_meli", return_value="t"):
                with patch.object(meli_pv, "obtener_seller_id_meli", return_value="432439187"):
                    with patch.object(meli_pv, "_requests_lib") as rq:
                        rq.get.side_effect = fake_get
                        with patch.object(
                            meli_pv, "enviar_whatsapp_reporte", side_effect=cap
                        ):
                            with patch.object(
                                meli_pv,
                                "_cargar_state_posventa",
                                return_value={"pendientes": {}, "procesados": []},
                            ):
                                with patch.object(meli_pv, "_guardar_state_posventa"):
                                    with patch("app.monitor.incrementar_metrica", MagicMock()):
                                        meli_pv.procesar_postventa_meli_desde_webhook(
                                            "/messages/packs/3000888777666/sellers/432439187"
                                        )

        self.assertEqual(destinos, [JID_POSTVENTA])


if __name__ == "__main__":
    unittest.main()
