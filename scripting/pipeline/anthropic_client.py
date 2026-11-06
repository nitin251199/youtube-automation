"""Groq text client for the scripting half of the pipeline."""
import json
import os

from dotenv import load_dotenv

load_dotenv()

DEFAULT_MODEL = "openai/gpt-oss-120b"


class ScriptClient:
    """Text-completions adapter for Groq, the only writing-model provider."""
    provider = "groq"

    def __init__(self, model: str | None = None):
        if not os.getenv("GROQ_API_KEY"):
            raise RuntimeError("No writing-model key found. Add GROQ_API_KEY to scripting/.env (or set it in your environment).")
        from groq import Groq
        self.model = model or os.getenv("GROQ_MODEL") or DEFAULT_MODEL
        self.client = Groq()

    def complete(self, prompt: str, max_tokens: int = 7000, temperature: float = 0) -> str:
        response = self.client.chat.completions.create(
            model=self.model, max_tokens=max_tokens, temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )
        choice = response.choices[0]
        content = choice.message.content or ""
        if not content.strip():
            raise ValueError("Groq returned an empty response")
        if choice.finish_reason == "length":
            raise ValueError(f"Groq stopped at the {max_tokens}-token limit; the output is incomplete")
        return content


# Compatibility names used by the existing stage CLI.
GroqClient = ScriptClient
Claude = ScriptClient

def parse_jsonish(raw: str):
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try: return json.loads(text)
    except json.JSONDecodeError:
        start, end = min([i for i in [text.find("["), text.find("{")] if i >= 0], default=-1), max(text.rfind("]"), text.rfind("}"))
        if start >= 0 and end > start: return json.loads(text[start:end+1])
        raise ValueError("Groq output was not JSON; preserve raw output and inspect the template's required structure")
