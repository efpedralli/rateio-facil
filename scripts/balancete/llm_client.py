from __future__ import annotations

import json
import urllib.request


def call_llm(prompt: str, model: str = "phi3") -> str:
    payload = json.dumps(
        {"model": model, "prompt": prompt, "stream": False},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/generate",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
        data = json.loads(body)
        return str(data.get("response", "") or "")
    except Exception:
        return ""
