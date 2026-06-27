# Privacy And Release Notes

This repository is intended for public open-source release. Keep public source,
docs, reports, screenshots, and packaged artifacts free of private local paths,
personal names, emails, account identifiers, secrets, API keys, private machine
names, private sample titles, and private model provenance.

## Network And AI Policy

- No auxiliary LLM is used.
- No remote LLM/API integration is present.
- No telemetry is present.
- No images, metadata, labels, local paths, or model details are uploaded to a
  remote API by normal operation.
- No model file is downloaded by normal operation.
- Users manually install dependencies and manually place model files.

## SFW Privacy Mode

SFW Privacy Mode is a display privacy feature. It must hide or neutralize:

- raw image pixels in the editor;
- thumbnails;
- filenames and filename tooltips;
- original preview;
- sensitive target group names;
- sensitive target class labels;
- selected target label counts;
- detected region labels and confidence text;
- status current-file text;
- model diagnostics label lists;
- hover text that would reveal sensitive categories.

Preferred wording includes Protected image, Protected file, Protected categories,
Sensitive group, or equivalent Korean neutral wording. SFW mode does not delete,
anonymize, or upload local files.

## EXIF And Outputs

EXIF preservation defaults off. Enabling it can preserve camera, date, location,
and device metadata. Copying clean originals byte-for-byte can also preserve
source metadata.

Batch outputs use:

```text
<output>/<input-folder-name><suffix>/<relative-image-path>
```

The default suffix is `_censored`.

## Model And Font Policy

Model weights are not bundled. Public docs should refer to neutral model paths
such as `models/autocensor_model.pt` and should not describe private model
origin.

No fonts are bundled. The UI uses operating-system fonts with Korean-capable
fallbacks. Korean UI and docs text must be stored as UTF-8.

## Public Credit Request

If the project is useful, please star the GitHub repository or credit the
project under the MIT License terms.
