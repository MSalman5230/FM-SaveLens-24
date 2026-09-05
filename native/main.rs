#[tokio::main]
async fn main() {
    if let Err(e) = fm_savelens_backend::service::run_browser(std::env::args().skip(1)).await {
        eprintln!("{}: {}", e.code, e.message);
        std::process::exit(1);
    }
}
