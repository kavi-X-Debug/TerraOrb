"""The Anthropic Messages API as a Copilot provider (plain httpx, no SDK). Only built when MC_LLM_API_KEY is set (see provider.py)."""
import logging

import httpx

from . import grounding
from .provider import Provider, ProviderError

log = logging.getLogger("copilot")
URL = "https://api.anthropic.com/v1/messages"
VERSION = "2023-06-01"


class LlmProvider(Provider):
    name = "anthropic"
    enabled = True

    def __init__(self, api_key, model, client=None, url=URL, timeout=25.0):
        self._key = api_key                          # kept private; never returned or logged
        self.model = model
        self.url = url
        self._client = client or httpx.Client(timeout=timeout)

    def rephrase(self, message, lang, facts, mode="trip"):
        body = {
            "model": self.model,
            "max_tokens": 500,
            "system": grounding.system_prompt(lang, mode),
            "messages": [{"role": "user", "content": grounding.user_content(message, facts)}],
        }
        headers = {"x-api-key": self._key, "anthropic-version": VERSION, "content-type": "application/json"}
        try:
            r = self._client.post(self.url, json=body, headers=headers)
        except httpx.HTTPError as err:
            log.warning("copilot: request failed (%s)", type(err).__name__)       # the class only: never the text, it could echo the request
            raise ProviderError("the language model could not be reached") from err
        if r.status_code != 200:
            log.warning("copilot: model answered HTTP %s", r.status_code)
            raise ProviderError(f"the language model answered HTTP {r.status_code}")
        try:
            parts = r.json().get("content", [])
            text = "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
        except (ValueError, AttributeError) as err:
            raise ProviderError("the language model answer could not be read") from err
        if not text:
            raise ProviderError("the language model gave an empty answer")
        return text[: grounding.MAX_ANSWER_CHARS]
