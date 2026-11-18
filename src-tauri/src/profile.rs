use serde_json::{json, Value};
use std::{path::Path, process::Command};
fn output(bin: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(bin).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}
fn sys(k: &str) -> Option<String> {
    output("/usr/sbin/sysctl", &["-n", k])
}
fn available() -> Option<u64> {
    let vm = output("/usr/bin/vm_stat", &[])?;
    let page = vm
        .lines()
        .next()?
        .split("page size of ")
        .nth(1)?
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()?;
    let pages = |key: &str| {
        vm.lines()
            .find(|l| l.starts_with(key))?
            .split(':')
            .nth(1)?
            .trim()
            .trim_end_matches('.')
            .parse::<u64>()
            .ok()
    };
    Some((pages("Pages free:")? + pages("Pages inactive:")?) * page)
}
pub fn detect(root: &Path) -> Value {
    let graphics = output(
        "/usr/sbin/system_profiler",
        &["SPDisplaysDataType", "-json"],
    )
    .and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let gpu = graphics
        .as_ref()
        .and_then(|v| v.pointer("/SPDisplaysDataType/0/sppci_model"))
        .and_then(Value::as_str);
    json!({"os":output("/usr/bin/sw_vers",&["-productVersion"]),"arch":std::env::consts::ARCH,"cpu":sys("machdep.cpu.brand_string"),"cores":sys("hw.ncpu").and_then(|s|s.parse::<u32>().ok()),"total":sys("hw.memsize").and_then(|s|s.parse::<u64>().ok()),"available":available(),"gpu":gpu,"disk":fs2::available_space(root).ok(),"vram":null})
}
