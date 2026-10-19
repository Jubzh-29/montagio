#!/usr/bin/env bash
# Montagio GPU session bootstrap, for a Runpod pod (RTX 4090, Linux, NVIDIA driver).
#
# Installs under $MONTAGIO_WORKSPACE (default /workspace, the pod's volume disk):
#   - ComfyUI at a pinned tag (commit verified) in its own venv, with a pinned PyTorch;
#   - comfy-api-proxy (MIT) at a pinned version, in its own venv;
#   - the avatar's voice node (wildminder/ComfyUI-Chatterbox) at a pinned commit, patched;
#   - Node.js 22 (checksum verified) and the repository's npm dependencies.
# Then links the Montagio node pack (comfy-nodes) into ComfyUI's custom_nodes,
# starts ComfyUI with --disable-partner-nodes on :8188 and the proxy on
# 127.0.0.1:8189, and fails if a single partner node got loaded.
#
# Usage, from the repository root on the pod:
#   bash infra/runpod/bootstrap.sh               install what is missing, then start both services
#   bash infra/runpod/bootstrap.sh --expose-ui   same, with ComfyUI on 0.0.0.0 for the Runpod HTTP proxy (port 8188)
#   bash infra/runpod/bootstrap.sh install|start|stop|status
#   bash infra/runpod/bootstrap.sh collect       pack s1-results, logs and environment into one .tgz to download
#
# Versions live in versions.env next to this script. Nothing here creates an
# account, calls a paid API or talks to Comfy Cloud.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
# shellcheck source-path=SCRIPTDIR source=versions.env
source "$SCRIPT_DIR/versions.env"

WORKSPACE=${MONTAGIO_WORKSPACE:-/workspace}
COMFY_DIR=$WORKSPACE/ComfyUI
COMFY_VENV=$WORKSPACE/venvs/comfyui
PROXY_VENV=$WORKSPACE/venvs/comfy-api-proxy
NODE_DIR=$WORKSPACE/node-v$NODE_VERSION-linux-x64
CACHE_DIR=$WORKSPACE/cache
LOG_DIR=$WORKSPACE/logs
RUN_DIR=$WORKSPACE/run
RESULTS_DIR=${MONTAGIO_RESULTS:-$REPO_ROOT/s1-results}
COMFY_PORT=8188
PROXY_PORT=8189
COMFY_URL=http://127.0.0.1:$COMFY_PORT
PROXY_URL=http://127.0.0.1:$PROXY_PORT
LISTEN=127.0.0.1

log() { printf '\033[1;36m[montagio]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[montagio] warning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[montagio] error:\033[0m %s\n' "$*" >&2; exit 1; }

# --- checks -----------------------------------------------------------------

preflight() {
  local tool
  for tool in git curl python3 tar gzip sha256sum nvidia-smi; do
    command -v "$tool" >/dev/null || die "$tool is missing (use a Runpod PyTorch template, which ships all of them)"
  done
  python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "Python 3.10+ is required, found $(python3 --version)"
  mkdir -p "$WORKSPACE" "$CACHE_DIR" "$LOG_DIR" "$RUN_DIR"
  log "GPU: $(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader)"
  log "driver supports CUDA $(cuda_version), Python $(python3 -c 'import platform; print(platform.python_version())')"
  local free_gb
  free_gb=$(df -BG --output=avail "$WORKSPACE" | tail -1 | tr -dc '0-9')
  log "free space on $WORKSPACE: ${free_gb} GB"
  if [ "$free_gb" -lt 90 ]; then
    warn "the weights need about 66 GB, ComfyUI and PyTorch about 10 GB: give the pod a volume disk of 120 GB or more"
  fi
}

# "13.0" from the nvidia-smi banner (the highest CUDA version the driver supports):
# R5xx drivers print "CUDA Version: 13.0", R6xx ones "CUDA UMD Version: 13.4".
# Same pattern as parseCudaBanner in infra/local/src/probe.ts.
cuda_version() {
  nvidia-smi | sed -En 's/.*CUDA (UMD )?Version: *([0-9]+\.[0-9]+).*/\2/p' | head -1
}

