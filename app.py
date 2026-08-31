from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "static" / "uploads" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{BASE_DIR / 'factory.db'}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

db = SQLAlchemy(app)


class EquipmentType(db.Model):
    __tablename__ = "equipment_types"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(80), nullable=False, default="Станки")
    width = db.Column(db.Float, nullable=False, default=2.0)
    depth = db.Column(db.Float, nullable=False, default=1.2)
    height = db.Column(db.Float, nullable=False, default=1.8)
    color = db.Column(db.String(16), nullable=False, default="#4472c4")
    default_params_json = db.Column(db.Text, nullable=False, default="{}")
    model_url = db.Column(db.String(500), nullable=True)
    model_filename = db.Column(db.String(255), nullable=True)
    model_unit = db.Column(db.String(16), nullable=False, default="mm")

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "width": self.width,
            "depth": self.depth,
            "height": self.height,
            "color": self.color,
            "default_params": json.loads(self.default_params_json or "{}"),
            "model_url": self.model_url,
            "model_filename": self.model_filename,
            "model_unit": self.model_unit or "mm",
        }


class Layout(db.Model):
    __tablename__ = "layouts"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    data_json = db.Column(db.Text, nullable=False, default="{}")
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    def to_dict(self, include_data: bool = False) -> dict[str, Any]:
        result = {
            "id": self.id,
            "name": self.name,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_data:
            result["data"] = json.loads(self.data_json or "{}")
        return result


def ensure_equipment_schema() -> None:
    """Lightweight SQLite migration for installations created by the first version."""
    columns = {row[1] for row in db.session.execute(text("PRAGMA table_info(equipment_types)"))}
    migrations = {
        "model_url": "ALTER TABLE equipment_types ADD COLUMN model_url VARCHAR(500)",
        "model_filename": "ALTER TABLE equipment_types ADD COLUMN model_filename VARCHAR(255)",
        "model_unit": "ALTER TABLE equipment_types ADD COLUMN model_unit VARCHAR(16) NOT NULL DEFAULT 'mm'",
    }
    for column, sql in migrations.items():
        if column not in columns:
            db.session.execute(text(sql))
    db.session.commit()


def default_machine_passport() -> dict[str, Any]:
    return {
        "модель": "",
        "завод_изготовитель": "",
        "заводской_номер": "",
        "инвентарный_номер": "",
        "год_выпуска": "",
        "масса_кг": "",
        "мощность_кВт": "",
        "напряжение": "380 В",
        "максимальный_ток_А": "",
        "цех": "",
        "участок": "",
        "линия": "",
        "ответственный": "",
        "дата_установки": "",
        "последнее_ТО": "",
        "следующее_ТО": "",
        "состояние": "Работает",
    }


def seed_equipment() -> None:
    if EquipmentType.query.count() > 0:
        return

    common = default_machine_passport()
    items = [
        ("Токарный станок", "Металлообработка / Токарные", 2.4, 1.3, 1.6, "#3d7cc9"),
        ("Фрезерный станок", "Металлообработка / Фрезерные", 2.0, 1.8, 2.1, "#5b8f62"),
        ("Сверлильный станок", "Металлообработка / Сверлильные", 1.0, 1.0, 2.0, "#7c6cb0"),
        ("Шкаф управления", "Электрооборудование / Шкафы", 0.8, 0.5, 2.0, "#c28b3c"),
        ("Верстак", "Оснащение / Верстаки", 1.8, 0.8, 0.9, "#8a6f55"),
        ("Стеллаж", "Склад / Стеллажи", 2.0, 0.7, 2.5, "#76808f"),
    ]
    for name, category, width, depth, height, color in items:
        db.session.add(EquipmentType(
            name=name, category=category, width=width, depth=depth, height=height, color=color,
            default_params_json=json.dumps(common, ensure_ascii=False),
        ))
    db.session.commit()


def create_equipment(payload: dict[str, Any], *, model_url: str | None = None,
                     model_filename: str | None = None) -> EquipmentType:
    params = default_machine_passport()
    params.update(payload.get("default_params") or {})
    item = EquipmentType(
        name=str(payload.get("name", "Новое оборудование")).strip() or "Новое оборудование",
        category=str(payload.get("category", "Прочее")).strip() or "Прочее",
        width=max(0.001, float(payload.get("width", 1.0))),
        depth=max(0.001, float(payload.get("depth", 1.0))),
        height=max(0.001, float(payload.get("height", 1.0))),
        color=str(payload.get("color", "#4472c4")),
        default_params_json=json.dumps(params, ensure_ascii=False),
        model_url=model_url,
        model_filename=model_filename,
        model_unit=str(payload.get("model_unit", "mm")),
    )
    db.session.add(item)
    db.session.commit()
    return item


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/equipment-types")
def equipment_types_list():
    items = EquipmentType.query.order_by(EquipmentType.category, EquipmentType.name).all()
    return jsonify([item.to_dict() for item in items])


@app.post("/api/equipment-types")
def equipment_types_create():
    payload = request.get_json(force=True) or {}
    item = create_equipment(payload)
    return jsonify(item.to_dict()), 201


@app.post("/api/equipment-types/import-stl")
def equipment_types_import_stl():
    file = request.files.get("stl")
    if file is None or not file.filename:
        return jsonify({"error": "STL-файл не выбран"}), 400
    if Path(file.filename).suffix.lower() != ".stl":
        return jsonify({"error": "Разрешены только файлы .stl"}), 400

    original_name = secure_filename(file.filename) or "model.stl"
    stored_name = f"{uuid.uuid4().hex}_{original_name}"
    destination = MODEL_DIR / stored_name
    file.save(destination)

    payload = {
        "name": request.form.get("name") or Path(file.filename).stem,
        "category": request.form.get("category") or "Импорт STL",
        "width": request.form.get("width") or 1,
        "depth": request.form.get("depth") or 1,
        "height": request.form.get("height") or 1,
        "color": request.form.get("color") or "#4472c4",
        "model_unit": request.form.get("model_unit") or "mm",
    }
    try:
        item = create_equipment(
            payload,
            model_url=f"/static/uploads/models/{stored_name}",
            model_filename=file.filename,
        )
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return jsonify(item.to_dict()), 201


@app.get("/api/layouts")
def layouts_list():
    return jsonify([layout.to_dict() for layout in Layout.query.order_by(Layout.updated_at.desc()).all()])


@app.get("/api/layouts/<int:layout_id>")
def layouts_get(layout_id: int):
    layout = db.get_or_404(Layout, layout_id)
    return jsonify(layout.to_dict(include_data=True))


@app.post("/api/layouts")
def layouts_save():
    payload = request.get_json(force=True) or {}
    name = str(payload.get("name", "Основной цех")).strip() or "Основной цех"
    data = payload.get("data", {})

    layout = Layout.query.filter_by(name=name).first()
    if layout is None:
        layout = Layout(name=name)
        db.session.add(layout)

    layout.data_json = json.dumps(data, ensure_ascii=False)
    layout.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify(layout.to_dict(include_data=True))


@app.delete("/api/layouts/<int:layout_id>")
def layouts_delete(layout_id: int):
    layout = db.get_or_404(Layout, layout_id)
    db.session.delete(layout)
    db.session.commit()
    return jsonify({"ok": True})


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "3dstan"})


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "Файл слишком большой. Максимум 100 МБ."}), 413


with app.app_context():
    db.create_all()
    ensure_equipment_schema()
    seed_equipment()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
