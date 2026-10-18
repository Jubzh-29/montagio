# SPDX-License-Identifier: GPL-3.0-only
"""The smoke test's prompt, and how its runner reads what ComfyUI answers.

scripts/smoke_comfyui.py is run by hand against a real ComfyUI (its docstring says how).
These tests check what can be checked without one: the prompt wires the outputs of the Montagio
nodes into the core WanCameraEmbedding node the way the nodes declare them, and main() turns the
answers of a stand-in HTTP server into the right exit code.
"""
import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from montagio_nodes.nodes import MontagioLoadPreset, MontagioPresetFromYAML
from montagio_nodes.params import frame_count
from montagio_nodes.preset import parse_preset

# the schema of MontagioLoadPreset lists the preset folders, which need a models folder of their own
pytestmark = pytest.mark.usefixtures("fake_models_dir")

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "smoke_comfyui.py"


def _load_script():
    # scripts/ is not a package, and the folder name "comfy-nodes" is not importable
    spec = importlib.util.spec_from_file_location("smoke_comfyui", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke = _load_script()


# --- the prompt -------------------------------------------------------------------


def test_prompt_wires_preset_outputs_into_wan_camera_embedding():
    inputs = smoke.build_prompt()["3"]["inputs"]
    assert inputs == {
        "camera_pose": ["2", 0],
        "speed": ["2", 1],
        "width": ["2", 2],
        "height": ["2", 3],
        "length": ["2", 4],
    }


def test_prompt_links_follow_the_outputs_the_node_declares():
    """The links are indexes: they must point at the outputs of that name in the schema."""
    prompt = smoke.build_prompt()
    names = [output.display_name for output in MontagioPresetFromYAML.define_schema().outputs]
    for input_name, link in prompt["3"]["inputs"].items():
        node_id, index = link
        assert prompt[node_id]["class_type"] == "MontagioPresetFromYAML"
        assert names[index] == input_name  # WanCameraEmbedding names its inputs like our outputs


def test_prompt_nodes():
    prompt = smoke.build_prompt()
    assert prompt["1"] == {
        "class_type": "MontagioLoadPreset",
        "inputs": {"preset": "crash-push.yaml", "aspect": "16:9", "resolution": "preset", "camera_mode": "parametric"},
    }
    assert prompt["2"]["class_type"] == "MontagioPresetFromYAML"
    assert {key: value for key, value in prompt["2"]["inputs"].items() if key != "yaml"} == {
        "aspect": "16:9",
        "resolution": "preset",
        "camera_mode": "parametric",
    }
    assert prompt["3"]["class_type"] == "WanCameraEmbedding"


def test_prompt_yaml_is_crash_push_for_two_seconds():
    preset = parse_preset(smoke.build_prompt()["2"]["inputs"]["yaml"], "smoke prompt")
    assert preset["id"] == "crash-push"
    assert preset["camera"] == {"poses": ["zoom_in"], "speed": 1.5, "combine": "together"}
    assert preset["defaults"]["duration_s"] == 2
    assert frame_count(2, preset["defaults"]["fps"]) == 33  # what the run should show for the length


def test_prompt_displays_info_and_length():
    prompt = smoke.build_prompt()
    names = [output.display_name for output in MontagioLoadPreset.define_schema().outputs]
    outputs = [(node_id, node) for node_id, node in sorted(prompt.items()) if node["class_type"] == "PreviewAny"]
    assert [node["inputs"] for _, node in outputs] == [{"source": ["1", names.index("info")]}, {"source": ["3", 3]}]
    assert names.index("info") == 10  # the 11th output; WanCameraEmbedding's 4th (index 3) is its length


def test_prompt_is_api_format_and_json():
    prompt = smoke.build_prompt()
    assert json.loads(json.dumps(prompt)) == prompt
    for node in prompt.values():
        assert set(node) == {"class_type", "inputs"}
    # a link points at a node that exists
    for node in prompt.values():
        for value in node["inputs"].values():
            if isinstance(value, list):
                assert value[0] in prompt


def test_each_call_builds_a_new_prompt():
    first = smoke.build_prompt()
    first["3"]["inputs"].clear()
    assert smoke.build_prompt()["3"]["inputs"]


# --- main() against a stand-in ComfyUI ----------------------------------------------

KNOWN = ("MontagioLoadPreset", "MontagioPresetFromYAML", "WanCameraEmbedding", "PreviewAny")
SUCCESS = {
    "p1": {
        "outputs": {"4": {"text": ["two lines of info"]}, "5": {"text": ["33"]}},
        "status": {"status_str": "success", "completed": True, "messages": []},
    }
}
FAILURE = {
    "p1": {
        "outputs": {},
        "status": {
            "status_str": "error",
            "completed": False,
            "messages": [
                ["execution_start", {"prompt_id": "p1"}],
                ["execution_error", {"node_id": "3", "node_type": "WanCameraEmbedding", "exception_type": "KeyError", "exception_message": "'zoom_in'"}],
            ],
        },
    }
}


class StandInComfyUI:
    """An HTTP server that answers like the three routes of ComfyUI the runner uses."""

    def __init__(self, *, known=KNOWN, prompt_status=200, prompt_answer=None, history=SUCCESS, history_after=0):
        self.known = known
        self.prompt_status = prompt_status
        self.prompt_answer = {"prompt_id": "p1", "number": 0, "node_errors": {}} if prompt_answer is None else prompt_answer
        self.history = history
        self.history_after = history_after  # the history stays empty for that many asks
        self.asked = []
        self.posted = []
        stand_in = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status, body):
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                stand_in.asked.append(self.path)
                if self.path.startswith("/object_info/"):
                    name = self.path.rsplit("/", 1)[1]
                    # like ComfyUI: 200 and {} for a node it does not know
                    self._send(200, {name: {"input": {}}} if name in stand_in.known else {})
                elif self.path.startswith("/history/"):
                    count = sum(1 for path in stand_in.asked if path.startswith("/history/"))
                    self._send(200, {} if count <= stand_in.history_after else stand_in.history)
                else:
                    self._send(404, {})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                stand_in.posted.append((self.path, body))
                self._send(stand_in.prompt_status, stand_in.prompt_answer)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def stand_in():
    made = []

    def make(**kwargs):
        server = StandInComfyUI(**kwargs)
        made.append(server)
        return server

    yield make
    for server in made:
        server.close()


