"""Isolated, offline residual training. No product database or network access."""
import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

STOP = None


def read_json(file):
    with open(file, "rb") as stream:
        data = stream.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        raise ValueError("INPUT_SIZE_LIMIT")
    return json.loads(data)


def atomic_json(file, value):
    temporary = file.with_suffix(file.suffix + ".pending")
    with open(temporary, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)


def state(job, status, **details):
    value = {"schema": 1, "status": status, "at": time.time(), **details}
    atomic_json(job / "status.json", value)
    with open(job / "events.jsonl", "a", encoding="utf-8") as stream:
        stream.write(json.dumps(value, allow_nan=False) + "\n")
    print(json.dumps(value), flush=True)


@contextlib.contextmanager
def lock(file):
    # OS-owned locks release on process death and do not mistake a reused PID for a live job.
    with open(file, "a+b") as stream:
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def request(job):
    if (job / "cancel.request").exists():
        return "CANCELLED"
    if STOP or (job / "pause.request").exists():
        return "PAUSED"
    return None


def doctor():
    import torch
    versions = {}
    for name in ["torch", "transformers", "sentence-transformers", "peft", "onnx", "onnxruntime"]:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    cuda = torch.cuda.is_available()
    print(json.dumps({"schema": 1, "python": sys.version.split()[0], "versions": versions,
                      "cuda": cuda, "device": torch.cuda.get_device_name(0) if cuda else None,
                      "bf16": torch.cuda.is_bf16_supported() if cuda else False,
                      "recipes": ["query-residual-v1"], "loraValidated": False}))


