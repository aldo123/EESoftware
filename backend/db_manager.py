import os
from database import DatabaseManager

BASE_DIR = os.path.dirname(__file__)

db = DatabaseManager(
    json_file=os.path.join(BASE_DIR, "data", "interlock.json")
)

db.connect()