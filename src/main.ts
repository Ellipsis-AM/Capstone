import "./style.css";
import { traceCode, type TraceStep, type VariableValue } from "./tracer";

const starterCode = `let total = 0;
for (let i = 1; i <= 4; i++) {
  total += i;
}
console.log(total);`;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const formatValue = (value: VariableValue) =>
  value === null ? "null" : String(value);

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="topbar">
    <div class="brand-mark">LF</div>
    <div>
      <strong>LogicFlow</strong>
      <span>code logic, made visible</span>
    </div>
    <div class="status"><i></i> local workspace</div>
  </header>
  <main>
    <section class="intro">
      <div>
        <p class="eyebrow">CAPSTONE PROTOTYPE / JAVASCRIPT</p>
        <h1>Follow the<br><em>logic.</em></h1>
        <p class="lede">
          Write code, watch its state change, and understand each step in plain
          language.
        </p>
      </div>
      <div class="intro-note">
        <span>01</span>
        <p>Write or edit<br>your code.</p>
      </div>
      <div class="intro-note">
        <span>02</span>
        <p>Run the flow<br>to understand.</p>
      </div>
    </section>
    <section class="workspace">
      <div class="panel code-panel">
        <div class="panel-head">
          <div>
            <span class="kicker">DIVISION 01 / SOURCE</span>
            <h2>Code input</h2>
          </div>
          <button id="sample-button" class="quiet-button" type="button">
            Load example
          </button>
        </div>
        <textarea id="code-input" spellcheck="false" aria-label="JavaScript code input">${starterCode}</textarea>
        <div class="editor-foot">
          <span id="line-count">6 lines</span>
          <span>JavaScript subset</span>
        </div>
      </div>
      <div class="panel state-panel">
        <div class="panel-head">
          <div>
            <span class="kicker">DIVISION 02 / MEMORY</span>
            <h2>State tracker</h2>
          </div>
          <span class="live-dot">LIVE</span>
        </div>
        <div id="state-output" class="state-output"></div>
      </div>
      <div class="panel flow-panel">
        <div class="panel-head">
          <div>
            <span class="kicker">DIVISION 03 / EXPLANATION</span>
            <h2>Logic flow</h2>
          </div>
          <button id="run-button" class="run-button" type="button">
            <span>Run flow</span>
            <b>↗</b>
          </button>
        </div>

        <div class ="step-controls">
          <button id="previous-button">← Previous</button>
          <button id="next-button">Next →</button>
          <button id="auto-button">▶ Auto</button>
          <button id="pause-button">❚❚ Pause</button>
        </div>
        <div class="flow-labels">
          <span>CODE</span>
          <span>WHAT IT DOES</span>
        </div>
        <div id="flow-output" class="flow-output"></div>
      </div>
    </section>
    <p class="support-note">
      <span>i</span> Supports variables, arithmetic, <code>console.log</code>,
      and simple <code>for</code> loops.
    </p>
  </main>
  <footer>
    <span>LogicFlow / built for learning</span>
    <span>Every line tells a story.</span>
  </footer>`;

const input = document.querySelector<HTMLTextAreaElement>("#code-input")!;
const flowOutput = document.querySelector<HTMLDivElement>("#flow-output")!;
const stateOutput = document.querySelector<HTMLDivElement>("#state-output")!;
const lineCount = document.querySelector<HTMLSpanElement>("#line-count")!;

let traceSteps: TraceStep[] = [];
let currentStepIndex = 0;
let autoPlayTimer: number | undefined;

function renderState(steps: TraceStep[]) {
  const latest = steps[steps.length - 1]?.state ?? {};
  const changes = steps.filter((step) => step.changed.length);
  const variables = Object.entries(latest);
  if (!variables.length) {
    stateOutput.innerHTML =
      '<div class="empty-state"><strong>State is empty</strong><span>Run code that creates a variable.</span></div>';
    return;
  }

  const variableMarkup = variables
    .map(
      ([name, value]) => `
        <div class="variable">
          <b>${escapeHtml(name)}</b>
          <strong>${escapeHtml(formatValue(value))}</strong>
        </div>`,
    )
    .join("");

  const changeMarkup = changes.length
    ? changes
        .slice(-8)
        .reverse()
        .map(
          (step) => `
            <div class="change">
              <span>LN ${step.lineNumber}</span>
              <p>${step.changed
                .map((name) => `<b>${escapeHtml(name)}</b> changed`)
                .join(", ")}</p>
            </div>`,
        )
        .join("")
    : '<p class="muted">No variable changes yet.</p>';

  stateOutput.innerHTML = `
    <div class="state-summary">
      <span>${variables.length}</span>
      <p>variables tracked<br><small>latest known values</small></p>
    </div>
    <div class="variable-list">${variableMarkup}</div>
    <div class="change-log">
      <span class="kicker">CHANGE LOG</span>
      ${changeMarkup}
    </div>`;
}

function renderFlow(steps: TraceStep[], selectedIndex = -1) {
  if (!steps.length) {
    flowOutput.innerHTML =
      '<div class="empty-state"><strong>Nothing to explain yet.</strong><span>Add a few lines of JavaScript on the left.</span></div>';
    return;
  }
  flowOutput.innerHTML = steps
    .map(
      (step, index) => `
        <article class="flow-step ${index === selectedIndex ? "selected-step" : ""}" style="--delay:${index * 45}ms">
          <div class="flow-number">
            ${String(index + 1).padStart(2, "0")}
            <small>LN ${step.lineNumber}</small>
          </div>
          <div class="flow-code">
            <code>${escapeHtml(step.code)}</code>
          </div>
          <div class="flow-explanation">
            <p>${escapeHtml(step.action)}</p>
            <small>${escapeHtml(step.explanation)}</small>
            ${
              step.error
                ? `<small class="step-error>Error: ${escapeHtml(step.error)}</small>`
                : ""
            }
            ${
              step.changed.length
                ? `<span class="changed-tag">updates ${step.changed.join(", ")}</span>`
                : ""
            }
          </div>
        </article>`,
    )
    .join("");
}

function renderSelectedStep() {
  const selectedStep = traceSteps[currentStepIndex];

  if(!selectedStep) {
    return;
  }

  renderState([selectedStep]);
  renderFlow(traceSteps, currentStepIndex);
}

function renderTrace() {
  lineCount.textContent = `${input.value.split(/\r?\n/).length} lines`;
  try {
    traceSteps = traceCode(input.value);
    currentStepIndex = 0;
    renderSelectedStep();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Check your code and try again.";
    stateOutput.innerHTML = `<div class="error-state"><strong>Trace paused</strong><span>${escapeHtml(message)}</span></div>`;
    flowOutput.innerHTML = "";
  }
}

document
  .querySelector<HTMLButtonElement>("#run-button")!
  .addEventListener("click", renderTrace);
document
  .querySelector<HTMLButtonElement>("#sample-button")!
  .addEventListener("click", () => {
    input.value = starterCode;
    renderTrace();
  });
input.addEventListener("input", () => {
  lineCount.textContent = `${input.value.split(/\r?\n/).length} lines`;
});
renderTrace();

const previousButton = document.querySelector<HTMLButtonElement>("#previous-button")!;
const nextButton = document.querySelector<HTMLButtonElement>("#next-button")!;
const autoButton = document.querySelector<HTMLButtonElement>("#auto-button")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-button")!;

previousButton.addEventListener("click", () => {
  if (currentStepIndex > 0) {
    currentStepIndex -= 1;
    renderSelectedStep();
  }
});
nextButton.addEventListener("click", () => {
  if (currentStepIndex < traceSteps.length - 1) {
    currentStepIndex += 1;
    renderSelectedStep();
  }
});
autoButton.addEventListener("click", () => {
  if (autoPlayTimer !== undefined || traceSteps.length === 0) {
      return;
  }
  autoPlayTimer = window.setInterval(() => {
    if (currentStepIndex >= traceSteps.length - 1) {
      pauseAutoPlay();
      return;
    }

    currentStepIndex += 1;
    renderSelectedStep();
  }, 800); 
});
pauseButton.addEventListener("click", pauseAutoPlay);
function pauseAutoPlay() {
  if (autoPlayTimer !== undefined) {
    window.clearInterval(autoPlayTimer);
    autoPlayTimer = undefined;
  }
}