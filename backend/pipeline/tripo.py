"""Minimal Tripo API client (text-to-model), following the official docs:

    POST https://api.tripo3d.ai/v2/openapi/task        create a task
    GET  https://api.tripo3d.ai/v2/openapi/task/:id    poll it

Auth is `Authorization: Bearer <TRIPO_API_KEY>`. Successful responses carry
`code == 0` and the payload in `data`.

Important: output URLs expire about five minutes after the task finishes, so
download() runs immediately after a success rather than storing the link.
"""
import time
import pathlib

import requests
from requests.adapters import HTTPAdapter
from requests.exceptions import RequestException
from urllib3.util.retry import Retry

from . import config

BASE_URL = "https://api.tripo3d.ai/v2/openapi"

# A task is charged the moment it is accepted, so losing the network while
# polling means paying for a model and never collecting it. Both layers below
# exist for that: urllib3 retries the blips, and wait() rides out an outage of
# a couple of minutes rather than abandoning work already paid for.
POLL_FAILURES_ALLOWED = 8
DOWNLOAD_TRIES = 4

# 1 credit = $0.01 USD. text_to_model base cost by model family, plus a
# texture surcharge of +10 for standard quality (detailed +20, extreme +30).
CREDITS_PER_USD = 100
BASE_CREDITS = {"P1": 30, "default": 10}
TEXTURE_CREDITS = {"standard": 10, "detailed": 20, "extreme": 30}


def estimate_credits(model_version: str, textured: bool = True,
                     texture_quality: str = "standard") -> int:
    """What one text_to_model call will cost, so nothing is a surprise."""
    base = BASE_CREDITS["P1"] if model_version.startswith("P1") else BASE_CREDITS["default"]
    return base + (TEXTURE_CREDITS.get(texture_quality, 10) if textured else 0)


class TripoError(RuntimeError):
    pass


class TripoClient:
    def __init__(self, api_key: str | None = None, model_version: str | None = None):
        self.api_key = api_key or config.TRIPO_API_KEY
        self.model_version = model_version or config.TRIPO_MODEL_VERSION
        if not self.api_key:
            raise TripoError("TRIPO_API_KEY is not set. Put it in .env")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {self.api_key}"
        retry = Retry(
            total=5, connect=5, read=5, status=4,
            status_forcelist=(429, 500, 502, 503, 504),
            backoff_factor=1.5,
            allowed_methods=frozenset({"GET", "POST"}),
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))

    def _unwrap(self, response: requests.Response) -> dict:
        try:
            payload = response.json()
        except ValueError:
            raise TripoError(f"non-JSON response ({response.status_code}): {response.text[:300]}")
        if payload.get("code") != 0:
            raise TripoError(f"tripo error code={payload.get('code')} {payload.get('message')}")
        return payload.get("data", {})

    def balance(self) -> dict:
        """Credits left on the account. Free, and worth printing before a run."""
        return self._unwrap(
            self.session.get(f"{BASE_URL}/user/balance", timeout=30)
        )

    def text_to_model(self, prompt: str, negative_prompt: str = "",
                      face_limit: int = 20000, **extra) -> str:
        body = {
            "type": "text_to_model",
            "prompt": prompt,
            "model_version": self.model_version,
            "texture": True,
            "pbr": True,
            "face_limit": face_limit,
        }
        if negative_prompt:
            body["negative_prompt"] = negative_prompt
        body.update(extra)

        data = self._unwrap(self.session.post(f"{BASE_URL}/task", json=body, timeout=60))
        task_id = data.get("task_id")
        if not task_id:
            raise TripoError(f"no task_id in response: {data}")
        return task_id

    def get_task(self, task_id: str) -> dict:
        return self._unwrap(self.session.get(f"{BASE_URL}/task/{task_id}", timeout=30))

    def wait(self, task_id: str, poll_s: float = 4.0, timeout_s: float = 900.0,
             on_progress=None) -> dict:
        deadline = time.time() + timeout_s
        last = -1
        failures = 0
        while time.time() < deadline:
            try:
                task = self.get_task(task_id)
            except RequestException as exc:
                # Their side is still working on it whatever happens here, and
                # it is already paid for. Keep asking.
                failures += 1
                if failures >= POLL_FAILURES_ALLOWED:
                    raise TripoError(
                        f"lost contact with task {task_id} after {failures} "
                        f"attempts: {exc}"
                    ) from exc
                if on_progress:
                    on_progress(f"offline ({failures})", last if last >= 0 else 0)
                time.sleep(min(30.0, poll_s * 2 ** failures))
                continue
            failures = 0
            status = task.get("status")
            progress = task.get("progress", 0)
            if on_progress and progress != last:
                on_progress(status, progress)
                last = progress
            if status == "success":
                return task
            if status in {"failed", "banned", "expired", "cancelled", "unknown"}:
                raise TripoError(f"task {task_id} ended as {status}")
            time.sleep(poll_s)
        raise TripoError(f"task {task_id} timed out after {timeout_s}s")

    def download(self, task: dict, dest: pathlib.Path) -> pathlib.Path:
        """Save the finished model. URLs expire ~5 min after success."""
        output = task.get("output", {})
        url = output.get("pbr_model") or output.get("model") or output.get("base_model")
        if not url:
            raise TripoError(f"task {task.get('task_id')} has no model url: {output}")

        dest.parent.mkdir(parents=True, exist_ok=True)
        # Plain requests, not self.session: the file lives on their CDN and the
        # API key has no business being sent to another host.
        for attempt in range(1, DOWNLOAD_TRIES + 1):
            try:
                with requests.get(url, stream=True, timeout=300) as response:
                    response.raise_for_status()
                    with open(dest, "wb") as handle:
                        for chunk in response.iter_content(chunk_size=1 << 16):
                            handle.write(chunk)
                return dest
            except RequestException as exc:
                # The link expires about five minutes after the task finishes,
                # so there is no point being patient for long.
                if attempt == DOWNLOAD_TRIES:
                    raise TripoError(f"could not download {task.get('task_id')}: {exc}") from exc
                time.sleep(2.0 * attempt)
        return dest

    def generate(self, prompt: str, dest: pathlib.Path, negative_prompt: str = "",
                 on_progress=None, **extra) -> pathlib.Path:
        task_id = self.text_to_model(prompt, negative_prompt, **extra)
        task = self.wait(task_id, on_progress=on_progress)
        return self.download(task, dest)
