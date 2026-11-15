"""
/api/copilot: the optional language-model step of the trip planner's Copilot.

  GET  /api/copilot/status    {enabled, provider}   the website asks this to decide whether to offer AI wording
  POST /api/copilot/rephrase  {message, lang, facts:[...]} -> {text}

The website has ALREADY retrieved the facts from real data; this route only rewords them. With no MC_LLM_API_KEY on the server
the status says enabled=false and rephrase answers 503, so the website keeps using its rule-based answers.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from .copilot import grounding
from .copilot.limits import RateLimiter
from .copilot.provider import Provider, ProviderDisabled, ProviderError, get_provider

router = APIRouter(prefix="/api/copilot")
log = logging.getLogger("copilot")
limiter = RateLimiter()


class Rephrase(BaseModel):
    message: str = Field(min_length=1, max_length=grounding.MAX_MESSAGE_CHARS)
    lang: str = "en"
    facts: list[str] = Field(min_length=1, max_length=grounding.MAX_FACTS)

    @field_validator("lang")
    @classmethod
    def _lang(cls, v):
        if v not in grounding.LANGS:
            raise ValueError("lang must be en or si")
        return v

    @field_validator("facts")
    @classmethod
    def _facts(cls, v):
        if any(len(f) > grounding.MAX_FACT_CHARS for f in v):
            raise ValueError(f"each fact must have at most {grounding.MAX_FACT_CHARS} characters")
        if sum(len(f) for f in v) > grounding.MAX_TOTAL_CHARS:
            raise ValueError("the facts are too long")
        return v


@router.get("/status")
def status(provider: Provider = Depends(get_provider)):
    return {"enabled": bool(provider.enabled), "provider": provider.name if provider.enabled else None}


@router.post("/rephrase")
def rephrase(body: Rephrase, request: Request, provider: Provider = Depends(get_provider)):
    if not provider.enabled:
        raise HTTPException(status_code=503, detail="the Copilot language model is not switched on")
    client = request.client.host if request.client else "unknown"
    if not limiter.allow(client):
        raise HTTPException(status_code=429, detail="too many questions; wait a minute")
    try:
        text = provider.rephrase(body.message, body.lang, body.facts)
    except ProviderDisabled:
        raise HTTPException(status_code=503, detail="the Copilot language model is not switched on")
    except ProviderError as err:
        raise HTTPException(status_code=502, detail=str(err))
    if not grounding.numbers_ok(text, body.message, body.facts):
        log.warning("copilot: answer rejected, it contained a number that is not in the facts")
        raise HTTPException(status_code=502, detail="the answer was not grounded in the facts and was dropped")
    return {"text": text}
