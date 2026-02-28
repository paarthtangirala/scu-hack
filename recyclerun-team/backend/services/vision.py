"""
AI vision classification — AMD primary.
Owner: Soham
"""
import os, re, json
import requests

VISION_PROMPT = """You are a recycling material classifier for California.
Analyze this image and identify ALL visible recyclable materials.

Valid material keys (use ONLY these):
cardboard, aluminum_cans, plastic_pet, plastic_hdpe, glass_bottles,
copper_wire, scrap_aluminum, ewaste_noncrt, ewaste_crt, steel_iron,
newspaper, scrap_metal_mixed

Respond ONLY with valid JSON, no other text:
{
  "materials": [
    {"type": "material_key", "lbs": 5.0, "confidence": 0.85}
  ],
  "notes": "Brief description"
}"""

class VisionClassifier:
    def classify(self, base64_image: str) -> dict:
        result = self._try_amd(base64_image)
        if not result:
            # Keep demos sponsor-forward: only use non-AMD fallback if explicitly enabled.
            if os.environ.get("ENABLE_CLAUDE_FALLBACK", "").strip().lower() in {"1", "true", "yes"}:
                result = self._try_claude(base64_image)
        if not result:
            result = self._demo_result()
        return result

    def _try_amd(self, b64: str) -> dict | None:
        key = os.environ.get("AMD_API_KEY")
        if not key:
            return None
        model = os.environ.get("AMD_VISION_MODEL", "meta-llama/Llama-3.2-11B-Vision-Instruct")
        try:
            r = requests.post(
                "https://api.amd.developer.cloud/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                        {"type": "text", "text": VISION_PROMPT}
                    ]}],
                    "max_tokens": 600, "temperature": 0.1,
                },
                timeout=30
            )
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                return self._parse(content, source="amd")
        except Exception as e:
            print(f"AMD error: {e}")
        return None

    def _try_claude(self, b64: str) -> dict | None:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            return None
        try:
            r = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={
                    "model": "claude-opus-4-6",
                    "max_tokens": 600,
                    "messages": [{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                        {"type": "text", "text": VISION_PROMPT}
                    ]}]
                },
                timeout=30
            )
            if r.status_code == 200:
                content = r.json()["content"][0]["text"]
                return self._parse(content, source="claude")
        except Exception as e:
            print(f"Claude vision error: {e}")
        return None

    def _parse(self, content: str, source: str) -> dict | None:
        from backend.models.material import MATERIAL_RATES, Material
        try:
            m = re.search(r'\{.*\}', content, re.DOTALL)
            if not m:
                return None
            data = json.loads(m.group())
            materials = []
            for item in data.get("materials", []):
                if item["type"] in MATERIAL_RATES:
                    mat = Material(type=item["type"], lbs=round(item["lbs"], 1))
                    d = mat.to_dict()
                    d["confidence"] = item.get("confidence", 0.8)
                    materials.append(d)
            total_value = round(sum(m["value"] for m in materials), 2)
            total_lbs = round(sum(m["lbs"] for m in materials), 1)
            return {"success": True, "materials": materials, "total_value": total_value,
                    "total_lbs": total_lbs, "notes": data.get("notes", ""), "source": source}
        except:
            return None

    def _demo_result(self) -> dict:
        return {
            "success": True, "source": "demo",
            "materials": [
                {"type": "cardboard",     "label": "Cardboard (OCC)",        "emoji": "📦",
                 "lbs": 14.0, "rate": 0.04, "value": 0.56, "confidence": 0.91},
                {"type": "aluminum_cans", "label": "Aluminum Cans (CRV)",    "emoji": "🥫",
                 "lbs": 3.5,  "rate": 1.65, "value": 5.78, "confidence": 0.87},
                {"type": "plastic_pet",   "label": "Clear PET Plastic (CRV)","emoji": "🍶",
                 "lbs": 2.0,  "rate": 1.31, "value": 2.62, "confidence": 0.79},
            ],
            "total_value": 8.96, "total_lbs": 19.5,
            "notes": "Demo mode — add AMD_API_KEY for live detection",
        }
