"""Collect upstream notices from the packages selected by the two lockfiles."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
dest = root / "src-tauri/notices"
dest.mkdir(exist_ok=True)
meta = json.loads(subprocess.check_output([
    "cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform",
    "aarch64-apple-darwin", "--manifest-path", str(root / "src-tauri/Cargo.toml")]))
with (dest / "dependencies.txt").open("w") as out:
    for package in sorted(meta["packages"], key=lambda p: (p["name"], p["version"])):
        if not package["source"]:
            continue
        print(package["name"], package["version"], package["license"], file=out)
        folder = Path(package["manifest_path"]).parent
        notices = sorted(p for p in folder.iterdir() if p.is_file() and
                         p.name.upper().startswith(("LICENSE", "COPYING", "NOTICE")))
        for notice in notices:
            print(notice.read_text(errors="replace"), file=out)
        print(file=out)
    for name in ["react", "react-dom", "scheduler", "@tanstack/react-virtual", "@tanstack/virtual-core", "@tauri-apps/api", "@tauri-apps/plugin-dialog"]:
        folder = root / "node_modules" / name
        manifest = json.loads((folder / "package.json").read_text())
        print(name, manifest["version"], manifest["license"], file=out)
        for notice in sorted(folder.glob("LICENSE*")):
            print(notice.read_text(), file=out)
    engine = root / ".build/whisper.cpp"
    print((engine / "ggml/src/ggml-cpu/llamafile/sgemm.cpp").read_text().split("#include")[0][:1800], file=out)
    mini = (engine / "examples/miniaudio.h").read_text()
    print(mini[mini.rfind("ALTERNATIVE 1"):], file=out)
for name in ("DMSans", "NotoSansKR"):
    (dest / (name+".txt")).write_bytes((root / "public/fonts" / (name+"-LICENSE.txt")).read_bytes())
