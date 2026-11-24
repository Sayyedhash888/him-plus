#!/usr/bin/env python -u
"""HIM+ notebook kernel bridge.

Protocol: one JSON object per line on stdin, one JSON object per line on stdout.

  {"id": "...", "op": "execute", "code": "...", "captureDataframes": true}
  {"id": "...", "op": "restart"}
  {"id": "...", "op": "shutdown"}

Every response carries the same id:
  {"id": "...", "ok": true, "executionCount": n, "outputs": [...], "dataframes": {...}}
  {"id": "...", "ok": false, "error": "..."}

On startup a single {"ready": true, "kernel": "...", "pandas": bool} line is printed.
Uses jupyter_client/ipykernel when available so real kernel semantics and rich
outputs work; falls back to an in-process exec loop otherwise.
"""

import base64
import json
import math
import os
import sys
import traceback

READY = {"ready": False, "kernel": "exec", "pandas": False}

try:
    import pandas as pd  # noqa: F401

    READY["pandas"] = True
except Exception:
    pd = None

KERNEL = None
CLIENT = None
KERNEL_LABEL = "exec"
GLOBALS = {"__name__": "__him_notebook__", "__builtins__": __builtins__}


def send(payload):
    sys.stdout.write(json.dumps(payload, default=str) + "\n")
    sys.stdout.flush()


def start_kernel():
    global KERNEL, CLIENT, KERNEL_LABEL
    if KERNEL is not None:
        return
    from jupyter_client.manager import KernelManager  # type: ignore

    KERNEL = KernelManager(kernel_name="python3")
    KERNEL.start_kernel(cwd=os.getcwd())
    CLIENT = KERNEL.client()
    CLIENT.start_channels()
    CLIENT.wait_for_ready(timeout=60)
    KERNEL_LABEL = "jupyter"


def shutdown_kernel():
    global KERNEL, CLIENT
    if CLIENT is not None:
        try:
            CLIENT.stop_channels()
        except Exception:
            pass
        CLIENT = None
    if KERNEL is not None:
        try:
            KERNEL.shutdown_kernel(now=True)
        except Exception:
            pass
        KERNEL = None


