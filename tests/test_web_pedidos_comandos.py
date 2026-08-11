"""
Tests automatizados: comandos WhatsApp pedidos web (facturar/envío por sufijo, flex).
Ejecutar: python -m unittest tests.test_web_pedidos_comandos -v
"""
from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

JID_WEB = "120363391665421264@g.us"


class SyncThread(threading.Thread):
    """Ejecuta el target en el mismo hilo al start() (para probar /whatsapp sin sleep)."""

    def start(self):
        self.run()


def _insert_order(db: Path, ref: str) -> None:
    con = sqlite3.connect(db)
    con.execute(
        """
        INSERT INTO orders (
            reference, buyer_name, buyer_email, total, status, items_json, created_at
        ) VALUES (?, 'Cliente', 'c@test.com', 1000, 'approved', '{}', '2026-04-01T12:00:00')
        """,
        (ref,),
    )
    con.commit()
    con.close()


class TestResolverYEnvio(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "orders.db"
        import app.tools.web_pedidos as wp

        self.wp = wp
        wp.ORDERS_DB = self.db
        wp.migrate_orders_table()
        _insert_order(self.db, "MCKG-F09BC12250")

    def test_resolver_sufijo_tres_caracteres(self) -> None:
        ref, err = self.wp.resolver_referencia_desde_token("250")
        self.assertEqual(err, "")
        self.assertEqual(ref, "MCKG-F09BC12250")

    def test_resolver_ref_completa(self) -> None:
        ref, err = self.wp.resolver_referencia_desde_token("MCKG-F09BC12250")
        self.assertEqual(err, "")
        self.assertEqual(ref, "MCKG-F09BC12250")

    def test_resolver_inexistente(self) -> None:
        ref, err = self.wp.resolver_referencia_desde_token("999")
        self.assertIsNone(ref)
        self.assertIn("Ningún pedido", err)

    def test_resolver_ambiguo(self) -> None:
        _insert_order(self.db, "MCKG-AAA00000250")
        ref, err = self.wp.resolver_referencia_desde_token("250")
        self.assertIsNone(ref)
        self.assertIn("Varios pedidos", err)

    def test_facturar_por_sufijo(self) -> None:
        ok, msg = self.wp.marcar_solicitud_facturacion("250")
        self.assertFalse(ok)
        with patch(
            "app.tools.web_pedidos.emitir_factura_siigo_pedido_web",
            return_value=(True, "Factura emitida para MCKG-F09BC12250"),
        ):
            ok2, msg2 = self.wp.marcar_solicitud_facturacion("MCKG-F09BC12250")
        self.assertTrue(ok2)
        self.assertIn("MCKG-F09BC12250", msg2)

    def test_anular_restaura_stock(self) -> None:
        import json
        import app.tools.stock_web as sw

        stock_path = Path(self.tmp.name) / "stock_web.json"
        sw.STOCK_WEB_FILE = stock_path
        stock_path.write_text(
            json.dumps({"SKU-T": {"stock": 10, "updated_at": "x"}}),
            encoding="utf-8",
        )
        con = sqlite3.connect(self.db)
        con.execute(
            """
            UPDATE orders SET
                items_json = ?,
                stock_descontado_at = '2026-04-01T12:00:00'
            WHERE reference = 'MCKG-F09BC12250'
            """,
            (json.dumps({"items": [{"ref": "SKU-T", "qty": 3, "name": "T"}]}),),
        )
        con.commit()
        con.close()

        ok, msg = self.wp.anular_pedido_web("250")
        self.assertTrue(ok, msg)
        self.assertIn("anulado", msg.lower())
        data = json.loads(stock_path.read_text(encoding="utf-8"))
        self.assertEqual(data["SKU-T"]["stock"], 13)

        order = self.wp.get_order_by_reference("MCKG-F09BC12250")
        self.assertEqual(order["status"], "cancelled")
        self.assertTrue(order.get("stock_restaurado_at"))

        ok2, msg2 = self.wp.anular_pedido_web("250")
        self.assertFalse(ok2)
        self.assertIn("ya está anulado", msg2)

    def test_registrar_envio_guia(self) -> None:
        with patch.object(self.wp, "send_shipped_email", return_value=False):
            ok, out = self.wp.registrar_envio_y_notificar(
                "MCKG-F09BC12250", "7005753156", "Interrapidísimo"
            )
        self.assertTrue(ok)
        row = self.wp.get_order_by_reference("MCKG-F09BC12250")
        assert row is not None
        self.assertEqual(row["tracking_number"], "7005753156")

    def test_registrar_envio_flex(self) -> None:
        with patch.object(self.wp, "send_shipped_email", return_value=True):
            ok, out = self.wp.registrar_envio_y_notificar(
                "MCKG-F09BC12250", "flex", ""
            )
        self.assertTrue(ok)
        self.assertIn("flex", out.lower())
        row = self.wp.get_order_by_reference("MCKG-F09BC12250")
        assert row is not None
        self.assertEqual(row["tracking_number"], "FLEX")
        self.assertIn("motorizado", (row.get("tracking_carrier") or "").lower())

    def test_registrar_entrega_factura_en_ese_momento(self) -> None:
        """Facturar al ENTREGAR, no al vender: dispara Siigo solo con 'entregado'."""
        with patch(
            "app.tools.web_pedidos.emitir_factura_siigo_pedido_web",
            return_value=(True, "Factura emitida para MCKG-F09BC12250"),
        ) as mock_fact:
            ok, out = self.wp.registrar_entrega_y_facturar("MCKG-F09BC12250")
        self.assertTrue(ok, out)
        mock_fact.assert_called_once_with("MCKG-F09BC12250", force=True)
        row = self.wp.get_order_by_reference("MCKG-F09BC12250")
        assert row is not None
        self.assertEqual(row["shipping_status"], "delivered")
        self.assertTrue(row.get("delivered_at"))

    def test_registrar_entrega_pedido_inexistente(self) -> None:
        ok, out = self.wp.registrar_entrega_y_facturar("999")
        self.assertFalse(ok)
        self.assertIn("No encontré", out)

    def test_anular_con_factura_crea_ticket_nota_credito(self) -> None:
        con = sqlite3.connect(self.db)
        con.execute(
            "UPDATE orders SET siigo_invoice_number = 'FE-100', siigo_invoice_id = 'inv-100' "
            "WHERE reference = 'MCKG-F09BC12250'"
        )
        con.commit()
        con.close()

        with patch(
            "app.tools.notas_credito.crear_ticket_nota_credito",
            return_value=(True, "🎫 Ticket #7 creado en el Centro de Mando."),
        ) as mock_ticket:
            ok, out = self.wp.anular_pedido_web("250", reason="cliente se arrepintió")
        self.assertTrue(ok, out)
        mock_ticket.assert_called_once()
        kwargs = mock_ticket.call_args.kwargs
        self.assertEqual(kwargs["canal"], "Web")
        self.assertEqual(kwargs["referencia"], "MCKG-F09BC12250")
        self.assertEqual(kwargs["siigo_factura_numero"], "FE-100")
        self.assertIn("Ticket #7", out)

    def test_reembolsar_mp_marca_refunded(self) -> None:
        con = sqlite3.connect(self.db)
        con.execute(
            "UPDATE orders SET payu_ref = '170994362109', total = 65872 "
            "WHERE reference = 'MCKG-F09BC12250'"
        )
        con.commit()
        con.close()

        class _Resp:
            status_code = 201
            text = '{"id":99,"status":"approved","amount":65872}'

            def json(self):
                return {
                    "id": 99,
                    "status": "approved",
                    "amount": 65872,
                    "date_created": "2026-08-10T20:00:00.000-05:00",
                    "currency_id": "COP",
                }

        with patch.dict(os.environ, {"MP_ACCESS_TOKEN": "APP_USR-test"}, clear=False):
            with patch("requests.post", return_value=_Resp()) as mock_post:
                with patch.object(self.wp, "_mp_consultar_pago", return_value={}):
                    ok, out, recibo = self.wp.reembolsar_pedido_web(
                        "250", reason="producto agotado", notify_wa=False
                    )
        self.assertTrue(ok, out)
        self.assertIn("reembolsado", out.lower())
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertIn("/v1/payments/170994362109/refunds", args[0])
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer APP_USR-test")
        self.assertIsInstance(recibo, dict)
        self.assertEqual(recibo.get("payment_id"), "170994362109")
        self.assertEqual(str(recibo.get("refund_id")), "99")
        self.assertEqual(recibo.get("monto"), 65872)
        row = self.wp.get_order_by_reference("MCKG-F09BC12250")
        assert row is not None
        self.assertEqual(row["status"], "refunded")
        self.assertEqual(str(row.get("mp_refund_id")), "99")
        self.assertTrue(row.get("refunded_at"))
        self.assertIn("170994362109", row.get("mp_refund_json") or "")

    def test_reembolsar_sin_payu_ref(self) -> None:
        ok, out, recibo = self.wp.reembolsar_pedido_web("250")
        self.assertFalse(ok)
        self.assertIsNone(recibo)
        self.assertIn("payu_ref", out.lower())

    def test_reembolsar_enviado_requiere_force(self) -> None:
        con = sqlite3.connect(self.db)
        con.execute(
            """
            UPDATE orders SET payu_ref = '111', shipping_status = 'shipped'
            WHERE reference = 'MCKG-F09BC12250'
            """
        )
        con.commit()
        con.close()
        ok, out, _recibo = self.wp.reembolsar_pedido_web("250")
        self.assertFalse(ok)
        self.assertIn("force", out.lower())


class TestWhatsappEndpointPedidoWeb(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "orders.db"
        import app.tools.web_pedidos as wp

        self.wp = wp
        wp.ORDERS_DB = self.db
        wp.migrate_orders_table()
        _insert_order(self.db, "MCKG-F09BC12250")

    def test_post_facturar_250(self) -> None:
        from flask import Flask

        from app.routes import register_routes

        captured: list[tuple[str, str | None]] = []

        def grab(msg: str, numero_destino: str | None = None) -> bool:
            captured.append((msg, numero_destino))
            return True

        with patch("app.observability.threading.Thread", SyncThread):
            with patch("app.routes.enviar_whatsapp_reporte", side_effect=grab):
                app = Flask(__name__)
                register_routes(app)
                client = app.test_client()
                r = client.post(
                    "/whatsapp",
                    json={
                        "sender": JID_WEB,
                        "remoteJid": JID_WEB,
                        "mensaje": "facturar 250",
                    },
                )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(
            any("MCKG-F09BC12250" in m for m, _ in captured if m),
            f"captured={captured}",
        )

    def test_post_entregado_250(self) -> None:
        from flask import Flask

        from app.routes import register_routes

        captured: list[tuple[str, str | None]] = []

        def grab(msg: str, numero_destino: str | None = None) -> bool:
            captured.append((msg, numero_destino))
            return True

        with patch("app.observability.threading.Thread", SyncThread):
            with patch("app.routes.enviar_whatsapp_reporte", side_effect=grab):
                with patch(
                    "app.tools.web_pedidos.emitir_factura_siigo_pedido_web",
                    return_value=(True, "Factura emitida para MCKG-F09BC12250"),
                ):
                    app = Flask(__name__)
                    register_routes(app)
                    client = app.test_client()
                    r = client.post(
                        "/whatsapp",
                        json={
                            "sender": JID_WEB,
                            "remoteJid": JID_WEB,
                            "mensaje": "entregado 250",
                        },
                    )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(
            any("MCKG-F09BC12250" in m for m, _ in captured if m),
            f"captured={captured}",
        )
        row = self.wp.get_order_by_reference("MCKG-F09BC12250")
        assert row is not None
        self.assertEqual(row["shipping_status"], "delivered")

    def test_post_envio_flex(self) -> None:
        from flask import Flask

        from app.routes import register_routes

        captured: list[str] = []

        def grab(msg: str, numero_destino: str | None = None) -> bool:
            captured.append(msg)
            return True

        with patch("app.observability.threading.Thread", SyncThread):
            with patch("app.routes.enviar_whatsapp_reporte", side_effect=grab):
                with patch.object(self.wp, "send_shipped_email", return_value=True):
                    app = Flask(__name__)
                    register_routes(app)
                    client = app.test_client()
                    r = client.post(
                        "/whatsapp",
                        json={
                            "sender": JID_WEB,
                            "remoteJid": JID_WEB,
                            "mensaje": "envio 250 flex",
                        },
                    )
        self.assertEqual(r.status_code, 200)
        joined = " ".join(captured)
        self.assertTrue("✅" in joined or "flex" in joined.lower(), captured)


if __name__ == "__main__":
    unittest.main()
