"""
Twilio voice notification service.
Owner: Soham
"""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


class VoiceNotifier:
    SERVICE_NAME = "voice_notifier"
    DEFAULT_TIMEOUT_SECONDS = 20.0
    TIMEOUT_ENV = "VOICE_NOTIFY_TIMEOUT_SECONDS"
    FORCE_DEMO_ENV = "VOICE_FORCE_DEMO"

    DEMO_REASON_FORCED_MODE = "forced_demo_mode"
    DEMO_REASON_TWILIO_NOT_CONFIGURED = "twilio_not_configured"
    FAILED_REASON_TIMEOUT = "twilio_timeout"
    FAILED_REASON_EXCEPTION = "twilio_exception"
    FAILED_REASON_NOTIFY_EXCEPTION = "notify_exception"

    def notify(self, phone: str, household_name: str, eta_minutes: int, driver_name: str) -> dict:
        message = (
            f"Hello! This is RecycleRun. {driver_name} has accepted your recycling pickup "
            f"and will arrive in approximately {eta_minutes} minutes. "
            f"Please have your recyclables ready at the curb. "
            f"You're helping keep the Bay Area green — thank you!"
        )
        timeout_seconds = self._timeout_seconds()

        if self._force_demo_mode():
            result = {
                "success": True,
                "mode": "demo",
                "message": message,
                "reason": self.DEMO_REASON_FORCED_MODE,
            }
            self._log_event(
                level="info",
                event="voice_notify_demo",
                mode="demo",
                reason=self.DEMO_REASON_FORCED_MODE,
                phone=phone,
                timeout_seconds=timeout_seconds,
            )
            return result

        try:
            return self._make_call(phone=phone, message=message, timeout_seconds=timeout_seconds)
        except Exception as exc:  # defensive guard: notifier should never crash accept-route
            reason = self.FAILED_REASON_TIMEOUT if self._is_timeout_exception(exc) else self.FAILED_REASON_NOTIFY_EXCEPTION
            self._log_event(
                level="error",
                event="voice_notify_failed",
                mode="failed",
                reason=reason,
                phone=phone,
                timeout_seconds=timeout_seconds,
                exception_type=exc.__class__.__name__,
                error=str(exc),
            )
            return {"success": False, "mode": "failed", "error": str(exc), "reason": reason}

    def _make_call(self, phone: str, message: str, timeout_seconds: float | None = None) -> dict:
        sid = os.environ.get("TWILIO_ACCOUNT_SID")
        token = os.environ.get("TWILIO_AUTH_TOKEN")
        from_ = os.environ.get("TWILIO_PHONE_NUMBER")
        timeout = timeout_seconds if timeout_seconds is not None else self._timeout_seconds()

        if not (sid and token and from_):
            result = {
                "success": True,
                "mode": "demo",
                "message": message,
                "reason": self.DEMO_REASON_TWILIO_NOT_CONFIGURED,
            }
            self._log_event(
                level="info",
                event="voice_notify_demo",
                mode="demo",
                reason=self.DEMO_REASON_TWILIO_NOT_CONFIGURED,
                phone=phone,
                timeout_seconds=timeout,
            )
            return result

        try:
            from twilio.http.http_client import TwilioHttpClient
            from twilio.rest import Client

            http_client = TwilioHttpClient(timeout=timeout)
            client = Client(sid, token, http_client=http_client)
            call = client.calls.create(
                twiml=f'<Response><Say voice="Polly.Joanna">{message}</Say></Response>',
                to=phone,
                from_=from_,
            )
            result = {"success": True, "mode": "live", "call_sid": str(call.sid)}
            self._log_event(
                level="info",
                event="voice_notify_live",
                mode="live",
                reason="twilio_call_created",
                phone=phone,
                timeout_seconds=timeout,
            )
            return result
        except Exception as exc:
            reason = self.FAILED_REASON_TIMEOUT if self._is_timeout_exception(exc) else self.FAILED_REASON_EXCEPTION
            self._log_event(
                level="error",
                event="voice_notify_failed",
                mode="failed",
                reason=reason,
                phone=phone,
                timeout_seconds=timeout,
                exception_type=exc.__class__.__name__,
                error=str(exc),
            )
            return {"success": False, "mode": "failed", "error": str(exc), "reason": reason}

    @classmethod
    def _force_demo_mode(cls) -> bool:
        raw = os.environ.get(cls.FORCE_DEMO_ENV, "")
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    @classmethod
    def _timeout_seconds(cls) -> float:
        raw = os.environ.get(cls.TIMEOUT_ENV, str(cls.DEFAULT_TIMEOUT_SECONDS)).strip()
        try:
            value = float(raw)
            if value <= 0:
                raise ValueError("timeout must be > 0")
            return value
        except Exception:
            logger.warning(
                "voice_notify_config_invalid %s",
                {
                    "event": "voice_notify_config_invalid",
                    "service": cls.SERVICE_NAME,
                    "source": cls.SERVICE_NAME,
                    "reason": "invalid_timeout_config",
                    "raw_timeout_value": raw,
                    "timeout_seconds": cls.DEFAULT_TIMEOUT_SECONDS,
                },
            )
            return cls.DEFAULT_TIMEOUT_SECONDS

    @staticmethod
    def _is_timeout_exception(exc: Exception) -> bool:
        name = exc.__class__.__name__.lower()
        message = str(exc).lower()
        return "timeout" in name or "timed out" in message or "timeout" in message

    @staticmethod
    def _redact_phone(phone: str) -> str:
        digits = "".join(ch for ch in str(phone) if ch.isdigit())
        if not digits:
            return "unknown"
        return f"***{digits[-4:]}"

    def _log_event(self, *, level: str, event: str, mode: str, reason: str, phone: str, timeout_seconds: float, **extra: Any) -> None:
        payload = {
            "event": event,
            "mode": mode,
            "reason": reason,
            "service": self.SERVICE_NAME,
            "source": self.SERVICE_NAME,
            "timeout_seconds": timeout_seconds,
            "phone": self._redact_phone(phone),
        }
        payload.update(extra)
        log_method = getattr(logger, level, logger.info)
        log_method("voice_notify %s", payload)
