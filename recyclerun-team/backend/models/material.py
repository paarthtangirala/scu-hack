"""
Material definitions and payout rates.
Owner: Paarth
"""
from dataclasses import dataclass

MATERIAL_RATES: dict = {
    "cardboard":         {"rate": 0.04,  "label": "Cardboard (OCC)",          "emoji": "📦",  "source": "CalRecycle"},
    "aluminum_cans":     {"rate": 1.65,  "label": "Aluminum Cans (CRV)",      "emoji": "🥫",  "source": "CalRecycle CRV"},
    "plastic_pet":       {"rate": 1.31,  "label": "Clear PET Plastic (CRV)",  "emoji": "🍶",  "source": "CalRecycle CRV"},
    "plastic_hdpe":      {"rate": 0.58,  "label": "HDPE Plastic (CRV)",       "emoji": "🧴",  "source": "CalRecycle CRV"},
    "glass_bottles":     {"rate": 0.10,  "label": "Glass Bottles (CRV)",      "emoji": "🍾",  "source": "CalRecycle CRV"},
    "copper_wire":       {"rate": 3.85,  "label": "Copper Wire",              "emoji": "🔌",  "source": "ScrapMonster CA"},
    "scrap_aluminum":    {"rate": 0.77,  "label": "Scrap Aluminum",           "emoji": "🔩",  "source": "ScrapMonster CA"},
    "ewaste_noncrt":     {"rate": 1.16,  "label": "E-Waste (Non-CRT)",        "emoji": "💻",  "source": "CalRecycle e-Scrap"},
    "ewaste_crt":        {"rate": 1.19,  "label": "E-Waste (CRT TV/Monitor)", "emoji": "📺",  "source": "CalRecycle e-Scrap"},
    "steel_iron":        {"rate": 0.08,  "label": "Steel / Iron",             "emoji": "⚙️",  "source": "Scrap yard avg"},
    "newspaper":         {"rate": 0.03,  "label": "Newspaper / Mixed Paper",  "emoji": "📰",  "source": "Scrap yard avg"},
    "scrap_metal_mixed": {"rate": 0.30,  "label": "Mixed Scrap Metal",        "emoji": "🔧",  "source": "Scrap yard avg"},
}

@dataclass
class Material:
    type: str
    lbs: float
    value: float = 0.0

    def __post_init__(self):
        if self.value == 0.0 and self.type in MATERIAL_RATES:
            self.value = round(self.lbs * MATERIAL_RATES[self.type]["rate"], 2)

    def to_dict(self):
        info = MATERIAL_RATES.get(self.type, {})
        return {
            "type": self.type,
            "label": info.get("label", self.type),
            "emoji": info.get("emoji", "♻️"),
            "lbs": self.lbs,
            "rate": info.get("rate", 0),
            "value": self.value,
        }
