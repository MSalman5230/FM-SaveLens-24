#[path = "../tests/support/mod.rs"]
mod support;
fn main() {
    let path = std::env::args_os().nth(1).expect("Pass an output .fm path");
    let path = std::path::Path::new(&path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    assert!(!path.exists(), "Refusing to overwrite an existing file");
    support::archive(path, true, "24.3.0+0", 64);
}
