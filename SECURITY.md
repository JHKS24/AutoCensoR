# Security

Report security issues privately to the project maintainers before public
disclosure.

Do not expose the local backend directly to the public internet. It can read
image paths available to the server process and should be protected by a trusted
network boundary or reverse proxy authentication when used remotely.

AutoCensor vNext has no auxiliary LLM, telemetry, cloud upload, remote AI API,
API key flow, or normal-operation model download. If you find code that appears
to send images, metadata, labels, or local paths to a remote service, treat it as
a security issue.

EXIF preservation is off by default. Turning it on can preserve camera, date,
location, and device metadata in output images.
