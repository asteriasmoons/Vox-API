## Environment

The Lumey recommendation pipeline uses separate AI providers for separate stages:

- Groq analyzes recommendation requests and seed books.
- Mistral generates recommendation candidates from Groq's structured profile.

Required:

```sh
GROQ_API_KEY=
MISTRAL_API_KEY=
```

Optional model overrides:

```sh
GROQ_MODEL=openai/gpt-oss-120b
MISTRAL_MODEL=mistral-small-latest
```

Do not commit real API keys.
