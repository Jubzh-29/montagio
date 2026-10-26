# SPDX-License-Identifier: GPL-3.0-only
"""Montagio's host check on ComfyUI's own server: a domain rebound to 127.0.0.1 never reaches it."""
import asyncio
import sys
import types

import pytest

from montagio_nodes.host_guard import allowed, install, listed_hosts, loopback_only


@pytest.mark.parametrize("host", ["127.0.0.1:8188", "localhost:8188", "[::1]:8188", "LocalHost:8188", "localhost:9000", "127.0.0.1"])
def test_this_machine_passes_on_any_port_a_tunnel_may_use(host):
    assert allowed(host, None, [])


@pytest.mark.parametrize("host", ["rebind.example:8188", "rebind.example", "0.0.0.0:8188", "evil.example@localhost:8188", "localhost.:8188", "", None])
def test_a_rebound_domain_or_a_forged_host_is_refused(host):
    assert not allowed(host, None, [])


def test_an_origin_must_be_the_address_itself():
    assert allowed("localhost:8188", "http://localhost:8188", [])
    assert allowed("127.0.0.1:8188", "http://localhost:8188", [])  # one machine, two names for it
    for origin in ["https://evil.example", "http://localhost:5000", "null", "http://rebind.example:8188", "not a url"]:
        assert not allowed("localhost:8188", origin, []), origin


def test_a_listed_host_passes_as_the_app_lists_it():
    listed = listed_hosts(" http://studio.lan:8188/ , gpu-box ,bad host")
    assert listed == [("studio.lan", "8188"), ("gpu-box", None)]
    assert allowed("studio.lan:8188", "http://studio.lan:8188", listed)
    assert allowed("gpu-box:8188", None, listed)
    assert not allowed("studio.lan:9999", None, listed)


def test_the_check_runs_only_when_comfyui_listens_on_this_machine_alone():
    assert loopback_only("127.0.0.1")
    assert loopback_only("127.0.0.1,::1")
    assert not loopback_only("0.0.0.0")  # --expose-ui, a Modal tunnel: exposed on purpose
    assert not loopback_only("0.0.0.0,::")
    assert not loopback_only("192.168.1.20")


class FakeApp:
    def __init__(self):
        self.middlewares = []


def fake_comfyui(monkeypatch, listen, started_by_montagio=True):
    """The parts of ComfyUI install() reads: PromptServer.instance.app, aiohttp's web, comfy.cli_args.args."""
    if started_by_montagio:
        monkeypatch.setenv("MONTAGIO_HOST_GUARD", "1")
    else:
        monkeypatch.delenv("MONTAGIO_HOST_GUARD", raising=False)
    app = FakeApp()
    server = types.ModuleType("server")
    server.PromptServer = type("PromptServer", (), {"instance": types.SimpleNamespace(app=app)})
    web = types.ModuleType("aiohttp.web")
    web.middleware = lambda function: function
    web.json_response = lambda body, status: (status, body)
    aiohttp = types.ModuleType("aiohttp")
    aiohttp.web = web
    cli_args = types.ModuleType("comfy.cli_args")
    cli_args.args = types.SimpleNamespace(listen=listen, port=8188)
    for name, module in {"server": server, "aiohttp": aiohttp, "aiohttp.web": web, "comfy.cli_args": cli_args}.items():
        monkeypatch.setitem(sys.modules, name, module)
    return app


def request(host, origin=None):
    headers = {"Host": host, **({"Origin": origin} if origin else {})}
    return types.SimpleNamespace(headers=headers, path="/prompt", method="POST")


def test_install_puts_the_check_in_front_of_every_route_of_comfyui(monkeypatch):
    app = fake_comfyui(monkeypatch, "127.0.0.1")
    assert install()
    [guard] = app.middlewares

    async def handler(_request):
        return "ran"

    assert asyncio.run(guard(request("127.0.0.1:8188"), handler)) == "ran"
    assert asyncio.run(guard(request("rebind.example:8188"), handler)) == (403, {"error": "host-not-allowed"})
    assert asyncio.run(guard(request("localhost:8188", "https://evil.example"), handler)) == (403, {"error": "host-not-allowed"})


def test_install_leaves_an_exposed_comfyui_as_it_is(monkeypatch):
    app = fake_comfyui(monkeypatch, "0.0.0.0")
    assert not install()
    assert app.middlewares == []


def test_a_comfyui_montagio_did_not_start_keeps_its_own_rules(monkeypatch):
    # The pack is published for every ComfyUI: one behind a reverse proxy of its own names another host.
    app = fake_comfyui(monkeypatch, "127.0.0.1", started_by_montagio=False)
    assert not install()
    assert app.middlewares == []


def test_the_pack_entry_point_installs_the_check(monkeypatch):
    app = fake_comfyui(monkeypatch, "127.0.0.1")
    from montagio_nodes.nodes import comfy_entrypoint

    asyncio.run(comfy_entrypoint())
    assert len(app.middlewares) == 1
