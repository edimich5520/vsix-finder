# VSIX Finder

A tiny local web app for searching VS Code extension marketplaces and downloading `.vsix` installer packages. It is useful for VS Code-compatible IDEs such as Trae, Cursor, VSCodium, code-server, and similar tools when an extension is not visible in the IDE's built-in extension store.

## Why this approach

A local Node.js web app is the simplest reliable option because:

- it provides a clean search UI;
- it avoids browser CORS limitations by querying marketplaces from the local server;
- it can stream `.vsix` downloads directly to your browser;
- it has no third-party npm dependencies.

## Supported sources

- VS Code Marketplace
- Open VSX Registry

## Requirements

- Node.js 18 or newer

## Run

```bash
cd vsix-finder
npm start
```

Then open:

```text
http://localhost:3434
```

Optional custom port:

```bash
PORT=5050 npm start
```

On Windows PowerShell:

```powershell
$env:PORT=5050; npm start
```

## Use

1. Search by extension name, publisher, or keyword.
2. Choose whether to search the VS Code Marketplace, Open VSX, or both.
3. Click **Download .vsix** for the extension you want.
4. In Trae, open the extension store and drag the downloaded `.vsix` file into the store.

## Install a `.vsix` manually in other VS Code-based IDEs

Many VS Code-compatible IDEs support one of these flows:

```bash
code --install-extension path/to/extension.vsix
```

or an **Install from VSIX...** command in the command palette or extensions view.

## Notes

- Some extensions require VS Code APIs that a VS Code-compatible IDE may not support yet. Try an earlier version if installation fails.
- Marketplace availability and licensing may differ by registry and IDE. Use packages according to the marketplace and extension license terms.
