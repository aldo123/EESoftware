#!/usr/bin/env python3
"""
Editor untuk tabel `internal_variables` pada internalvariable.db (SQLite).

Fitur:
  - Lihat semua data dalam tabel, urut & filter (pencarian, CP, tipe data)
  - Tambah / Edit / Hapus (bisa banyak baris sekaligus)
  - Validasi: number harus angka, boolean hanya true/false, nama unik
  - updated_at otomatis diperbarui saat data diubah
  - Backup otomatis (.bak) sebelum perubahan pertama pada setiap sesi
  - Hanya memakai library bawaan Python (tkinter + sqlite3), tanpa install apa pun

Cara pakai:
    python edit_internal_variables.py                     # pakai internalvariable.db di folder yang sama
    python edit_internal_variables.py path/ke/file.db     # atau tentukan path sendiri
"""

import os
import shutil
import sqlite3
import sys
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, messagebox, ttk

TABLE = "internal_variables"
DATA_TYPES = ["number", "string", "boolean", "system"]
DEFAULT_DB = "internalvariable.db"

# (id kolom, judul, lebar, rata)
COLUMNS = [
    ("id", "ID", 50, "e"),
    ("name", "Name", 200, "w"),
    ("cp_number", "CP", 50, "center"),
    ("data_type", "Type", 80, "center"),
    ("value", "Value", 180, "w"),
    ("system_key", "System Key", 220, "w"),
    ("updated_at", "Updated At", 140, "center"),
]


# --------------------------------------------------------------------------
# Lapisan database (terpisah dari GUI agar mudah diuji)
# --------------------------------------------------------------------------
class VariableDB:
    def __init__(self, path):
        self.path = path
        self._backed_up = False
        # timeout: tunggu jika database sedang dipakai aplikasi lain
        self.con = sqlite3.connect(path, timeout=10)
        self.con.row_factory = sqlite3.Row
        # Pastikan ini benar-benar database dengan tabel yang diharapkan
        found = self.con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (TABLE,)
        ).fetchone()
        if not found:
            self.con.close()
            raise ValueError(f"Tabel '{TABLE}' tidak ditemukan di file ini.")

    def close(self):
        self.con.close()

    def _backup_once(self):
        """Salin file .db ke .bak sebelum perubahan pertama pada sesi ini."""
        if self._backed_up:
            return
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        bak = f"{self.path}.{stamp}.bak"
        # Pakai API backup SQLite agar konsisten walau mode WAL aktif
        dest = sqlite3.connect(bak)
        with dest:
            self.con.backup(dest)
        dest.close()
        self._backed_up = True
        self.backup_path = bak

    def fetch_all(self):
        return self.con.execute(
            f"SELECT id, name, cp_number, data_type, value, system_key, updated_at "
            f"FROM {TABLE} ORDER BY id"
        ).fetchall()

    def get(self, row_id):
        return self.con.execute(f"SELECT * FROM {TABLE} WHERE id=?", (row_id,)).fetchone()

    def insert(self, name, cp_number, data_type, value, system_key=""):
        self._backup_once()
        with self.con:
            cur = self.con.execute(
                f"INSERT INTO {TABLE} (name, cp_number, data_type, value, system_key) "
                f"VALUES (?, ?, ?, ?, ?)",
                (name, cp_number, data_type, value, system_key),
            )
        return cur.lastrowid

    def update(self, row_id, name, cp_number, data_type, value, system_key=""):
        self._backup_once()
        with self.con:
            self.con.execute(
                f"UPDATE {TABLE} SET name=?, cp_number=?, data_type=?, value=?, "
                f"system_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                (name, cp_number, data_type, value, system_key, row_id),
            )

    def delete(self, row_ids):
        self._backup_once()
        with self.con:
            self.con.executemany(
                f"DELETE FROM {TABLE} WHERE id=?", [(i,) for i in row_ids]
            )


def validate(name, data_type, value):
    """Kembalikan (value_ternormalisasi, pesan_error). Error = None jika valid."""
    if not name.strip():
        return value, "Name tidak boleh kosong."
    if data_type == "number":
        try:
            float(value)
        except ValueError:
            return value, f"Value '{value}' bukan angka yang valid."
    elif data_type == "boolean":
        v = value.strip().lower()
        if v not in ("true", "false"):
            return value, "Value boolean harus 'true' atau 'false'."
        value = v
    return value, None


