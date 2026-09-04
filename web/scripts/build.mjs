// Vinext's CLI calls process.exit immediately after building. On Windows this
// can race native Vite worker cleanup (UV_HANDLE_CLOSING). Let a successful
// build drain the event loop naturally; preserve every non-zero failure.
const exit = process.exit.bind(process);
if (process.platform === 'win32') {
  process.exit = (code = 0) => {
    if (Number(code) !== 0) return exit(code);
    process.exitCode = 0;
  };
}
process.argv = [process.argv[0], 'vinext', 'build'];
await import('../node_modules/vinext/dist/cli.js');
