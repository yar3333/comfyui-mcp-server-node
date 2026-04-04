# Contributing

Thank you for your interest in contributing to ComfyUI MCP Server (Node.js/TypeScript)!

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd comfyui-mcp-server-node
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start ComfyUI** (if not already running):
   ```bash
   cd <ComfyUI_dir>
   python main.py --port 8188
   ```

4. **Build and run the server:**
   ```bash
   npm run build
   npm start
   ```

5. **Test your changes:**
   ```bash
   npm test
   # Or run the test client manually:
   npx ts-node test_client.ts
   ```

## Code Style

- Follow TypeScript best practices with strict typing
- Use ESLint (`npm run lint`) to catch style issues
- Use `async/await` instead of raw Promises
- Prefer `const` over `let`; avoid `var`
- Use meaningful variable and function names
- Document public interfaces and complex functions with JSDoc comments
- Keep functions focused and small

## Testing

- Write tests for new features
- Run the full test suite before submitting PRs:
  ```bash
  npm test
  ```
- Tests are located in the `tests/` directory
- Use Jest framework; see `tests/setup.ts` for global configuration
- Mock external dependencies (ComfyUI, filesystem) where appropriate

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Add or update tests as needed
5. Ensure all tests pass: `npm test`
6. Ensure linting passes: `npm run lint`
7. Build the project: `npm run build`
8. Submit a pull request with a clear description

## Architecture

- **src/comfyui_client.ts** — HTTP client for ComfyUI API
- **src/asset_processor.ts** — Image processing utilities (sharp)
- **src/server.ts** — Main entry point, MCP server setup
- **src/managers/** — Core managers (workflow, defaults, assets, publish)
- **src/tools/** — MCP tool implementations
- **src/models/** — Data models and Zod schemas

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design decisions.

## Questions?

- Open an issue for bugs or feature requests
- Check [docs/REFERENCE.md](docs/REFERENCE.md) for API details
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions
