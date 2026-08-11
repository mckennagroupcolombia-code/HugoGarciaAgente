from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def _crear_tickets_db_vacia(path: Path) -> None:
    con = sqlite3.connect(path)
    con.execute(
        """
        CREATE TABLE tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT,
            titulo TEXT,
            descripcion TEXT
        )
        """
    )
    con.execute(
        """
        CREATE TABLE usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            activo INTEGER DEFAULT 1
        )
        """
    )
    con.execute("INSERT INTO usuarios (username, activo) VALUES ('admin', 1)")
    con.commit()
    con.close()


class TestCrearTicketNotaCredito(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / "tickets.db"
        _crear_tickets_db_vacia(self.db)

    def test_crea_ticket_nuevo(self) -> None:
        from app.tools import notas_credito as nc

        with patch("app.services.tickets_db.init_db", return_value=None), \
             patch("app.services.tickets_db.DB_PATH", str(self.db)), \
             patch(
                 "app.services.tickets_db.crear_ticket",
                 return_value=({"id": 42}, None),
             ) as mock_crear, \
             patch(
                 "app.services.tickets_db.get_aliados_asignaciones",
                 return_value={"meli_reclamo_anular_factura_siigo": {"usuario_id": 7}},
             ):
            ok, msg = nc.crear_ticket_nota_credito(
                canal="Web",
                referencia="MCKG-F09BC12250",
                motivo="Cliente se arrepintió",
                siigo_factura_numero="FE-100",
                siigo_factura_estado="Accepted",
                siigo_factura_url="https://siigonube.example/inv/1",
            )

        self.assertTrue(ok, msg)
        self.assertIn("Ticket #42", msg)
        mock_crear.assert_called_once()
        data, creador_id, _archivo = mock_crear.call_args.args
        self.assertEqual(data["categoria"], "contabilidad")
        self.assertEqual(data["prioridad"], "alta")
        self.assertEqual(data["asignado_a"], 7)
        self.assertIn("2250", data["titulo"])
        self.assertIn("MCKG-F09BC12250", data["descripcion"])
        self.assertIn("FE-100", data["descripcion"])

    def test_dedup_no_crea_dos_tickets(self) -> None:
        from app.tools import notas_credito as nc

        con = sqlite3.connect(self.db)
        con.execute(
            "INSERT INTO tickets (tipo, titulo, descripcion) VALUES ('accion', 'Anular factura / Nota crédito (Web) #2250', 'MCKG-F09BC12250')"
        )
        con.commit()
        con.close()

        with patch("app.services.tickets_db.init_db", return_value=None), \
             patch("app.services.tickets_db.DB_PATH", str(self.db)), \
             patch("app.services.tickets_db.crear_ticket") as mock_crear:
            ok, msg = nc.crear_ticket_nota_credito(
                canal="Web", referencia="MCKG-F09BC12250"
            )

        self.assertTrue(ok, msg)
        self.assertIn("Ya existe", msg)
        mock_crear.assert_not_called()

    def test_referencia_vacia_falla(self) -> None:
        from app.tools import notas_credito as nc

        ok, msg = nc.crear_ticket_nota_credito(canal="Web", referencia="")
        self.assertFalse(ok)
        self.assertIn("Falta la referencia", msg)


if __name__ == "__main__":
    unittest.main()
