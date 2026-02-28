"""
ElevenLabs + Twilio voice notification service.
Owner: Soham
"""
import os
import requests

class VoiceNotifier:
    VOICE_ID = "21m00Tcm4TlvDq8ikWAM"  # Rachel — warm, clear

    def notify(self, phone: str, household_name: str, eta_minutes: int, driver_name: str) -> dict:
        message = (
            f"Hello! This is RecycleRun. {driver_name} has accepted your recycling pickup "
            f"and will arrive in approximately {eta_minutes} minutes. "
            f"Please have your recyclables ready at the curb. "
            f"You're helping keep the Bay Area green — thank you!"
        )
        audio = self._generate_audio(message)
        if audio:
            return self._make_call(phone, message, audio)
        print(f"[DEMO CALL] → {phone}: {message}")
        return {"success": True, "mode": "demo", "message": message}

    def _generate_audio(self, text: str) -> bytes | None:
        key = os.environ.get("ELEVENLABS_API_KEY")
        if not key:
            return None
        try:
            r = requests.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{self.VOICE_ID}",
                headers={"xi-api-key": key, "Content-Type": "application/json"},
                json={"text": text, "model_id": "eleven_turbo_v2",
                      "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
                timeout=20
            )
            if r.status_code == 200:
                return r.content
        except Exception as e:
            print(f"ElevenLabs error: {e}")
        return None

    def _make_call(self, phone: str, message: str, audio: bytes) -> dict:
        sid   = os.environ.get("TWILIO_ACCOUNT_SID")
        token = os.environ.get("TWILIO_AUTH_TOKEN")
        from_ = os.environ.get("TWILIO_PHONE_NUMBER")
        if not (sid and token and from_):
            return {"success": True, "mode": "demo"}
        try:
            from twilio.rest import Client
            client = Client(sid, token)
            call = client.calls.create(
                twiml=f'<Response><Say voice="Polly.Joanna">{message}</Say></Response>',
                to=phone, from_=from_
            )
            return {"success": True, "mode": "live", "call_sid": call.sid}
        except Exception as e:
            print(f"Twilio error: {e}")
            return {"success": False, "mode": "failed", "error": str(e)}
