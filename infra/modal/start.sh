#!/usr/bin/env bash
# Prepares a Modal container of the Montagio image, then starts ComfyUI and comfy-api-proxy.
#
# The image (infra/modal/montagio_s2.py) is the Runpod pod rebuilt: /workspace holds ComfyUI, its venvs,
# Node.js and the repository, installed by the functions of infra/runpod/bootstrap.sh. Two Modal volumes
# hold what must outlive the container:
#   /weights   volume montagio-weights: the lock's weights (/workspace/ComfyUI/models links to /weights/models)
#   /results   volume montagio-results: s1-results/ (smoke.jsonl, clips), runs/, and the photos in inputs/
# Each file of /results/inputs is linked into /workspace, so the checklist's /workspace/start.png works as is.
#
# Usage, from the functions of montagio_s2.py, or by hand in `modal shell infra/modal/montagio_s2.py::cmd`
# (Linux and macOS only: the modal CLI has no shell on Windows):
#   bash infra/modal/start.sh            start both services (ComfyUI on 127.0.0.1:8188)
#   bash infra/modal/start.sh --expose-ui   ComfyUI on 0.0.0.0, for a modal.forward tunnel
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

mkdir -p /weights/models /results/s1-results /results/inputs /results/runs
for file in /results/inputs/*; do
  [ -f "$file" ] && ln -sfn "$file" "/workspace/$(basename "$file")"
done

bash "$REPO_ROOT/infra/runpod/bootstrap.sh" start "$@"
