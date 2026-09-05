use fm_savelens_backend::parser::parse_save;
use std::{
    io::{self, Write},
    path::Path,
};
use tokio_util::sync::CancellationToken;
fn main() {
    let path = std::env::args().nth(1).expect("usage: parse-save FILE.fm");
    let value = match parse_save(Path::new(&path), &CancellationToken::new(), |_, _| {}) {
        Ok(save) => serde_json::to_value(save).unwrap(),
        Err(e) => serde_json::json!({"error":e.message,"code":e.code}),
    };
    let stdout = io::stdout();
    let mut output = io::BufWriter::new(stdout.lock());
    serde_json::to_writer(&mut output, &value).unwrap();
    output.write_all(b"\n").unwrap();
}
