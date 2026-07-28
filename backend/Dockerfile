# OMR GradePro backend — production image.
#
# Build context is the REPO ROOT (not backend/) — paths below are prefixed with
# backend/ to match, mirroring frontend/Dockerfile. Invoke as:
#   docker build -f backend/Dockerfile -t <tag> .
#
# The image contains ONLY code + deps. No env-specific values are baked in:
# provide GOOGLE_APPLICATION_CREDENTIALS (plus the mounted SA key file) and
# OMR_SECRET at runtime via the K8s ConfigMap/Secret — see
# configmap.backend.*.yaml and secret.backend.*.yaml.example.
FROM docker-central.adda247.com/base-images/python-3-12:0.0.2

ENV PORT=5000 \
    HOST=0.0.0.0

WORKDIR /app

# Install deps first for layer caching. The base image ships most deps, but
# requirements.txt is the source of truth (it now includes google-cloud-bigquery,
# which the base image predates), so install it explicitly.
#
# torch/torchvision MUST be installed from the CPU-only index, BEFORE the rest.
# The default PyPI torch wheel is a CUDA build — on this builder it pulled
# ~1.8 GB of nvidia-* wheels (cublas 543 MB, cusolver 224 MB, cufft 214 MB,
# cusparse 162 MB, triton 185 MB, nccl, cudnn, nvshmem, cuda-toolkit …) which
# expand to several GB in the image. That is what pushed "Artifact creation"
# from ~2.5 min to 21 min and left the kubelet unable to pull the image
# (ImagePullBackOff). requirements.txt documents the CPU index, but the flag
# has to live *here*, where pip actually runs.
#
# Pinned +cpu builds keep it reproducible. These exact versions are published
# for cp312 on BOTH manylinux_2_28 aarch64 and x86_64, so the image builds on
# an ARM or an Intel agent — the CPU index has no aarch64 wheels below 2.6.
# Both satisfy the `torch>=2.5` / `torchvision>=0.20` floors in
# requirements.txt, so the second install leaves them alone rather than
# re-resolving a CUDA wheel from PyPI. Nothing needs a GPU: TrOCR runs on CPU.
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        torch==2.13.0+cpu torchvision==0.28.0+cpu \
 && pip install --no-cache-dir -r requirements.txt \
 && if pip list --format=freeze | grep -q '^nvidia-\|^triton'; then \
      echo "FATAL: CUDA wheels were installed — the image will be multi-GB and"; \
      echo "the kubelet will fail to pull it. A dependency pulled in a CUDA torch:"; \
      pip list --format=freeze | grep '^nvidia-\|^triton'; \
      exit 1; \
    fi

# App code. Build context is the repo root, so app.py lands at /app/app.py and
# gunicorn's `app:app` module reference resolves.
COPY backend/ .

RUN mkdir -p uploads
VOLUME ["/app/uploads"]

# gunicorn reads $PORT; 4 workers is a sane default for small deployments.
# Liveness is a K8s livenessProbe against /api/health on the Deployment, not
# a Dockerfile HEALTHCHECK — the kubelet never reads the latter.
CMD ["sh", "-c", "gunicorn --bind ${HOST:-0.0.0.0}:${PORT:-5000} --workers ${WEB_CONCURRENCY:-4} --timeout 120 app:app"]
