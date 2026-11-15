"""Google Gemini as a language-model provider (plain httpx, no SDK). Only built when MC_LLM_API_KEY is set and the provider is gemini (see provider.py).

Same job as llm.py: it only REWORDS or answers from the FACTS the website gives it; grounding.py holds the rules and the number check.
The key is sent in the `x-goog-api-key` header (never in the URL, so it cannot end up in a log) and is never logged or returned.
"""
import logging

import httpx

from . import grounding
from .provider import Provider, ProviderError

log = logging.getLogger("copilot")
BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiProvider(Provider):
    name = "gemini"
    enabled = True

    def __init__(self, api_key, model, client=None, base=BASE, timeout=25.0):
        self._key = api_key                          # kept private; never returned or logged
        self.model = model
        self.base = base
        self._client = client or httpx.Client(timeout=timeout)

    def rephrase(self, message, lang, facts, mode="trip"):
        body = {
            "system_instruction": {"parts": [{"text": grounding.system_prompt(lang, mode)}]},
            "contents": [{"role": "user", "parts": [{"text": grounding.user_content(message, facts)}]}],
            # thinking is switched off: the answer is a short rewording and must come back fast and cheap
            "generationConfig": {"maxOutputTokens": 600, "temperature": 0.2, "thinkingConfig": {"thinkingBudget": 0}},
        }
        headers = {"x-goog-api-key": self._key, "content-type": "application/json"}
        try:
            r = self._client.post(f"{self.base}/{self.model}:generateContent", json=body, headers=headers)
        except httpx.HTTPError as err:
            log.warning("copilot: request failed (%s)", type(err).__name__)       # the class only: never the text, it could echo the request
            raise ProviderError("the language model could not be reached") from err
        if r.status_code != 200:
            log.warning("copilot: model answered HTTP %s", r.status_code)
            raise ProviderError(f"the language model answered HTTP {r.status_code}")
        try:
            parts = r.json()["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts).strip()
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as err:
            raise ProviderError("the language model answer could not be read") from err
        if not text:
            raise ProviderError("the language model gave an empty answer")
        return text[: grounding.MAX_ANSWER_CHARS]
