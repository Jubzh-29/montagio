# SPDX-License-Identifier: GPL-3.0-only
"""Montagio's host check on ComfyUI's own server.

ComfyUI has no login, and its own guard compares Origin with Host: a page the user has open elsewhere can
point its domain at 127.0.0.1 (DNS rebinding) and send both in that domain's name, then queue workflows and
read the files of the input and output folders. While ComfyUI listens on this machine only, every request
must name it: localhost, 127.0.0.1 or [::1] in Host, on any port (an SSH tunnel may forward another one),
or a host of MONTAGIO_ALLOWED_HOSTS, as the app reads it. An Origin, when the browser sends one, must be that
same address. Anything else gets 403 host-not-allowed, logged once. A ComfyUI that listens on another
address (--listen 0.0.0.0, the GPU sessions' --expose-ui and Modal tunnel) is exposed on purpose: no check.

The check runs when MONTAGIO_HOST_GUARD=1, which Montagio's installer and GPU-session bootstrap set: the pack
is published for every ComfyUI, and one behind a reverse proxy of its own legitimately names another host.
"""
import ipaddress
import logging
import os

LOOPBACK = {"localhost", "127.0.0.1", "::1"}
DEFAULT_PORTS = {"http": "80", "https": "443", "ws": "80", "wss": "443"}
_FORBIDDEN = set("/\\@?# \t")

log = logging.getLogger(__name__)


def split_host(text):
    """("name", "port" or None) of a Host value: lower case, an IPv6 address without its brackets; None if malformed."""
    if not text or any(char in _FORBIDDEN for char in text):
        return None
    text = text.lower()
    if text.startswith("["):
        end = text.find("]")
        if end < 0 or (len(text) > end + 1 and text[end + 1] != ":"):
            return None
        name, port = text[1:end], text[end + 2:] or None
    else:
        name, _, port = text.partition(":")
        port = port or None
    if not name or (port is not None and not port.isdigit()):
        return None
    return name, port


def origin_address(origin):
    """("name", "port") of an Origin ("https://studio.lan"), the scheme's port when it gives none; None for "null"."""
    scheme, sep, rest = (origin or "").partition("://")
    if not sep or scheme.lower() not in DEFAULT_PORTS:
        return None
    address = split_host(rest)
    if not address:
        return None
    return address[0], address[1] or DEFAULT_PORTS[scheme.lower()]


def listed_hosts(raw):
    """The hosts of MONTAGIO_ALLOWED_HOSTS ("192.168.1.20:8080,studio.lan"): a scheme and a trailing / dropped."""
    hosts = []
    for entry in (raw or "").split(","):
        entry = entry.strip()
        if "://" in entry:
            entry = entry.split("://", 1)[1]
        address = split_host(entry.rstrip("/"))
        if address:
            hosts.append(address)
    return hosts


def _listed(address, listed):
    return any(name == address[0] and (port is None or port == address[1]) for name, port in listed)


def allowed(host, origin, listed):
    """Whether a request that names `host`, and `origin` when there is one, may reach ComfyUI."""
    address = split_host(host)
    if not address or not (address[0] in LOOPBACK or _listed(address, listed)):
        return False
    if origin is None:
        return True
    from_page = origin_address(origin)
    if not from_page:
        return False
    if _listed(from_page, listed):
        return True
    # The page that sent it is this address: the same port, under any of this machine's names.
    port = address[1] or "80"
    return from_page[1] == port and (from_page[0] == address[0] or (from_page[0] in LOOPBACK and address[0] in LOOPBACK))


def loopback_only(listen):
    """Whether ComfyUI's --listen names this machine alone (127.0.0.1, ::1, localhost)."""
    for item in (listen or "").split(","):
        item = item.strip().lower()
        if item in LOOPBACK:
            continue
        try:
            if not ipaddress.ip_address(item).is_loopback:
                return False
        except ValueError:
            return False
    return True


def install():
    """Put the check in front of every route of ComfyUI's server, before it starts; False when it does not apply."""
    if os.environ.get("MONTAGIO_HOST_GUARD") != "1":
        return False
    try:
        from aiohttp import web
        from comfy.cli_args import args
        from server import PromptServer
    except ImportError:
        return False
    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        return False
    if not loopback_only(getattr(args, "listen", "127.0.0.1")):
        log.warning("[montagio] ComfyUI listens on %s: the host check is off, as the address is open on purpose", args.listen)
        return False
    refused = set()

    @web.middleware
    async def montagio_host_guard(request, handler):
        host, origin = request.headers.get("Host"), request.headers.get("Origin")
        if allowed(host, origin, listed_hosts(os.environ.get("MONTAGIO_ALLOWED_HOSTS"))):
            return await handler(request)
        key = (host, origin)
        if key not in refused and len(refused) < 50:
            refused.add(key)
            log.warning(
                "[montagio] a request for host %s%s refused: list the address in MONTAGIO_ALLOWED_HOSTS to open ComfyUI there",
                host or "(none)",
                f" from {origin}" if origin else "",
            )
        return web.json_response({"error": "host-not-allowed"}, status=403)

    try:
        instance.app.middlewares.append(montagio_host_guard)
    except RuntimeError as error:  # the server already started: too late to add a middleware
        log.warning("[montagio] the host check could not be installed: %s", error)
        return False
    return True