def run(server, capsys, **kwargs):
    code = smoke.main(server.url, poll_interval=0.01, **kwargs)
    return code, capsys.readouterr().out


def test_main_returns_0_and_shows_the_outputs_when_the_run_succeeds(stand_in, capsys):
    server = stand_in()
    code, out = run(server, capsys)
    assert code == 0
    assert "two lines of info" in out
    assert "33" in out
    (path, body), = server.posted
    assert path == "/prompt"
    assert body == {"prompt": smoke.build_prompt()}
    assert server.asked[0] == "/object_info/MontagioLoadPreset"  # checked before anything is sent


def test_main_waits_for_the_history(stand_in, capsys):
    server = stand_in(history_after=3)
    code, _ = run(server, capsys)
    assert code == 0
    assert sum(1 for path in server.asked if path == "/history/p1") == 4


def test_main_returns_1_and_shows_the_error_when_the_run_fails(stand_in, capsys):
    code, out = run(stand_in(history=FAILURE), capsys)
    assert code == 1
    assert "KeyError" in out and "'zoom_in'" in out and "WanCameraEmbedding" in out


def test_main_returns_1_when_the_pack_is_not_loaded(stand_in, capsys):
    server = stand_in(known=("WanCameraEmbedding", "PreviewAny"))
    code, out = run(server, capsys)
    assert code == 1
    assert "MontagioLoadPreset" in out
    assert server.posted == []  # nothing is sent to a ComfyUI that lacks the nodes


def test_main_returns_1_when_a_core_node_is_missing(stand_in, capsys):
    server = stand_in(known=("MontagioLoadPreset", "MontagioPresetFromYAML", "PreviewAny"))
    code, out = run(server, capsys)
    assert code == 1
    assert "WanCameraEmbedding" in out
    assert server.posted == []


def test_main_returns_1_and_shows_the_validation_errors_when_the_prompt_is_refused(stand_in, capsys):
    refusal = {
        "error": {"type": "prompt_outputs_failed_validation", "message": "Prompt outputs failed validation"},
        "node_errors": {"3": {"errors": [{"message": "Value not in list: camera_pose"}]}},
    }
    code, out = run(stand_in(prompt_status=400, prompt_answer=refusal), capsys)
    assert code == 1
    assert "Prompt outputs failed validation" in out
    assert "Value not in list: camera_pose" in out


def test_main_returns_1_when_only_part_of_the_prompt_passes_validation(stand_in, capsys):
    """ComfyUI accepts (HTTP 200) a prompt in which one output node failed validation, and skips that branch."""
    partial = {
        "prompt_id": "p1",
        "number": 0,
        "node_errors": {"1": {"errors": [{"message": "Value not in list: preset: 'nope.yaml'"}], "class_type": "MontagioLoadPreset"}},
    }
    server = stand_in(prompt_answer=partial)
    code, out = run(server, capsys)
    assert code == 1
    assert "Value not in list: preset" in out
    assert "MontagioLoadPreset" in out


def test_main_returns_1_when_an_output_node_shows_nothing(stand_in, capsys):
    skipped = {
        "p1": {
            "outputs": {"5": {"text": ["33"]}},
            "status": {"status_str": "success", "completed": True, "messages": []},
        }
    }
    code, out = run(stand_in(history=skipped), capsys)
    assert code == 1
    assert "node 4" in out


def test_main_returns_1_when_the_run_does_not_end_in_time(stand_in, capsys):
    code, out = run(stand_in(history_after=10**9), capsys, timeout=0.2)
    assert code == 1
    assert "p1" in out


def test_main_returns_1_when_nothing_answers(capsys):
    server = StandInComfyUI()
    url = server.url
    server.close()
    code = smoke.main(url, poll_interval=0.01)
    assert code == 1
    assert url in capsys.readouterr().out


def test_default_url():
    assert smoke.DEFAULT_URL == "http://127.0.0.1:8199"
