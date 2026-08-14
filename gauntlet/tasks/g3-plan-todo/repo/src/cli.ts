// Minimal greeting CLI. run() is the testable core; main() wires it to a
// real process invocation (argv/stdout), kept separate so tests never spawn
// a subprocess.
export function run(argv: string[]): string {
  const name = argv[0] ?? 'World'
  return `Hello, ${name}!`
}

export function main(): void {
  process.stdout.write(run(process.argv.slice(2)) + '\n')
}
