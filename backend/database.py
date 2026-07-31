import mysql.connector
import json
import os

class DatabaseManager:
    def __init__(self, json_file="interlock.json", section="Traceability Server"):
        self.json_file = json_file
        self.section = section
        self.host = ""
        self.database = ""
        self.user = ""
        self.password = ""
        self.ssl_mode = "REQUIRED"
        self.conn = None
        self.load_config()

    def load_config(self):
        try:
            base_dir = os.path.dirname(__file__)
            json_path = (
                self.json_file
                if os.path.isabs(self.json_file)
                else os.path.join(base_dir, self.json_file)
            )
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            db = data.get(self.section, {})
            self.host = db.get("Database Server", "127.0.0.1")
            self.database = db.get("TraceabilityCatalog", "")
            self.user = db.get("TraceabilityUserId", "root")
            self.password = db.get("TraceabilityPassword", "")
            self.ssl_mode = db.get("TraceabilitySslMode", "REQUIRED")
            print(f"DB Config: {self.host} | {self.database} | {self.user}")
        except Exception as e:
            print("DB Config Error:", e)

    def connect(self):
        self.load_config()
        try:
            if self.conn:
                try:
                    self.conn.ping(reconnect=True, attempts=1, delay=0)
                    print("Already Connected")
                    return True
                except Exception as e:
                    print("PING ERROR:", e)
                    self.conn = None

            self.conn = mysql.connector.connect(
                host=self.host,
                user=self.user,
                password=self.password,
                database=self.database,
                connection_timeout=5
            )

            # 🟢 PERBAIKAN AGAR REALTIME TANPA RESTART: Ubah level isolasi transaksi
            cursor = self.conn.cursor()
            cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
            cursor.close()

            print("MYSQL CONNECT SUCCESS")
            return True

        except mysql.connector.Error as err:
            print("MYSQL ERROR")
            print("Errno :", err.errno)
            print("SQLSTATE :", err.sqlstate)
            print("Message :", err.msg)
            self.conn = None
            return False

        except Exception as e:
            print("OTHER ERROR :", repr(e))
            self.conn = None
            return False

    def reload(self):
        self.disconnect()
        self.load_config()
        return self.connect()

    def disconnect(self):
        try:
            if self.conn and self.conn.is_connected():
                self.conn.close()
                print("DB Disconnected")
        except:
            pass
        self.conn = None

    def is_connected(self):
        if self.conn:
            try:
                print("MYSQL STATUS =", self.conn.is_connected())
                return self.conn.is_connected()
            except Exception as e:
                print("IS_CONNECTED ERROR:", e)
                return False
        return False

    def execute(self, sql, params=None):
        try:
            if not self.is_connected():
                self.connect()
            cursor = self.conn.cursor()
            cursor.execute(sql, params or ())
            self.conn.commit()
            affected = cursor.rowcount
            cursor.close()
            return affected
        except Exception as e:
            print("Execute Error:", e)
            return 0

    def fetch_one(self, sql, params=None):
        try:
            if not self.is_connected():
                self.connect()
            cursor = self.conn.cursor(dictionary=True)
            cursor.execute(sql, params or ())
            result = cursor.fetchone()
            cursor.close()
            return result
        except Exception as e:
            print("Fetch One Error:", e)
            return None

    def fetch_all(self, sql, params=None):
        try:
            if not self.is_connected():
                self.connect()
            cursor = self.conn.cursor(dictionary=True)
            cursor.execute(sql, params or ())
            result = cursor.fetchall()
            cursor.close()
            return result
        except Exception as e:
            print("Fetch All Error:", e)
            return []

    def scalar(self, sql, params=None):
        try:
            if not self.is_connected():
                self.connect()
            cursor = self.conn.cursor()
            cursor.execute(sql, params or ())
            result = cursor.fetchone()
            cursor.close()
            return result[0] if result else None
        except Exception as e:
            print("Scalar Error:", e)
            return None

    def get_database_name(self):
        return self.database

    def get_host(self):
        return self.host

    def test_connection(self):
        try:
            temp = mysql.connector.connect(
                host=self.host, user=self.user,
                password=self.password, database=self.database,
                connection_timeout=5
            )
            temp.close()
            return True
        except Exception:
            return False