"""
Provider interface for the Copilot's optional "reword this answer" step.

The browser already builds a grounded answer from real data (forecast, NASA POWER tendency...). A provider may only turn the
list of facts into friendlier wording. Providers:

  DisabledProvider   used when there is no key: enabled = False, rephrase() raises ProviderDisabled (the route answers 503)
  LlmProvider        (llm.py) the Anthropic Messages API, switched on only by the environment variable MC_LLM_API_KEY

Settings come ONLY from the server's environment, never from the website:
  MC_LLM_API_KEY    secret key (never logged, never returned)
  MC_LLM_PROVIDER   anthropic or gemini; if not set it is guessed from the key (Google keys start with AIza or AQ.)
  MC_LLM_MODEL      model id; default claude-sonnet-5-5 for anthropic and gemini-2.5-flash for gemini
"""
import os
from abc import ABC, abstractmethod

DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


class ProviderDisabled(Exception):
    """The provider is not switched on (no key)."""


class ProviderError(Exception):
    """The provider failed (network, HTTP error, empty answer). The message is safe to log: it never holds the key or the question."""


class Provider(ABC):
    name = "none"
    enabled = False

    @abstractmethod
    def rephrase(self, message: str, lang: str, facts: list, mode: str = "trip") -> str:
        """Return friendly wording for `facts` that answers `message`, in language `lang` ("en" or "si"). mode: "trip" or "site" (the chat helper)."""


class DisabledProvider(Provider):
    name = "none"
    enabled = False

    def rephrase(self, message, lang, facts, mode="trip"):
        raise ProviderDisabled("the Copilot language model is not switched on on this server")


_cache = {}


def get_provider() -> Provider:
    """The provider for the current environment (a FastAPI dependency, so tests can replace it)."""
    key = os.environ.get("MC_LLM_API_KEY", "").strip()
    if not key:
        return DisabledProvider()
    kind = os.environ.get("MC_LLM_PROVIDER", "").strip().lower() or ("gemini" if key.startswith(("AIza", "AQ.")) else "anthropic")
    model = os.environ.get("MC_LLM_MODEL", "").strip() or (DEFAULT_GEMINI_MODEL if kind == "gemini" else DEFAULT_MODEL)
    if (key, kind, model) not in _cache:
        _cache.clear()
        if kind == "gemini":
            from .gemini import GeminiProvider      # imported only when a key exists
            _cache[(key, kind, model)] = GeminiProvider(api_key=key, model=model)
        else:
            from .llm import LlmProvider
            _cache[(key, kind, model)] = LlmProvider(api_key=key, model=model)
    return _cache[(key, kind, model)]
