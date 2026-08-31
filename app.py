from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy

BASE_DIR = Path(__file__).resolve().parent

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{BASE_DIR / 'factory.db'}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

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


def seed_equipment() -> None:
    if EquipmentType.query.count() > 0:
        return

    items = [
        {
            "name": "Токарный станок",
            "category": "Металлообработка",
            "width": 2.4,
            "depth": 1.3,
            "height": 1.6,
            "color": "#3d7cc9",
            "default_params": {"модель": "", "инвентарный_номер": "", "мощность_кВт": "", "ответственный": ""},
        },
        {
            "name": "Фрезерный станок",
            "category": "Металлообработка",
            "width": 2.0,
            "depth": 1.8,
            "height": 2.1,
            "color": "#5b8f62",
            "default_params": {"модель": "", "инвентарный_номер": "", "мощность_кВт": "", "зона_безопасности_м": 1},
        },
        {
            "name": "Сверлильный станок",
            "category": "Металлообработка",
            "width": 1.0,
            "depth": 1.0,
            "height": 2.0,
            "color": "#7c6cb0",
            "default_params": {"модель": "", "инвентарный_номер": "", "мощность_кВт": ""},
        },
        {
            "name": "Шкаф управления",
            "category": "Электрика",
            "width": 0.8,
            "depth": 0.5,
            "height": 2.0,
            "color": "#c28b3c",
            "default_params": {"обозначение": "", "напряжение": "380 В", "линия": ""},
        },
        {
            "name": "Верстак",
            "category": "Оснащение",
            "width": 1.8,
            "depth": 0.8,
            "height": 0.9,
            "color": "#8a6f55",
            "default_params": {"инвентарный_номер": "", "назначение": ""},
        },
        {
            "name": "Стеллаж",
            "category": "Склад",
            "width": 2.0,
            "depth": 0.7,
            "height": 2.5,
            "color": "#76808f",
            "default_params": {"ячейки": "", "грузоподъемность_кг": "", "зона": ""},
        },
    ]

    for item in items:
        db.session.add(
            EquipmentType(
                name=item["name"],
                category=item["category"],
                width=item["width"],
                depth=item["depth"],
                height=item["height"],
                color=item["color"],
                default_params_json=json.dumps(item["default_params"], ensure_ascii=False),
            )
        )
    db.session.commit()


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
    item = EquipmentType(
        name=str(payload.get("name", "Новое оборудование")).strip() or "Новое оборудование",
        category=str(payload.get("category", "Прочее")).strip() or "Прочее",
        width=float(payload.get("width", 1.0)),
        depth=float(payload.get("depth", 1.0)),
        height=float(payload.get("height", 1.0)),
        color=str(payload.get("color", "#4472c4")),
        default_params_json=json.dumps(payload.get("default_params", {}), ensure_ascii=False),
    )
    db.session.add(item)
    db.session.commit()
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


with app.app_context():
    db.create_all()
    seed_equipment()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
