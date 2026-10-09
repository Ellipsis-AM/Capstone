# LogicFlow

LogicFlow is a student-friendly capstone prototype that makes simple JavaScript logic visible. Paste code, run it, and inspect the current variable state beside a line-by-line explanation of the program.

The interface has three working divisions: a code input area, a state tracker for variable values and changes, and a logic flow list that pairs each executed line with a brief explanation.

## Run locally

```bash
npm.cmd install or npm install
npm.cmd run dev or npm run dev
```

Open the local URL shown by Vite in your browser.

PowerShell may block the `npm.ps1` wrapper because of its execution policy. On Windows, use `npm.cmd` as shown above. This does not require changing your system security settings.

## Current scope

The client-side prototype supports variable declarations, arithmetic and comparison expressions, booleans, strings, `console.log`, simple `if`/`else if`/`else` branching, `while` loops, and `for` loops. It is intentionally a small learning tool rather than a complete JavaScript debugger. The next natural capstone milestones are richer line highlighting, better state comparisons, and a visual graph view.

## Build

```bash
npm.cmd run build
```