# --------------------------------------------------------------------------
# Dialog tambah / edit
# --------------------------------------------------------------------------
class EditDialog(tk.Toplevel):
    def __init__(self, parent, title, record=None):
        super().__init__(parent)
        self.title(title)
        self.transient(parent)
        self.resizable(False, False)
        self.result = None

        rec = dict(record) if record else {}
        self.var_name = tk.StringVar(value=rec.get("name", ""))
        self.var_cp = tk.StringVar(value=rec.get("cp_number", ""))
        self.var_type = tk.StringVar(value=rec.get("data_type", "string"))
        self.var_value = tk.StringVar(value=rec.get("value", ""))
        self.var_syskey = tk.StringVar(value=rec.get("system_key", ""))

        frm = ttk.Frame(self, padding=14)
        frm.grid(sticky="nsew")

        def row(r, label, widget):
            ttk.Label(frm, text=label).grid(row=r, column=0, sticky="w", pady=4, padx=(0, 10))
            widget.grid(row=r, column=1, sticky="ew", pady=4)

        self.e_name = ttk.Entry(frm, textvariable=self.var_name, width=38)
        self.e_cp = ttk.Entry(frm, textvariable=self.var_cp, width=38)
        self.c_type = ttk.Combobox(
            frm, textvariable=self.var_type, values=DATA_TYPES, state="readonly", width=35
        )
        self.value_holder = ttk.Frame(frm)  # isi berubah sesuai tipe data
        self.e_sys = ttk.Entry(frm, textvariable=self.var_syskey, width=38)

        row(0, "Name", self.e_name)
        row(1, "CP Number", self.e_cp)
        row(2, "Data Type", self.c_type)
        row(3, "Value", self.value_holder)
        row(4, "System Key", self.e_sys)

        if rec.get("system_key"):
            # system_key dipakai aplikasi lain sebagai penanda, jangan diubah sembarangan
            self.e_sys.state(["readonly"])

        self.msg = ttk.Label(frm, foreground="#b00020", wraplength=330)
        self.msg.grid(row=5, column=0, columnspan=2, sticky="w", pady=(6, 0))

        btns = ttk.Frame(frm)
        btns.grid(row=6, column=0, columnspan=2, sticky="e", pady=(10, 0))
        ttk.Button(btns, text="Simpan", command=self._save).pack(side="right")
        ttk.Button(btns, text="Batal", command=self.destroy).pack(side="right", padx=6)

        self.c_type.bind("<<ComboboxSelected>>", lambda e: self._build_value_widget())
        self._build_value_widget()

        self.bind("<Return>", lambda e: self._save())
        self.bind("<Escape>", lambda e: self.destroy())
        self.e_name.focus_set()
        self.grab_set()
        self.wait_visibility()
        self._center(parent)

    def _build_value_widget(self):
        for w in self.value_holder.winfo_children():
            w.destroy()
        if self.var_type.get() == "boolean":
            if self.var_value.get().strip().lower() not in ("true", "false"):
                self.var_value.set("false")
            else:
                self.var_value.set(self.var_value.get().strip().lower())
            w = ttk.Combobox(
                self.value_holder, textvariable=self.var_value,
                values=["true", "false"], state="readonly", width=35,
            )
        else:
            w = ttk.Entry(self.value_holder, textvariable=self.var_value, width=38)
        w.pack(fill="x")

    def _center(self, parent):
        self.update_idletasks()
        x = parent.winfo_rootx() + (parent.winfo_width() - self.winfo_width()) // 2
        y = parent.winfo_rooty() + (parent.winfo_height() - self.winfo_height()) // 3
        self.geometry(f"+{max(x, 0)}+{max(y, 0)}")

    def _save(self):
        name = self.var_name.get().strip()
        dtype = self.var_type.get()
        value, err = validate(name, dtype, self.var_value.get())
        if err:
            self.msg.config(text=err)
            return
        self.result = {
            "name": name,
            "cp_number": self.var_cp.get().strip(),
            "data_type": dtype,
            "value": value,
            "system_key": self.var_syskey.get(),
        }
        self.destroy()