def json_safe(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return str(value)


def dataframe_snapshot(frame, max_rows=200):
    head = frame.head(max_rows)
    rows = [[json_safe(cell) for cell in row] for row in head.itertuples(index=False, name=None)]
    columns = []
    for column in frame.columns:
        series = frame[column]
        info = {
            "name": str(column),
            "dtype": str(series.dtype),
            "nulls": int(series.isna().sum()),
            "unique": int(series.nunique(dropna=True)),
        }
        if pd is not None and pd.api.types.is_numeric_dtype(series):
            clean = series.dropna()
            if len(clean):
                info["min"] = json_safe(clean.min())
                info["max"] = json_safe(clean.max())
                info["mean"] = json_safe(float(clean.mean()))
        else:
            try:
                top = series.value_counts(dropna=True).head(5)
                info["top"] = [{"value": str(k), "count": int(v)} for k, v in top.items()]
            except Exception:
                pass
        columns.append(info)
    return {
        "columns": columns,
        "rows": rows,
        "shape": [int(frame.shape[0]), int(frame.shape[1])],
        "index": [str(i) for i in head.index],
    }


def capture_dataframes():
    if pd is None:
        return {}
    probe = r"""
import json as _him_json, math as _him_math
import pandas as _him_pd
_frames = {}
def _him_clean(_v):
    if _v is None:
        return None
    if isinstance(_v, bool):
        return _v
    if isinstance(_v, (int, str)):
        return _v
    if isinstance(_v, float):
        return _v if _him_math.isfinite(_v) else None
    return str(_v)
def _him_snapshot(_df):
    _head = _df.head(200)
    _rows = [[_him_clean(_c) for _c in _r] for _r in _head.itertuples(index=False, name=None)]
    _cols = []
    for _col in _df.columns:
        _s = _df[_col]
        _info = {'name': str(_col), 'dtype': str(_s.dtype), 'nulls': int(_s.isna().sum()), 'unique': int(_s.nunique(dropna=True))}
        if _him_pd.api.types.is_numeric_dtype(_s):
            _clean = _s.dropna()
            if len(_clean):
                _info['min'] = _him_clean(_clean.min())
                _info['max'] = _him_clean(_clean.max())
                try:
                    _info['mean'] = _him_clean(float(_clean.mean()))
                except Exception:
                    pass
        else:
            try:
                _info['top'] = [{'value': str(_k), 'count': int(_v)} for _k, _v in _s.value_counts(dropna=True).head(5).items()]
            except Exception:
                pass
        _cols.append(_info)
    return {'columns': _cols, 'rows': _rows, 'shape': [int(_df.shape[0]), int(_df.shape[1])], 'index': [str(_i) for _i in _head.index]}
for _name, _val in list(globals().items()):
    if _name.startswith('_'):
        continue
    if isinstance(_val, _him_pd.DataFrame):
        try:
            _frames[_name] = _him_snapshot(_val)
        except Exception:
            pass
print('__HIM_DATAFRAMES__' + _him_json.dumps(_frames, default=str))
"""
    result = execute_jupyter(probe, timeout=60, capture=False)
    frames = {}
    for output in result["outputs"]:
        text = output.get("text", "")
        marker = "__HIM_DATAFRAMES__"
        if marker in text:
            payload = text.split(marker, 1)[1].strip().splitlines()[0]
            try:
                frames = json.loads(payload)
            except Exception:
                frames = {}
    return frames


def execute_jupyter(code, timeout=120, capture=True, request_id=None, token=None, stream=None):
    msg_id = CLIENT.execute(code, allow_stdin=False, stop_on_error=False)
    outputs = []
    execution_count = None
    import time

    def emit(output):
        outputs.append(output)
        if stream is not None and request_id is not None:
            try:
                stream({"id": request_id, "token": token, "partial": output})
            except Exception:
                pass

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            message = CLIENT.get_iopub_msg(timeout=max(0.1, deadline - time.time()))
        except Exception:
            break
        if message.get("parent_header", {}).get("msg_id") != msg_id:
            continue
        kind = message.get("msg_type")
        content = message.get("content", {})
        if kind == "status" and content.get("execution_state") == "idle":
            break
        if kind == "stream":
            emit(
                {"type": "stream", "name": content.get("name", "stdout"), "text": content.get("text", "")}
            )
        elif kind == "execute_result":
            execution_count = content.get("execution_count")
            emit(
                {
                    "type": "result",
                    "data": content.get("data", {}),
                    "executionCount": execution_count,
                }
            )
        elif kind == "display_data":
            emit({"type": "display", "data": content.get("data", {})})
        elif kind == "error":
            emit(
                {
                    "type": "error",
                    "ename": content.get("ename", "Error"),
                    "evalue": content.get("evalue", ""),
                    "traceback": content.get("traceback", []),
                }
            )
    try:
        reply = CLIENT.get_shell_msg(timeout=5)
        if reply.get("parent_header", {}).get("msg_id") == msg_id:
            content = reply.get("content", {})
            execution_count = content.get("execution_count", execution_count)
    except Exception:
        pass
    return {
        "outputs": outputs,
        "executionCount": execution_count,
        "dataframes": capture_dataframes() if capture else {},
    }


def execute_fallback(code, timeout=120):
    import contextlib
    import io
    import ast

    buffer = io.StringIO()
    outputs = []
    try:
        tree = ast.parse(code)
        last_expr = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = ast.Expression(tree.body.pop(-1).value)
        with contextlib.redirect_stdout(buffer):
            exec(compile(tree, "<cell>", "exec"), GLOBALS)  # noqa: S102
            result = eval(compile(last_expr, "<cell>", "eval"), GLOBALS) if last_expr else None  # noqa: S307
        text = buffer.getvalue()
        if text:
            outputs.append({"type": "stream", "name": "stdout", "text": text})
        if result is not None:
            data = {"text/plain": repr(result)}
            if pd is not None and isinstance(result, pd.DataFrame):
                data["text/html"] = result.head(50).to_html()
            outputs.append({"type": "result", "data": data, "executionCount": None})
        frames = {}
        if pd is not None:
            for name, value in list(GLOBALS.items()):
                if isinstance(value, pd.DataFrame) and not name.startswith("_"):
                    frames[name] = dataframe_snapshot(value)
        return {"outputs": outputs, "executionCount": None, "dataframes": frames, "ok": True}
    except Exception:
        return {
            "outputs": [
                {
                    "type": "error",
                    "ename": type(sys.exc_info()[1]).__name__,
                    "evalue": str(sys.exc_info()[1]),
                    "traceback": traceback.format_exc().splitlines(),
                }
            ],
            "executionCount": None,
            "dataframes": {},
            "ok": True,
        }


def execute(code, timeout=120, request_id=None, token=None, stream=None):
    if KERNEL is not None:
        return execute_jupyter(
            code,
            timeout=timeout,
            capture=True,
            request_id=request_id,
            token=token,
            stream=stream,
        )
    return execute_fallback(code, timeout)


def main():
    global KERNEL
    import queue
    import threading

    try:
        start_kernel()
    except Exception:
        KERNEL = None
    READY["ready"] = True
    READY["kernel"] = KERNEL_LABEL
    send(READY)

    requests = queue.Queue()
    write_lock = threading.Lock()

    def safe_send(payload):
        with write_lock:
            sys.stdout.write(json.dumps(payload, default=str) + "\n")
            sys.stdout.flush()

    def reader():
        global KERNEL, CLIENT
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except Exception:
                continue
            if request.get("op") == "interrupt":
                try:
                    # Hard stop: kill the kernel so a running cell cannot continue.
                    # The next execute request starts a fresh kernel automatically.
                    if KERNEL is not None:
                        try:
                            if CLIENT is not None:
                                CLIENT.stop_channels()
                        except Exception:
                            pass
                        try:
                            KERNEL.shutdown_kernel(now=True)
                        except Exception:
                            pass
                    CLIENT = None
                    KERNEL = None
                    safe_send({"id": request.get("id"), "ok": True, "stopped": True})
                except Exception as error:
                    safe_send({"id": request.get("id"), "ok": False, "error": str(error)})
                continue
            requests.put(request)
        requests.put(None)

    threading.Thread(target=reader, daemon=True).start()

    while True:
        request = requests.get()
        if request is None:
            shutdown_kernel()
            return
        request_id = request.get("id")
        op = request.get("op", "execute")
        if op == "shutdown":
            shutdown_kernel()
            safe_send({"id": request_id, "ok": True, "shutdown": True})
            return
        if op == "restart":
            shutdown_kernel()
            try:
                start_kernel()
            except Exception:
                KERNEL = None
            safe_send({"id": request_id, "ok": True, "kernel": KERNEL_LABEL})
            continue
        try:
            if KERNEL is None:
                try:
                    start_kernel()
                except Exception:
                    pass
            result = execute(
                request.get("code", ""),
                int(request.get("timeout", 120)),
                request_id=request_id,
                token=request.get("token"),
                stream=safe_send,
            )
            safe_send(
                {
                    "id": request_id,
                    "ok": True,
                    "kernel": KERNEL_LABEL,
                    "executionCount": result.get("executionCount"),
                    "outputs": result.get("outputs", []),
                    "dataframes": result.get("dataframes", {}),
                }
            )
        except Exception as error:
            safe_send({"id": request_id, "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