def checkpoint(job, value, torch):
    temporary = job / "checkpoint.pending"
    with open(temporary, "wb") as stream:
        torch.save(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    if temporary.stat().st_size > 16 * 1024 * 1024:
        temporary.unlink()
        raise ValueError("CHECKPOINT_SIZE_LIMIT")
    os.replace(temporary, job / "checkpoint.pt")


def train(job, spec, resume):
    import torch
    import torch.nn.functional as functional

    torch.set_num_threads(2)
    device = "cuda" if spec["device"] == "GPU" else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("GPU_UNAVAILABLE")
    torch.manual_seed(spec["seed"])
    if device == "cuda":
        torch.cuda.manual_seed_all(spec["seed"])
        torch.cuda.reset_peak_memory_stats()
    torch.use_deterministic_algorithms(True)
    environment = {"torch": str(torch.__version__), "python": sys.version.split()[0], "device": device,
                   "gpu": torch.cuda.get_device_name(0) if device == "cuda" else None}
    spec_hash = hashlib.sha256((job / "spec.json").read_bytes()).hexdigest()
    rank = spec["rank"]
    down = torch.nn.Parameter(torch.randn(rank, 768, device=device) * 0.01)
    up = torch.nn.Parameter(torch.zeros(768, rank, device=device))
    optimizer = torch.optim.AdamW([down, up], lr=0.003, weight_decay=0.01)
    ids = sorted(entry["id"] for entry in spec["entries"])
    positions = {identity: index for index, identity in enumerate(ids)}
    matrix = torch.tensor([spec["images"][identity] for identity in ids], dtype=torch.float32, device=device)
    queries = {identity: torch.tensor(vector, dtype=torch.float32, device=device) for identity, vector in spec["queries"].items()}
    cases = [item for item in spec["cases"] if item["split"] == "train"
             and any(j["relevance"] == "positive" for j in item["judgments"])
             and any(j["relevance"] == "negative" for j in item["judgments"])]
    validation = [item for item in spec["cases"] if item["split"] == "validation"
                  and any(j["relevance"] == "positive" for j in item["judgments"])]
    if not cases or not validation:
        raise ValueError("TRAINING_AND_VALIDATION_REQUIRED")
    groups = sorted(set(item["group"] for item in cases))
    by_group = {group: [item for item in cases if item["group"] == group] for group in groups}

    def encode(query):
        return functional.normalize(query + up @ (down @ query), dim=0)

    def quality():
        grouped = {}
        with torch.no_grad():
            for item in validation:
                scores = matrix @ encode(queries[item["id"]])
                order = torch.argsort(scores, descending=True, stable=True).tolist()
                positives = {positions[j["id"]] for j in item["judgments"] if j["relevance"] == "positive"}
                first = next(index + 1 for index, position in enumerate(order) if position in positives)
                grouped.setdefault(item["group"], []).append(1.0 / first)
        return sum(sum(values) / len(values) for values in grouped.values()) / len(grouped)

    step = 0
    elapsed = 0.0
    gradient_seen = False
    best_score = quality()
    best = {"up": up.detach().cpu().clone(), "down": down.detach().cpu().clone(), "step": 0}
    if resume:
        saved = torch.load(job / "checkpoint.pt", map_location=device, weights_only=True)
        if saved["specHash"] != spec_hash or saved["environment"] != environment:
            raise ValueError("RESUME_REQUIRES_IDENTICAL_SPEC_AND_ENVIRONMENT")
        with torch.no_grad():
            up.copy_(saved["up"])
            down.copy_(saved["down"])
        optimizer.load_state_dict(saved["optimizer"])
        torch.set_rng_state(saved["rng"].cpu())
        if device == "cuda":
            torch.cuda.set_rng_state(saved["cudaRng"].cpu())
        step, elapsed, best_score, best = saved["step"], saved["elapsed"], saved["bestScore"], saved["best"]
        gradient_seen = saved.get("gradientSeen", False)
    start = time.monotonic()
    result = "SUCCEEDED"
    state(job, "RUNNING", step=step, maxSteps=spec["steps"], phase="training", environment=environment)
    last_loss = None

    def save():
        state(job, "CHECKPOINTING", step=step, phase="training")
        checkpoint(job, {"specHash": spec_hash, "environment": environment, "step": step,
                         "elapsed": elapsed + time.monotonic() - start, "up": up.detach(), "down": down.detach(),
                         "optimizer": optimizer.state_dict(), "rng": torch.get_rng_state(),
                         "cudaRng": torch.cuda.get_rng_state() if device == "cuda" else None,
                         "bestScore": best_score, "best": best, "gradientSeen": gradient_seen}, torch)

    while step < spec["steps"] and elapsed + time.monotonic() - start < spec["seconds"]:
        stop = request(job)
        if stop:
            result = stop
            break
        group = groups[step % len(groups)]
        examples = by_group[group]
        item = examples[(step // len(groups)) % len(examples)]
        positive = [positions[j["id"]] for j in item["judgments"] if j["relevance"] == "positive"]
        negative = [positions[j["id"]] for j in item["judgments"] if j["relevance"] == "negative"]
        query = queries[item["id"]]
        transformed = encode(query)
        logits = matrix[positive + negative] @ transformed / 0.07
        loss = torch.logsumexp(logits, dim=0) - torch.logsumexp(logits[:len(positive)], dim=0)
        loss = loss + 0.5 * (1 - torch.dot(transformed, query))
        if not torch.isfinite(loss):
            raise RuntimeError("NONFINITE_LOSS")
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        gradients = [parameter.grad for parameter in [up, down]]
        if any(gradient is None or not torch.isfinite(gradient).all() for gradient in gradients):
            raise RuntimeError("INVALID_GRADIENT")
        gradient_seen = gradient_seen or any(bool(torch.count_nonzero(gradient)) for gradient in gradients)
        torch.nn.utils.clip_grad_norm_([up, down], 1.0, error_if_nonfinite=True)
        optimizer.step()
        step += 1
        last_loss = float(loss.detach())
        if step % spec["checkpointEvery"] == 0 or step == spec["steps"]:
            score = quality()
            if score > best_score:
                best_score = score
                best = {"up": up.detach().cpu().clone(), "down": down.detach().cpu().clone(), "step": step}
            save()
            state(job, "RUNNING", step=step, phase="training", loss=last_loss, validationMrr=score)
    # A time budget or pause can end between regular validation checkpoints.
    score = quality()
    if score > best_score:
        best_score = score
        best = {"up": up.detach().cpu().clone(), "down": down.detach().cpu().clone(), "step": step}
    save()
    candidate = {"schema": 1, "kind": "query-residual-v1", "datasetId": spec["datasetId"],
                 "snapshotId": spec["snapshotId"],
                 "modelDigest": spec["modelDigest"], "rank": rank, "down": best["down"].cpu().tolist(),
                 "up": best["up"].cpu().tolist(), "trainingSteps": best["step"], "provisional": spec["provisional"]}
    if result == "SUCCEEDED":
        atomic_json(job / "candidate.json", candidate)
        atomic_json(job / "trained-candidate.json", {**candidate, "trainingSteps": step,
                    "up": up.detach().cpu().tolist(), "down": down.detach().cpu().tolist()})
    summary = {"step": step, "bestStep": best["step"], "elapsedSeconds": elapsed + time.monotonic() - start,
               "validationSemanticMrr": best_score, "finiteGradientObserved": gradient_seen,
               "parameterDeltaL2": float(torch.linalg.vector_norm(up.detach())),
               "peakGpuBytes": torch.cuda.max_memory_allocated() if device == "cuda" else None,
               "provisional": spec["provisional"], "deploymentApproved": False}
    # The supervisor publishes the terminal state only after this compute process exits.
    atomic_json(job / "completion.json", {"status": result, **summary})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["doctor", "train", "compute"])
    parser.add_argument("--job")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if args.command == "doctor":
        doctor()
        return
    job = Path(args.job).resolve()
    spec = read_json(job / "spec.json")
    if spec.get("recipe") != "query-residual-v1":
        raise ValueError("UNKNOWN_RECIPE")
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    if args.command == "compute":
        train(job, spec, args.resume)
        return
    with lock(job / "run.lock"):
        if args.resume:
            previous = read_json(job / "status.json")
            if previous["status"] in ("SUCCEEDED", "CANCELLED"):
                raise ValueError("TERMINAL_JOB_CANNOT_RESUME")
            (job / "pause.request").unlink(missing_ok=True)
        elif (job / "status.json").exists():
            raise ValueError("JOB_EXISTS_USE_RESUME")
        # Ignore stale completion left by a previous attempt, while exclusively owning the job.
        (job / "completion.json").unlink(missing_ok=True)
        state(job, "QUEUED", phase="waiting")
        queued = time.monotonic()
        slot = Path(tempfile.gettempdir()) / "aiy-furnace-compute.lock"
        while True:
            if request(job):
                state(job, request(job), phase="waiting")
                return
            lease = lock(slot)
            try:
                lease.__enter__()
            except OSError as error:
                if error.errno not in (11, 13):
                    raise
                if time.monotonic() - queued > spec["seconds"]:
                    state(job, "FAILED", error="GPU_QUEUE_TIMEOUT")
                    raise TimeoutError("GPU_QUEUE_TIMEOUT")
                time.sleep(0.25)
                continue
            try:
                state(job, "STARTING", phase="loading")
                run_compute(job, spec, args.resume)
            except Exception as error:
                current = read_json(job / "status.json")
                if current["status"] not in ("FAILED", "INTERRUPTED"):
                    state(job, "FAILED", error=type(error).__name__)
                raise
            finally:
                lease.__exit__(None, None, None)
            break


def run_compute(job, spec, resume):
    command = [sys.executable, "-u", str(Path(__file__).resolve()), "compute", "--job", str(job)]
    if resume and (job / "checkpoint.pt").exists():
        command.append("--resume")
    child = None
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        started = time.monotonic()
        while child.poll() is None:
            if STOP:
                atomic_json(job / "pause.request", {"requestedBy": "supervisor"})
            # Preparation has a separate allowance. A stuck kernel cannot reserve the GPU indefinitely.
            if time.monotonic() - started > spec["seconds"] + 120:
                child.kill()
                child.wait()
                state(job, "INTERRUPTED", error="PROCESS_TIME_BUDGET")
                raise TimeoutError("PROCESS_TIME_BUDGET")
            time.sleep(0.25)
        if child.returncode != 0:
            state(job, "FAILED", error="COMPUTE_PROCESS_EXIT", exitCode=child.returncode)
            raise RuntimeError("COMPUTE_PROCESS_EXIT")
        completion = read_json(job / "completion.json")
        status = completion.pop("status")
        if status not in ("SUCCEEDED", "PAUSED", "CANCELLED"):
            raise ValueError("INVALID_COMPLETION")
        state(job, status, **completion)
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait()


def stop(_signal, _frame):
    global STOP
    STOP = "PAUSED"


if __name__ == "__main__":
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    main()