# --------------------------------------------------------------------------
# Jendela utama
# --------------------------------------------------------------------------
class App(tk.Tk):
    def __init__(self, db_path):
        super().__init__()
        self.geometry("1000x600")
        self.minsize(760, 400)
        self.db = None
        self.sort_col = "id"
        self.sort_rev = False
        self.rows = []

        self._build_ui()
        self.open_db(db_path)

    # ---------- UI ----------
    def _build_ui(self):
        top = ttk.Frame(self, padding=(10, 10, 10, 4))
        top.pack(fill="x")

        ttk.Label(top, text="Cari:").pack(side="left")
        self.var_search = tk.StringVar()
        self.var_search.trace_add("write", lambda *a: self.refresh_view())
        ttk.Entry(top, textvariable=self.var_search, width=24).pack(side="left", padx=(4, 12))

        ttk.Label(top, text="CP:").pack(side="left")
        self.var_cp = tk.StringVar(value="Semua")
        self.cb_cp = ttk.Combobox(top, textvariable=self.var_cp, state="readonly", width=8, values=["Semua"])
        self.cb_cp.pack(side="left", padx=(4, 12))
        self.cb_cp.bind("<<ComboboxSelected>>", lambda e: self.refresh_view())

        ttk.Label(top, text="Type:").pack(side="left")
        self.var_type = tk.StringVar(value="Semua")
        cb_t = ttk.Combobox(top, textvariable=self.var_type, state="readonly", width=10,
                            values=["Semua"] + DATA_TYPES)
        cb_t.pack(side="left", padx=(4, 12))
        cb_t.bind("<<ComboboxSelected>>", lambda e: self.refresh_view())

        ttk.Button(top, text="Buka DB…", command=self.choose_db).pack(side="right")

        bar = ttk.Frame(self, padding=(10, 4))
        bar.pack(fill="x")
        ttk.Button(bar, text="＋ Tambah", command=self.add_row).pack(side="left")
        ttk.Button(bar, text="✎ Edit", command=self.edit_row).pack(side="left", padx=6)
        ttk.Button(bar, text="✕ Hapus", command=self.delete_rows).pack(side="left")
        ttk.Button(bar, text="⟳ Muat ulang", command=self.reload).pack(side="left", padx=6)

        body = ttk.Frame(self, padding=(10, 0, 10, 0))
        body.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(
            body, columns=[c[0] for c in COLUMNS], show="headings", selectmode="extended"
        )
        for cid, title, width, anchor in COLUMNS:
            self.tree.heading(cid, text=title, command=lambda c=cid: self.sort_by(c))
            self.tree.column(cid, width=width, anchor=anchor, stretch=(cid in ("name", "value", "system_key")))
        vsb = ttk.Scrollbar(body, orient="vertical", command=self.tree.yview)
        hsb = ttk.Scrollbar(body, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        body.rowconfigure(0, weight=1)
        body.columnconfigure(0, weight=1)

        self.tree.bind("<Double-1>", lambda e: self.edit_row())
        self.tree.bind("<Return>", lambda e: self.edit_row())
        self.tree.bind("<Delete>", lambda e: self.delete_rows())
        self.tree.bind("<F5>", lambda e: self.reload())
        self.tree.tag_configure("system", foreground="#8a5a00")
        self.tree.tag_configure("odd", background="#f6f8fa")

        self.status = tk.StringVar()
        ttk.Label(self, textvariable=self.status, anchor="w", padding=(10, 6)).pack(fill="x")

    # ---------- Database ----------
    def choose_db(self):
        path = filedialog.askopenfilename(
            title="Pilih file database",
            filetypes=[("SQLite database", "*.db *.sqlite *.sqlite3"), ("Semua file", "*.*")],
        )
        if path:
            self.open_db(path)

    def open_db(self, path):
        if not path or not os.path.isfile(path):
            messagebox.showerror("File tidak ditemukan", f"Tidak dapat menemukan:\n{path}\n\nPilih file database secara manual.")
            self.choose_db()
            return
        try:
            new_db = VariableDB(path)
        except (sqlite3.Error, ValueError) as e:
            messagebox.showerror("Gagal membuka database", str(e))
            return
        if self.db:
            self.db.close()
        self.db = new_db
        self.title(f"Internal Variables Editor — {os.path.basename(path)}")
        self.reload()

    def reload(self):
        try:
            self.rows = self.db.fetch_all()
        except sqlite3.Error as e:
            messagebox.showerror("Gagal membaca data", str(e))
            return
        cps = sorted({r["cp_number"] for r in self.rows})
        self.cb_cp.config(values=["Semua"] + cps)
        if self.var_cp.get() not in ["Semua"] + cps:
            self.var_cp.set("Semua")
        self.refresh_view()

    # ---------- Tampilan ----------
    def refresh_view(self):
        q = self.var_search.get().strip().lower()
        cp = self.var_cp.get()
        tp = self.var_type.get()

        def match(r):
            if cp != "Semua" and r["cp_number"] != cp:
                return False
            if tp != "Semua" and r["data_type"] != tp:
                return False
            if q and q not in " ".join(str(r[k]) for k in ("name", "value", "system_key", "cp_number")).lower():
                return False
            return True

        data = [r for r in self.rows if match(r)]

        def key(r):
            v = r[self.sort_col]
            return (0, v) if isinstance(v, int) else (1, str(v).lower())

        data.sort(key=key, reverse=self.sort_rev)

        selected = set(self.tree.selection())
        self.tree.delete(*self.tree.get_children())
        for i, r in enumerate(data):
            tags = []
            if r["data_type"] == "system":
                tags.append("system")
            if i % 2:
                tags.append("odd")
            self.tree.insert("", "end", iid=str(r["id"]), values=[r[c[0]] for c in COLUMNS], tags=tags)
        keep = [s for s in selected if self.tree.exists(s)]
        if keep:
            self.tree.selection_set(keep)
        self.status.set(f"{len(data)} dari {len(self.rows)} baris  |  {self.db.path}")

    def sort_by(self, col):
        self.sort_rev = (not self.sort_rev) if col == self.sort_col else False
        self.sort_col = col
        self.refresh_view()

    # ---------- Aksi ----------
    def _selected_ids(self):
        return [int(i) for i in self.tree.selection()]

    def add_row(self):
        dlg = EditDialog(self, "Tambah Variabel")
        self.wait_window(dlg)
        if not dlg.result:
            return
        try:
            new_id = self.db.insert(**dlg.result)
        except sqlite3.IntegrityError:
            messagebox.showerror("Nama sudah ada", f"Variabel '{dlg.result['name']}' sudah ada (nama tidak membedakan huruf besar/kecil).")
            return
        except sqlite3.Error as e:
            messagebox.showerror("Gagal menyimpan", str(e))
            return
        self.reload()
        self._focus_row(new_id)

    def edit_row(self):
        ids = self._selected_ids()
        if not ids:
            messagebox.showinfo("Edit", "Pilih satu baris terlebih dahulu.")
            return
        if len(ids) > 1:
            messagebox.showinfo("Edit", "Pilih hanya satu baris untuk diedit.")
            return
        rec = self.db.get(ids[0])
        if rec is None:
            messagebox.showwarning("Edit", "Baris ini sudah tidak ada di database. Data dimuat ulang.")
            self.reload()
            return
        dlg = EditDialog(self, f"Edit Variabel (ID {ids[0]})", rec)
        self.wait_window(dlg)
        if not dlg.result:
            return
        try:
            self.db.update(ids[0], **dlg.result)
        except sqlite3.IntegrityError:
            messagebox.showerror("Nama sudah ada", f"Variabel '{dlg.result['name']}' sudah dipakai baris lain.")
            return
        except sqlite3.Error as e:
            messagebox.showerror("Gagal menyimpan", str(e))
            return
        self.reload()
        self._focus_row(ids[0])

    def delete_rows(self):
        ids = self._selected_ids()
        if not ids:
            return
        names = [self.db.get(i)["name"] for i in ids if self.db.get(i)]
        preview = ", ".join(names[:5]) + (f", … (+{len(names) - 5})" if len(names) > 5 else "")
        has_system = any(self.db.get(i) and self.db.get(i)["data_type"] == "system" for i in ids)
        warn = "\n\nPERHATIAN: termasuk variabel bertipe 'system'." if has_system else ""
        if not messagebox.askyesno(
            "Hapus data", f"Hapus {len(ids)} baris?\n{preview}{warn}\n\nTindakan ini tidak dapat dibatalkan.",
            icon="warning",
        ):
            return
        try:
            self.db.delete(ids)
        except sqlite3.Error as e:
            messagebox.showerror("Gagal menghapus", str(e))
            return
        self.reload()

    def _focus_row(self, row_id):
        iid = str(row_id)
        if self.tree.exists(iid):
            self.tree.selection_set(iid)
            self.tree.focus(iid)
            self.tree.see(iid)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else None
    if path is None:
        # cari di folder script, lalu folder kerja
        here = os.path.dirname(os.path.abspath(__file__))
        for base in (here, os.getcwd()):
            cand = os.path.join(base, DEFAULT_DB)
            if os.path.isfile(cand):
                path = cand
                break
        else:
            path = os.path.join(here, DEFAULT_DB)
    App(path).mainloop()


if __name__ == "__main__":
    main()