wait_http() { # url seconds label pidfile logfile
  local url=$1 seconds=$2 label=$3 pidfile=$4 logfile=$5 i
  for ((i = 0; i < seconds; i += 2)); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    if ! running "$pidfile"; then
      tail -n 40 "$logfile" >&2 || true
      die "$label exited during startup (full log: $logfile)"
    fi
    sleep 2
  done
  die "$label did not answer on $url after ${seconds}s (see $logfile)"
}

running() { # pidfile
  [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null
}

make_venv() { # dir
  [ -x "$1/bin/python" ] && return 0
  if ! python3 -m venv "$1" 2>/dev/null; then
    command -v apt-get >/dev/null || die "python3 -m venv failed and apt-get is not available"
    log "installing python3-venv"
    apt-get update -qq && apt-get install -y -qq "python3.$(python3 -c 'import sys; print(sys.version_info[1])')-venv" python3-venv
    python3 -m venv "$1"
  fi
  "$1/bin/python" -m pip install --quiet --upgrade pip
}

# --- install ----------------------------------------------------------------

install_node() {
  if [ -x "$NODE_DIR/bin/node" ]; then return 0; fi
  local tarball=node-v$NODE_VERSION-linux-x64.tar.gz
  log "installing Node.js $NODE_VERSION"
  curl -fsSL -o "$CACHE_DIR/$tarball" "https://nodejs.org/dist/v$NODE_VERSION/$tarball"
  echo "$NODE_SHA256  $CACHE_DIR/$tarball" | sha256sum -c --quiet - || die "Node.js tarball checksum mismatch"
  tar -xzf "$CACHE_DIR/$tarball" -C "$WORKSPACE"
}

install_comfyui() {
  if [ ! -d "$COMFY_DIR/.git" ]; then
    log "cloning ComfyUI $COMFYUI_TAG"
    git clone --quiet --depth 1 --branch "$COMFYUI_TAG" "$COMFYUI_REPO" "$COMFY_DIR"
  fi
  local head
  head=$(git -C "$COMFY_DIR" rev-parse HEAD)
  [ "$head" = "$COMFYUI_COMMIT" ] || die "ComfyUI in $COMFY_DIR is at $head, expected $COMFYUI_COMMIT ($COMFYUI_TAG): move it away or check it out"

  local cuda_major torch=$TORCH_VERSION vision=$TORCHVISION_VERSION flavor=$TORCH_CUDA
  cuda_major=$(cuda_version | cut -d. -f1)
  if [ "${cuda_major:-0}" -lt 13 ]; then
    if [ -z "$cuda_major" ]; then
      # A new banner format would land here: say so instead of blaming the driver.
      warn "found no CUDA version in nvidia-smi's banner: falling back to torch $TORCH_FALLBACK_VERSION+$TORCH_FALLBACK_CUDA"
    else
      warn "this host's driver stops at CUDA $(cuda_version): falling back to torch $TORCH_FALLBACK_VERSION+$TORCH_FALLBACK_CUDA"
    fi
    warn "ComfyUI $COMFYUI_TAG prefers a CUDA 13.0 build; if it misbehaves, redeploy on a host filtered on CUDA 13.0"
    torch=$TORCH_FALLBACK_VERSION vision=$TORCHVISION_FALLBACK_VERSION flavor=$TORCH_FALLBACK_CUDA
  fi
  local stamp="$COMFYUI_COMMIT torch==$torch+$flavor torchvision==$vision"
  if [ "$(cat "$COMFY_VENV/.montagio-stamp" 2>/dev/null)" = "$stamp" ]; then return 0; fi

  make_venv "$COMFY_VENV"
  log "installing torch $torch and torchvision $vision ($flavor)"
  "$COMFY_VENV/bin/pip" install --quiet --index-url "https://download.pytorch.org/whl/$flavor" "torch==$torch" "torchvision==$vision"
  log "installing ComfyUI requirements"
  # The constraint stops pip from swapping the CUDA build above for a PyPI one.
  printf 'torch==%s\ntorchvision==%s\n' "$torch" "$vision" >"$CACHE_DIR/torch-constraints.txt"
  "$COMFY_VENV/bin/pip" install --quiet -r "$COMFY_DIR/requirements.txt" -c "$CACHE_DIR/torch-constraints.txt"
  "$COMFY_VENV/bin/python" -I -c '
import torch
assert torch.cuda.is_available(), "torch sees no CUDA device"
print(f"[montagio] torch {torch.__version__} (CUDA {torch.version.cuda}) on {torch.cuda.get_device_name(0)}")
'
  echo "$stamp" >"$COMFY_VENV/.montagio-stamp"
}

# The avatar's voice: wildminder/ComfyUI-Chatterbox at the commit of versions.env, its /chatterbox/* routes
# removed by our patch, its Python packages installed without their own dependencies and checked by hash.
install_extension_nodes() {
  local dir=$COMFY_DIR/custom_nodes/ComfyUI-Chatterbox
  local patch=$SCRIPT_DIR/patches/comfyui-chatterbox-no-routes.patch
  local requirements=$SCRIPT_DIR/requirements-chatterbox.txt
  local stamp
  stamp="$CHATTERBOX_NODE_COMMIT $(cat "$patch" "$requirements" | sha256sum | cut -c1-16)"
  if [ "$(cat "$dir/.montagio-stamp" 2>/dev/null)" = "$stamp" ]; then return 0; fi
  if [ ! -d "$dir/.git" ]; then
    log "cloning the Chatterbox node (avatar voice) at ${CHATTERBOX_NODE_COMMIT:0:8}"
    git clone --quiet "$CHATTERBOX_NODE_REPO" "$dir"
  fi
  # --force drops an earlier copy of the patch, so it is applied once, to the pinned files
  git -C "$dir" checkout --quiet --force "$CHATTERBOX_NODE_COMMIT"
  [ "$(git -C "$dir" rev-parse HEAD)" = "$CHATTERBOX_NODE_COMMIT" ] || die "the Chatterbox node in $dir is not at $CHATTERBOX_NODE_COMMIT"
  git -C "$dir" apply --check "$patch" || die "$patch no longer applies to the Chatterbox node at $CHATTERBOX_NODE_COMMIT"
  git -C "$dir" apply "$patch"
  log "installing the Python packages of the Chatterbox node (pinned, hashed, no dependencies)"
  "$COMFY_VENV/bin/pip" install --quiet --no-deps --require-hashes -r "$requirements"
  echo "$stamp" >"$dir/.montagio-stamp"
}

install_proxy() {
  local stamp="comfy-api-proxy==$COMFY_API_PROXY_VERSION"
  if [ "$(cat "$PROXY_VENV/.montagio-stamp" 2>/dev/null)" = "$stamp" ]; then return 0; fi
  make_venv "$PROXY_VENV"
  log "installing $stamp"
  "$PROXY_VENV/bin/pip" install --quiet "$stamp"
  echo "$stamp" >"$PROXY_VENV/.montagio-stamp"
}

install_npm() {
  export PATH="$NODE_DIR/bin:$PATH"
  if [ -d "$REPO_ROOT/node_modules/@comfyorg/sdk" ] && [ "$REPO_ROOT/node_modules/.package-lock.json" -nt "$REPO_ROOT/package-lock.json" ]; then
    return 0
  fi
  log "installing the repository's npm dependencies (npm ci)"
  (cd "$REPO_ROOT" && NEXT_TELEMETRY_DISABLED=1 npm ci --no-audit --no-fund --loglevel=error)
}

write_env() {
  cat >"$WORKSPACE/montagio.env" <<EOF
# Generated by infra/runpod/bootstrap.sh: source it in every new terminal.
export PATH="$NODE_DIR/bin:\$PATH"
export MONTAGIO_WORKSPACE="$WORKSPACE"
export NEXT_TELEMETRY_DISABLED=1
# The tooling never needs a Comfy key; keep none in the environment.
unset COMFY_API_KEY
EOF
}

# --- services ---------------------------------------------------------------

# The presets with two camera moves need MontagioCameraEmbedding, from the node
# pack of this repository. Its dependencies, PyYAML and numpy, come with ComfyUI.
link_pack() {
  local link=$COMFY_DIR/custom_nodes/montagio
  [ -d "$COMFY_DIR/custom_nodes" ] || die "no ComfyUI in $COMFY_DIR: run bash infra/runpod/bootstrap.sh install first"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    die "$link is a folder, not a link to $REPO_ROOT/comfy-nodes: move it away, then start again"
  fi
  ln -sfn "$REPO_ROOT/comfy-nodes" "$link"
  log "Montagio node pack: $link -> $REPO_ROOT/comfy-nodes"
}

start_comfyui() {
  link_pack
  if running "$RUN_DIR/comfyui.pid"; then
    log "ComfyUI already running (pid $(cat "$RUN_DIR/comfyui.pid"))"
  else
    log "starting ComfyUI on $LISTEN:$COMFY_PORT with --disable-partner-nodes"
    # Only the server goes to the background, so $! is its pid; setsid keeps
    # it alive when the web terminal closes. Offline for Hugging Face: every weight
    # is placed by fetch-weights, and the voice node would otherwise download a
    # whole repository for a file it misses.
    (
      cd "$COMFY_DIR"
      HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
        setsid nohup "$COMFY_VENV/bin/python" main.py --listen "$LISTEN" --port "$COMFY_PORT" --disable-partner-nodes \
        >>"$LOG_DIR/comfyui.log" 2>&1 &
      echo $! >"$RUN_DIR/comfyui.pid"
    )
    wait_http "$COMFY_URL/system_stats" 300 ComfyUI "$RUN_DIR/comfyui.pid" "$LOG_DIR/comfyui.log"
  fi
  # Proof for the jury and for us: the running ComfyUI has no partner node.
  curl -fsS "$COMFY_URL/object_info" | "$COMFY_VENV/bin/python" -I -c '
import json, sys
info = json.load(sys.stdin)
partner = sorted(name for name, node in info.items()
                 if node.get("api_node") or str(node.get("python_module", "")).startswith("comfy_api_nodes"))
needed = ["WanCameraEmbedding", "WanCameraImageToVideo", "Wan22ImageToVideoLatent", "CreateVideo", "SaveVideo", "UNETLoader",
          "MontagioCameraEmbedding", "ChatterboxMTLTTS"]
missing = [name for name in needed if name not in info]
print(f"[montagio] {len(info)} node classes loaded, {len(partner)} partner node(s)")
if missing:
    print("[montagio] warning: nodes missing: " + ", ".join(missing))
if "MontagioCameraEmbedding" in missing:
    print(f"[montagio] warning: the Montagio node pack did not load: look for its import error in {sys.argv[1]}, then stop and start again")
if partner:
    print("[montagio] error: partner nodes loaded: " + ", ".join(partner[:20]))
    sys.exit(2)
' "$LOG_DIR/comfyui.log" || die "partner nodes are loaded: ComfyUI must run with --disable-partner-nodes"
  local version
  version=$(curl -fsS "$COMFY_URL/system_stats" | "$COMFY_VENV/bin/python" -I -c 'import json, sys; print(json.load(sys.stdin)["system"].get("comfyui_version", "?"))')
  log "ComfyUI $version answering on $COMFY_URL"
}

start_proxy() {
  if running "$RUN_DIR/proxy.pid"; then
    log "comfy-api-proxy already running (pid $(cat "$RUN_DIR/proxy.pid"))"
  else
    log "starting comfy-api-proxy on 127.0.0.1:$PROXY_PORT"
    (
      setsid nohup "$PROXY_VENV/bin/comfy-api-proxy" run \
        --comfyui "$COMFY_URL" --host 127.0.0.1 --port "$PROXY_PORT" --comfyui-base-dir "$COMFY_DIR" \
        >>"$LOG_DIR/proxy.log" 2>&1 &
      echo $! >"$RUN_DIR/proxy.pid"
    )
    wait_http "$PROXY_URL/api/v2/health" 60 comfy-api-proxy "$RUN_DIR/proxy.pid" "$LOG_DIR/proxy.log"
  fi
  log "proxy: $(curl -fsS "$PROXY_URL/api/v2/health")"
}

stop_services() {
  local name
  for name in proxy comfyui; do
    if running "$RUN_DIR/$name.pid"; then
      log "stopping $name"
      kill "$(cat "$RUN_DIR/$name.pid")" || true
    fi
    rm -f "$RUN_DIR/$name.pid"
  done
}

status() {
  local name
  for name in comfyui proxy; do
    if running "$RUN_DIR/$name.pid"; then log "$name: running (pid $(cat "$RUN_DIR/$name.pid"))"; else log "$name: stopped"; fi
  done
  if curl -fsS -o /dev/null "$COMFY_URL/system_stats"; then log "ComfyUI answers on $COMFY_URL"; else warn "ComfyUI does not answer"; fi
  if curl -fsS -o /dev/null "$PROXY_URL/api/v2/health"; then log "proxy answers on $PROXY_URL"; else warn "proxy does not answer"; fi
  nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | sed 's/^/[montagio] VRAM used, total: /'
}

collect() {
  local stamp archive
  stamp=$(date -u +%Y%m%d-%H%M)
  mkdir -p "$WORKSPACE" "$RESULTS_DIR/env" "$RESULTS_DIR/logs"
  nvidia-smi >"$RESULTS_DIR/env/nvidia-smi.txt" 2>&1 || true
  git -C "$COMFY_DIR" rev-parse HEAD >"$RESULTS_DIR/env/comfyui-commit.txt" 2>/dev/null || true
  "$COMFY_VENV/bin/pip" freeze >"$RESULTS_DIR/env/pip-freeze-comfyui.txt" 2>/dev/null || true
  "$PROXY_VENV/bin/pip" freeze >"$RESULTS_DIR/env/pip-freeze-proxy.txt" 2>/dev/null || true
  curl -fsS "$COMFY_URL/system_stats" >"$RESULTS_DIR/env/system_stats.json" 2>/dev/null || true
  curl -fsS "$COMFY_URL/object_info" | gzip >"$RESULTS_DIR/env/object_info.json.gz" 2>/dev/null || true
  cp "$LOG_DIR"/*.log "$RESULTS_DIR/logs/" 2>/dev/null || true
  # Workflows saved from the ComfyUI interface, and what it rendered.
  # (copied as dir/. so that collecting twice refreshes instead of nesting)
  if [ -d "$COMFY_DIR/user/default/workflows" ]; then
    mkdir -p "$RESULTS_DIR/comfyui-workflows" && cp -r "$COMFY_DIR/user/default/workflows/." "$RESULTS_DIR/comfyui-workflows/"
  fi
  if [ -d "$COMFY_DIR/output" ]; then
    mkdir -p "$RESULTS_DIR/comfyui-output" && cp -r "$COMFY_DIR/output/." "$RESULTS_DIR/comfyui-output/"
  fi
  archive=$WORKSPACE/s1-results-$stamp.tgz
  tar -czf "$archive" -C "$(dirname "$RESULTS_DIR")" "$(basename "$RESULTS_DIR")"
  log "packed $(du -h "$archive" | cut -f1) into $archive: download it before stopping the pod"
}

summary() {
  log "ready."
  log "  ComfyUI  $COMFY_URL (listening on $LISTEN)"
  if [ "$LISTEN" = 0.0.0.0 ] && [ -n "${RUNPOD_POD_ID:-}" ]; then
    log "  UI       https://$RUNPOD_POD_ID-$COMFY_PORT.proxy.runpod.net (public URL while the pod runs)"
  fi
  log "  proxy    $PROXY_URL (loopback only)"
  log "next, in this terminal:"
  log "  source $WORKSPACE/montagio.env"
  log "  npm run weights -w @montagio/infra-runpod -- --models-dir $COMFY_DIR/models"
  log "  npm run smoke -w @montagio/infra-runpod -- --runs 2"
}

# --- main -------------------------------------------------------------------

command=all
for arg in "$@"; do
  case $arg in
    --expose-ui) LISTEN=0.0.0.0 ;;
    all | install | start | stop | status | collect) command=$arg ;;
    -h | --help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $arg (see --help)" ;;
  esac
done

case $command in
  install)
    preflight; install_node; install_comfyui; install_extension_nodes; install_proxy; install_npm; write_env ;;
  start)
    mkdir -p "$LOG_DIR" "$RUN_DIR"; start_comfyui; start_proxy; summary ;;
  all)
    preflight; install_node; install_comfyui; install_extension_nodes; install_proxy; install_npm; write_env
    start_comfyui; start_proxy; summary ;;
  stop) stop_services ;;
  status) status ;;
  collect) collect ;;
esac
