"""
Provider interface for the Copilot's optional "reword this answer" step.

The browser already builds a grounded answer from real data (forecast, NASA POWER tendency...). A provider may only turn the
list of facts into friendlier wording. Providers:

  DisabledProvider   used when there is no key: enabled = False, rephrase() raises ProviderDisabled (the route answers 503)
  LlmProvider        (llm.py) the Anthropic Messages API, switched on only by the environment variable MC_LLM_API_KEY

Settings come ONLY from the server's environment, never from the website:
  MC_LLM_API_KEY    secret key (never logged, never returned)
  MC_LLM_MODEL      model id, default claude-sonnet-5-5
"""
import os
from abc import ABC, abstractmethod

DEFAULT_MODEL = "claude-sonnet-5-5"


class ProviderDisabled(Exception):
    """The provider is not switched on (no key)."""


class ProviderError(Exception):
    """The provider failed (network, HTTP error, empty answer). The message is safe to log: it never holds the key or the question."""


class Provider(ABC):
    name = "none"
    enabled = False

    @abstractmethod
    def rephrase(self, message: str, lang: str, facts: list) -> str:
        """Return friendly wording for `facts` that answers `message`, in language `lang` ("en" or "si")."""


class DisabledProvider(Provider):
    name = "none"
    enabled = False

    def rephrase(self, message, lang, facts):
        raise ProviderDisabled("the Copilot language model is not switched on on this server")


_cache = {}


def get_provider() -> Provider:
    """The provider for the current environment (a FastAPI dependency, so tests can replace it)."""
    key = os.environ.get("MC_LLM_API_KEY", "").strip()
    if not key:
        return DisabledProvider()
    model = os.environ.get("MC_LLM_MODEL", "").strip() or DEFAULT_MODEL
    if (key, model) not in _cache:
        from .llm import LlmProvider          # imported only when a key exists
        _cache.clear()
        _cache[(key, model)] = LlmProvider(api_key=key, model=model)
    return _cache[(key, model)]
