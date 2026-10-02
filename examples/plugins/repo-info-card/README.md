# Repo Info Card

Page-only V1.4 example adapted from tag v0.8.5 (245ee310).
Install this directory in desktop Plugin Management and confirm all permissions.
Open it from a repository-card action. No Worker or package installation is needed.

The host supplies repository facts, README and language. AI uses the currently
configured provider only after per-request confirmation and appears in the host
task journal. The example limits README at the prompt budget and reports truncation.
Only generated, sanitized text markup is previewed or exported; scripts, external
resources, URL attributes, inline style and custom elements are not retained.

Choose a canvas and palette, generate, zoom, copy HTML or export PNG. Changing the
canvas requires regenerating before PNG export. Copy image and native save are
permission-checked. A canceled save is not success. Binary payloads are capped at
10 MiB of UTF-8 JSON/base64 (about 7.5 MiB decoded, less with JSON overhead).

This example does not validate AI factual accuracy. Review generated content
before sharing, especially private repositories, personal notes and README claims.
Native PNG rasterization and clipboard/save require an isolated Electron smoke test.
