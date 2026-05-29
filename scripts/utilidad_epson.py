import tkinter as tk
from tkinter import messagebox, ttk
import subprocess
import datetime
import os
# --- CONFIGURACIÓN MAESTRA ---
PRINTER_NAME = "CW-C4000u"
ELPU_PATH = "/opt/epson/epson-label-printer-utility/elpu"

PDF_DIR = os.path.expanduser("~/Documentos")

ETIQUETAS = {
    "30 mL": (102, 38), "5 mL": (66, 22), "125 g": (70, 70),
    "250 g": (76, 66), "1 Lt": (108, 76), "10 g": (58, 54),
    "100 g": (69, 51), "Lactato": (140, 38), "Circular": (55,55), "Circular 70": (70,70), 
    "5 g": (50,42)
}

MAPEO_FORMA = {
    "Etiqueta troquelada (separación)": "Diecut_Gap",
    "Etiqueta Troquelada (marca negra)": "Diecut_Blackmark",
    "Etiqueta continua (sin detección)": "Contlabel_no_detection"
}

MAPEO_ROTACION = {
    "Normal (0°)": "3",
    "Girar 90° (Derecha)": "4",
    "Girar 180° (Invertido)": "6",
    "Girar 270° (Izquierda)": "5"
}

# --- NUEVO MAPEO DE CALIDAD ---
MAPEO_CALIDAD = {
    "Máxima Velocidad (Borrador)": "MaxSpeed",
    "Rápida": "Speed",
    "Normal": "Normal",
    "Alta Calidad": "Quality",
    "Máxima Calidad (Fotos/Logos)": "MaxQuality"
}

