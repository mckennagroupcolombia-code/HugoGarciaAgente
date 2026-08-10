"""
Tests automatizados: comandos WhatsApp pedidos web (facturar/envío por sufijo, flex).
Ejecutar: python -m unittest tests.test_web_pedidos_comandos -v
"""
from __future__ import annotations

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
