# Model Files

Place a compatible trusted Ultralytics segmentation `.pt` model here when you
run the real backend.

Default path:

```text
models/autocensor_model.pt
```

Model weights are not included in this source release and are not downloaded by
normal application operation. Users must manually provide model files from a
trusted source they are allowed to use.

Do not commit private, unlicensed, personal, or non-public model files to a
public repository. Documentation and examples should refer only to neutral paths
such as `models/autocensor_model.pt`.