class AppEpsonProV8:
    def __init__(self, root):
        self.root = root
        self.root.title("MCKG Suite v8.0 - La Patrona")
        self.root.geometry("540x900")
        self.archivo_pdf = ""
        self.crear_interfaz()

    def log(self, mensaje):
        hora = datetime.datetime.now().strftime("%H:%M:%S")
        self.txt_log.config(state='normal')
        self.txt_log.insert(tk.END, f"[{hora}] {mensaje}\n")
        self.txt_log.see(tk.END)
        self.txt_log.config(state='disabled')

    def imprimir(self):
        if not self.archivo_pdf:
            messagebox.showwarning("Falta PDF", "Veci, no ha seleccionado el archivo.")
            return

        try:
            prod = self.combo_productos.get()
            ancho, alto = ETIQUETAS[prod]
            cantidad = self.ent_cant.get()
            forma = MAPEO_FORMA[self.combo_forma.get()]
            rotacion = MAPEO_ROTACION[self.combo_rotar.get()]
            calidad = MAPEO_CALIDAD[self.combo_calidad.get()]

            if not cantidad.isdigit() or int(cantidad) < 1:
                messagebox.showerror("Error", "La cantidad debe ser un número entero.")
                return

            m_top = float(self.ent_v.get()) * 2.83465
            m_left = float(self.ent_h.get()) * 2.83465

            # 1. Ajuste físico (Hardware)
            subprocess.run(f"sudo {ELPU_PATH} -p {PRINTER_NAME} -o printPositionV={self.ent_v.get()}", shell=True)

            # 2. Comando de Impresión con Calidad
            cmd_print = (
                f"lp -d {PRINTER_NAME} "
                f"-n {cantidad} "
                f"-o PageSize=Custom.{ancho}x{alto}mm "
                f"-o MediaForm={forma} "
                f"-o PrintQuality={calidad} "  # <-- CALIDAD APLICADA AQUÍ
                f"-o page-top={m_top} "
                f"-o page-left={m_left} "
                f"-o orientation-requested={rotacion} "
                f"-o fit-to-page "
                f"'{self.archivo_pdf}'"
            )

            self.log(f"Imprimiendo {cantidad} copias en calidad '{self.combo_calidad.get()}'...")
            subprocess.run(cmd_print, shell=True, check=True)
            self.log("¡Listo! Impresión en camino.")

        except Exception as e:
            self.log(f"ERROR: {e}")

    def crear_interfaz(self):
        tk.Label(self.root, text="SISTEMA DE ETIQUETADO MCKG", bg="#2c3e50", fg="white", font=("Arial", 14, "bold"), pady=15).pack(fill='x')

        # 1. PRODUCTO
        f1 = tk.LabelFrame(self.root, text=" 1. Configuración de Etiqueta ", padx=15, pady=10)
        f1.pack(padx=20, pady=10, fill='x')

        tk.Label(f1, text="Producto:").pack(anchor='w')
        self.combo_productos = ttk.Combobox(f1, values=list(ETIQUETAS.keys()), state="readonly", font=("Arial", 11))
        self.combo_productos.set("30 mL"); self.combo_productos.pack(fill='x', pady=5)

        tk.Label(f1, text="Sensor de Papel:").pack(anchor='w')
        self.combo_forma = ttk.Combobox(f1, values=list(MAPEO_FORMA.keys()), state="readonly")
        self.combo_forma.set("Etiqueta troquelada (separación)"); self.combo_forma.pack(fill='x', pady=5)

        # 2. CALIDAD, CENTRADO Y ROTACIÓN
        f2 = tk.LabelFrame(self.root, text=" 2. Calidad y Posición ", padx=15, pady=10)
        f2.pack(padx=20, pady=10, fill='x')

        tk.Label(f2, text="Calidad de Impresión:", font=("Arial", 10, "bold")).pack(anchor='w')
        self.combo_calidad = ttk.Combobox(f2, values=list(MAPEO_CALIDAD.keys()), state="readonly")
        self.combo_calidad.set("Normal"); self.combo_calidad.pack(fill='x', pady=5)

        tk.Label(f2, text="Rotación:").pack(anchor='w', pady=(10, 0))
        self.combo_rotar = ttk.Combobox(f2, values=list(MAPEO_ROTACION.keys()), state="readonly")
        self.combo_rotar.set("Normal (0°)"); self.combo_rotar.pack(fill='x', pady=5)

        f_pos = tk.Frame(f2)
        f_pos.pack(fill='x', pady=10)
        tk.Label(f_pos, text="V (mm):").pack(side='left')
        self.ent_v = tk.Entry(f_pos, width=7, justify='center'); self.ent_v.insert(0, "0.0"); self.ent_v.pack(side='left', padx=5)
        tk.Label(f_pos, text="H (mm):").pack(side='left', padx=5)
        self.ent_h = tk.Entry(f_pos, width=7, justify='center'); self.ent_h.insert(0, "0.0"); self.ent_h.pack(side='left')

        # 3. CANTIDAD Y ACCIÓN
        f3 = tk.LabelFrame(self.root, text=" 3. Cantidad y Ejecución ", padx=15, pady=10)
        f3.pack(padx=20, pady=10, fill='x')

        f_cant = tk.Frame(f3)
        f_cant.pack(pady=5)
        tk.Label(f_cant, text="CANTIDAD:", font=("Arial", 10, "bold")).pack(side='left')
        self.ent_cant = tk.Entry(f_cant, width=10, font=("Arial", 12, "bold"), justify='center', bg="#fff9c4")
        self.ent_cant.insert(0, "1"); self.ent_cant.pack(side='left', padx=10)

        tk.Button(f3, text="📁 SELECCIONAR PDF", command=self.seleccionar_pdf, bg="#ecf0f1", height=2).pack(fill='x', pady=10)
        self.lbl_pdf = tk.Label(f3, text="Sin archivo", fg="gray", font=("Arial", 8))
        self.lbl_pdf.pack()

        tk.Button(f3, text="🚀 ¡IMPRIMIR AHORA!", bg="#27ae60", fg="white", font=("Arial", 16, "bold"), command=self.imprimir, height=2).pack(fill='x', pady=15)

        self.txt_log = tk.Text(self.root, height=6, state='disabled', bg="#f8f9f9", font=("Courier", 9))
        self.txt_log.pack(padx=20, pady=5, fill='x')

    def seleccionar_pdf(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("Buscar PDF — Documentos MCKG")
        dlg.geometry("640x500")
        dlg.transient(self.root)
        dlg.grab_set()

        carpeta = PDF_DIR
        if not os.path.isdir(carpeta):
            messagebox.showerror("Error", f"No existe la carpeta:\n{carpeta}", parent=dlg)
            dlg.destroy()
            return

        tk.Label(
            dlg, text=f"📂 {carpeta}", font=("Arial", 9), fg="#555", anchor="w"
        ).pack(fill="x", padx=14, pady=(12, 0))

        f_bus = tk.Frame(dlg)
        f_bus.pack(fill="x", padx=14, pady=10)
        tk.Label(f_bus, text="🔍 Buscar:", font=("Arial", 10, "bold")).pack(side="left")
        ent_bus = tk.Entry(f_bus, font=("Arial", 11))
        ent_bus.pack(side="left", fill="x", expand=True, padx=(8, 0))

        f_list = tk.Frame(dlg)
        f_list.pack(fill="both", expand=True, padx=14, pady=4)
        scroll = tk.Scrollbar(f_list)
        scroll.pack(side="right", fill="y")
        lst = tk.Listbox(f_list, font=("Arial", 10), yscrollcommand=scroll.set, activestyle="dotbox")
        lst.pack(side="left", fill="both", expand=True)
        scroll.config(command=lst.yview)

        todos = []
        for dir_actual, _, archivos in os.walk(carpeta):
            for nombre in archivos:
                if nombre.lower().endswith(".pdf"):
                    todos.append(os.path.join(dir_actual, nombre))
        todos.sort(key=lambda p: os.path.basename(p).lower())

        filtrados = []

        def actualizar_lista(_event=None):
            nonlocal filtrados
            q = ent_bus.get().strip().lower()
            filtrados = [
                p for p in todos
                if not q or q in os.path.basename(p).lower()
            ]
            lst.delete(0, tk.END)
            for p in filtrados:
                rel = os.path.relpath(p, carpeta)
                lst.insert(tk.END, rel if os.path.dirname(rel) else os.path.basename(p))
            if filtrados:
                lst.selection_set(0)
                lst.see(0)

        def elegir(_event=None):
            sel = lst.curselection()
            if not sel:
                messagebox.showwarning("Sin selección", "Elija un PDF de la lista.", parent=dlg)
                return
            ruta = filtrados[sel[0]]
            self.archivo_pdf = ruta
            self.lbl_pdf.config(text=os.path.basename(ruta), fg="#2980b9")
            dlg.destroy()

        ent_bus.bind("<KeyRelease>", actualizar_lista)
        lst.bind("<Double-Button-1>", elegir)
        lst.bind("<Return>", elegir)

        f_btn = tk.Frame(dlg)
        f_btn.pack(fill="x", padx=14, pady=12)
        tk.Button(f_btn, text="Cancelar", command=dlg.destroy, width=12).pack(side="right", padx=4)
        tk.Button(
            f_btn, text="Abrir", command=elegir, bg="#2980b9", fg="white", width=12, font=("Arial", 10, "bold")
        ).pack(side="right")

        actualizar_lista()
        ent_bus.focus_set()
        dlg.wait_window()

if __name__ == "__main__":
    root = tk.Tk()
    app = AppEpsonProV8(root)
    root.mainloop()
