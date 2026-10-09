export type VariableValue =
  | string
  | number
  | boolean
  | null
  | VariableValue[]
  | { [key: string]: VariableValue };

export type TraceStep = {
  lineNumber: number;
  code: string;
  action: string;
  explanation: string;
  error?: string;
  state: Record<string, VariableValue>;
  changed: string[];
};

const clean = (value: string) => value.trim().replace(/;$/, "");

const formatValue = (value: VariableValue): string => {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatValue(item)).join(", ")}]`;
  }
  if (typeof value === "object") {
    return `{ ${Object.entries(value)
      .map(([key, entry]) => `${key}: ${formatValue(entry)}`)
      .join(", ")} }`;
  }
  return String(value);
};

function evaluate(expression: string, state: Record<string, VariableValue>) {
  const names = Object.keys(state);

  try {
    return Function(
      ...names,
      `return (${expression});`,
    )(...names.map((name) => state[name])) as VariableValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown evaluation error";
    throw new Error(`Could not evaluate "${expression}": ${message}`);
  }
}

function snapshot(state: Record<string, VariableValue>) {
  return JSON.parse(JSON.stringify(state)) as Record<string, VariableValue>;
}

function isObject(value: unknown): value is Record<string, VariableValue> {
  return typeof value === "object"  && value !== null && !Array.isArray(value);
}

function findBlockEnd(lines: string[], start: number) {
  let depth = 0;

  for (let index = start; index < lines.length; index += 1) {
    const code = clean(lines[index]);
    if (!code) continue;

    for (const character of code) {
      if (character === "{") {
        depth += 1;
      }
      if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }
  }
  return -1;
}

export function traceCode(source: string): TraceStep[] {
  const lines = source.split(/\r?\n/);
  const state: Record<string, VariableValue> = {};
  const functions: Record<string, { params: string[]; body: string[] }> ={};
  const steps: TraceStep[] = [];
  const output: string[] = [];

  const addStep = (
    lineNumber: number,
    code: string,
    action: string,
    explanation: string,
    changed: string[] = [],
    error?: string,
  ) => {
    steps.push({
      lineNumber,
      code,
      action,
      explanation,
      error,
      state: snapshot(state),
      changed,
    });
  };

  const runFunctionCall = (fnName: string, argsText: string) => {
    if (!functions[fnName]) {
      throw new Error(`Function ${fnName} is not defined yet. Did you forget to write the function above it?`);
    }

    const fn = functions[fnName];
    const args = argsText
      ? argsText.split(",").map((arg) => arg.trim()).filter(Boolean)
      : [];
    const localState: Record<string, VariableValue> = {};

    fn.params.forEach((param, index) => {
      localState[param] = evaluate(args[index] ?? "undefined", state);
    });

    for (const bodyLine of fn.body) {
      const cleanLine = clean(bodyLine);
      if (!cleanLine || cleanLine === "}") continue;

      const resultMatch = cleanLine.match(/^return\s+(.+)$/);
      if (resultMatch) {
        return evaluate(resultMatch[1], { ...state, ...localState });
      }
    }

    throw new Error(`Function ${fnName} did not return a value.`);
  };

  const runRange = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      const code = clean(lines[index]);
      if (!code || code === "}" || code === "else {" || code === "else")
        continue;

      const before = snapshot(state);
      let action = "Read this line.";
      let explanation = "This line does not change the state yet.";
      let errorMessage: string | undefined;
      const declaration = code.match(
        /^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/,
      );
      const increment = code.match(/^([A-Za-z_$][\w$]*)\s*(\+\+|--)$/);
      const assignment = code.match(
        /^([A-Za-z_$][\w$]*)\s*(\+=|-=|\*=|\/=|=)\s*(.+)$/,
      );
      const log = code.match(/^console\.log\((.*)\)$/);
      const functionDeclaration = code.match(
        /^function\s+([A-Za-z_$][\w$]*)\s*\((.*?)\)\s*\{$/
      );
      const functionCall = code.match(
        /^([A-Za-z_$][\w$]*)\s*\((.*)\)$/
      );
      const callAssignment = code.match(
        /^([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\((.*)\)$/
      );
      const arrayLiteral = code.match(/^([A-Za-z_$][\w$]*)\s*=\s*\[(.*)\]$/);
      const objectLiteral = code.match(/^([A-Za-z_$][\w$]*)\s*=\s*\{(.*)\}$/);
      const arrayIndexAssignment = code.match(/^([A-Za-z_$][\w$]*)\s*\[(\d+)\]\s*=\s*(.+)$/);
      const propertyAssignment = code.match(/^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
      const arrayPush = code.match(/^([A-Za-z_$][\w$]*)\.push\((.*)\)$/);
      const arrayPop = code.match(/^([A-Za-z_$][\w$]*)\.pop\(\)$/);

      try {
        if (functionDeclaration) {
          const [, name,paramsText] = functionDeclaration;
          const params = paramsText.split(",").map((param) => param.trim()).filter(Boolean);
          const bodyStart = index + 1;
          const bodyEnd = findBlockEnd(lines, index);

          functions[name] = {
            params,
            body: lines.slice(bodyStart,bodyEnd),
          };

          index = bodyEnd;
          continue;
        } else if (functionCall) {
          const [, name, argsText] = functionCall;
          if (functions[name]) {
            state[name] = runFunctionCall(name, argsText);
            action = `Called ${name}.`;
            explanation = `Executed ${name} and received ${formatValue(state[name])}.`;
          }
        } else if (callAssignment) {
          const [, targetName, fnName, argsText] = callAssignment;
          const functionResult = runFunctionCall(fnName, argsText);
          state[targetName] = functionResult;
          action = `Updated ${targetName}.`;
          explanation = `Called ${fnName} and assigned the return value ${formatValue(functionResult)} to ${targetName}.`;
        } else if (declaration) {
          const [, name, expression] = declaration;
          const directFunctionCall = expression.match(/^([A-Za-z_$][\w$]*)\s*\((.*)\)$/);

          if (directFunctionCall && functions[directFunctionCall[1]]) {
            state[name] = runFunctionCall(directFunctionCall[1], directFunctionCall[2]);
            action = `Created ${name}.`;
            explanation = `Created ${name} and set it to ${formatValue(state[name])}.`;
          } else {
            state[name] = evaluate(expression, state);
            action = `Created ${name}.`;
            explanation = `Created ${name} and set it to ${formatValue(state[name])}.`;
          }
        } else if (increment) {
          const [, name, operator] = increment;
          const beforeValue = state[name];
          if (operator === "++") {
            state[name] = Number(state[name]) + 1;
          }
          if (operator === "--") {
            state[name] = Number(state[name]) - 1;
          }
          action = `Updated ${name}.`;
          explanation = `Increased ${name} from ${formatValue(beforeValue)} to ${formatValue(state[name])}.`;
          if (operator === "--") {
            explanation = `Decreased ${name} from ${formatValue(beforeValue)} to ${formatValue(state[name])}.`;
          }
        } else if (assignment) {
          const [, name, operator, expression] = assignment;
          if (!(name in state)) {
            throw new Error(`"${name}" does not exist yet. Create it before using it.`);
          }
          const beforeValue = state[name];
          const value = evaluate(expression, state);
          if (operator === "=") state[name] = value;
          if (operator === "+=")
            state[name] = Number(state[name]) + Number(value);
          if (operator === "-=")
            state[name] = Number(state[name]) - Number(value);
          if (operator === "*=")
            state[name] = Number(state[name]) * Number(value);
          if (operator === "/=")
            state[name] = Number(state[name]) / Number(value);

          action = `Updated ${name}.`;
          if (operator === "=")
            explanation = `Set ${name} to ${formatValue(state[name])}.`;
          if (operator === "+=")
            explanation = `Added ${formatValue(value)} to ${name}: ${formatValue(beforeValue)} + ${formatValue(value)} = ${formatValue(state[name])}.`;
          if (operator === "-=")
            explanation = `Subtracted ${formatValue(value)} from ${name}: ${formatValue(beforeValue)} - ${formatValue(value)} = ${formatValue(state[name])}.`;
          if (operator === "*=")
            explanation = `Multiplied ${name} by ${formatValue(value)}: ${formatValue(beforeValue)} × ${formatValue(value)} = ${formatValue(state[name])}.`;
          if (operator === "/=")
            explanation = `Divided ${name} by ${formatValue(value)}: ${formatValue(beforeValue)} ÷ ${formatValue(value)} = ${formatValue(state[name])}.`;
        } else if (log) {
          const printedValue = evaluate(log[1], state);
          output.push(String(printedValue));
          action = `Printed ${output[output.length - 1]}.`;
          explanation = `Printed the value of ${log[1]} as ${formatValue(printedValue)}.`;
        } else if (/^if\s*\(/.test(code)) {
          action = "Checked a condition.";
          explanation = `Checked the condition ${code.slice(2, -1)}.`;
        } else if (/^while\s*\(/.test(code)) {
          action = "Checked the loop condition.";
          explanation = `Checked the loop condition ${code.slice(5, -1)}.`;
        } else if (arrayLiteral) {
          const [, name, elementsText] = arrayLiteral;
          const values = elementsText
            ? elementsText
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
                .map((value) => evaluate(value, state))
            : [];
          state[name] = values as VariableValue;
          action = `Created ${name}.`;
          explanation = `Created ${name} and set it to [${values
            .map((value) => formatValue(value))
            .join(", ")}].`;
        } else if (objectLiteral) {
          const [, name, propertiesText] = objectLiteral;
          const objectValue: Record<string, VariableValue> = {};

          if (propertiesText) {
            const entries = propertiesText.split(",");
            for (const entry of entries) {
              const trimmed = entry.trim();
              if (!trimmed) continue;

              const propertyMatch = trimmed.match(
                /^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/,
              );

              if (propertyMatch) {
                const [, key, valueExpression] = propertyMatch;
                objectValue[key] = evaluate(valueExpression, state);
              }
            }
          }

          state[name] = objectValue;
          action = `Created ${name}.`;
          explanation = `Created ${name} with object values.`;
        } else if (arrayIndexAssignment) {
          const [, name, indexText, expression] = arrayIndexAssignment;
          const target = state[name];

          if (!Array.isArray(target)) {
            throw new Error(`${name} is not an array.`);
          }

          const index = Number(indexText);
          const value = evaluate(expression, state);
          target[index] = value;
          state[name] = target;
          action = `Updated ${name}.`;
          explanation = `Set ${name}[${index}] to ${formatValue(value)}.`;
        } else if (propertyAssignment) {
          const [, name, property, expression] = propertyAssignment;
          const target = state[name];

          if (!isObject(target)) {
            throw new Error(`${name} is not an object.`);
          }

          const value = evaluate(expression, state);
          target[property] = value;
          state[name] = target;
          action = `Updated ${name}.`;
          explanation = `Set ${name}.${property} to ${formatValue(value)}.`;
        } else if (arrayPush) {
          const [, name, valueText] = arrayPush;
          const target = state[name];

          if (!Array.isArray(target)) {
            throw new Error(`${name} is not an array.`);
          }

          const value = evaluate(valueText, state);
          target.push(value);
          state[name] = target;
          action = `Updated ${name}.`;
          explanation = `Added ${formatValue(value)} to the end of ${name}.`;
        } else if (arrayPop) {
          const [, name] = arrayPop;
          const target = state[name];

          if (!Array.isArray(target)) {
            throw new Error(`${name} is not an array.`);
          }

          const removed = target.pop() ?? null;
          state[name] = target;
          action = `Updated ${name}.`;
          explanation = `Removed ${formatValue(removed)} from the end of ${name}.`;
        } else {
          action = "Unsupported line.";
          explanation = "This line is not supported by this kind of JavaScript yet.";
          errorMessage = "Unsupported JavaScript syntax.";
        }
      } catch (caught) {
        const reason = caught instanceof Error ? caught.message : "Unknown error";

        action = "Could not evaluate this line.";
        errorMessage = reason;
        explanation = 
          `This line failed because: ${reason}.` +
          `Check the syntax, variable names and wether the variable was created earlier.`;
      }

      const changed = Object.keys(state).filter((key) => before[key] !== state[key]);
      addStep(index + 1, code, action, explanation, changed, errorMessage);
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const code = clean(lines[index]);
    if (!code) continue;

    const functionDeclaration = code.match(
      /^function\s+([A-Za-z_$][\w$]*)\s*\((.*?)\)\s*\{$/,
    );
    if (functionDeclaration) {
      const [, name, paramsText] = functionDeclaration;
      const params = paramsText
        .split(",")
        .map((param) => param.trim())
        .filter(Boolean);
      const bodyEnd = findBlockEnd(lines, index);

      functions[name] = {
        params,
        body: lines.slice(index + 1, bodyEnd),
      };

      index = bodyEnd;
      continue;
    }

    const ifMatch = code.match(/^if\s*\((.*)\)\s*\{$/);
    if (ifMatch) {
      const ifEnd = findBlockEnd(lines, index);
      if (ifEnd === -1) {
        throw new Error(
          `The if statement of line ${index + 1} needs a closing brace.`,
        );
      }

      const conditionResult = Boolean(evaluate(ifMatch[1], state));
      const action = conditionResult
        ? "Condition was true, so the if branch ran."
        : "Condition was false, so the if branch was skipped.";
      const explanation = `Checked whether ${ifMatch[1]} and found it to be ${conditionResult ? "true" : "false"}.`;

      addStep(index + 1, code, action, explanation, []);

      if (conditionResult) {
        runRange(index + 1, ifEnd);
        index = ifEnd;
        continue;
      }

      let cursor = ifEnd + 1;
      while (cursor < lines.length && !clean(lines[cursor])) {
        cursor += 1;
      }

      let matchedBranch = false;
      while (cursor < lines.length) {
        const nextCode = clean(lines[cursor]);
        const elseIfMatch = nextCode.match(/^else\s+if\s*\((.*)\)\s*\{$/);
        if (!elseIfMatch) break;

        const elseIfEnd = findBlockEnd(lines, cursor);
        if (elseIfEnd === -1) {
          throw new Error(
            `The else if statement of line ${cursor + 1} needs a closing brace.`,
          );
        }

        const elseIfResult = Boolean(evaluate(elseIfMatch[1], state));
        const action = elseIfResult
          ? "Condition was true, so the else if branch ran."
          : "Condition was false, so the else if branch was skipped.";
        const explanation = `Checked whether ${elseIfMatch[1]} and found it to be ${elseIfResult ? "true" : "false"}.`;

        addStep(cursor + 1, nextCode, action, explanation, []);

        if (elseIfResult) {
          runRange(cursor + 1, elseIfEnd);
          index = elseIfEnd;
          matchedBranch = true;
          break;
        }

        cursor = elseIfEnd + 1;
        while (cursor < lines.length && !clean(lines[cursor])) {
          cursor += 1;
        }
      }

      if (matchedBranch) {
        continue;
      }

      const elseCode = clean(lines[cursor] ?? "");
      if (/^else\s*\{$/.test(elseCode)) {
        const elseEnd = findBlockEnd(lines, cursor);
        if (elseEnd === -1) {
          throw new Error(
            `The else statement of line ${cursor + 1} needs a closing brace.`,
          );
        }

        addStep(
          cursor + 1,
          elseCode,
          "Condition was false, so the else branch ran.",
          "The earlier condition was false, so the else block executed instead.",
          [],
        );
        runRange(cursor + 1, elseEnd);
        index = elseEnd;
      }

      continue;
    }

    const whileMatch = code.match(/^while\s*\((.*)\)\s*\{$/);
    if (whileMatch) {
      const blockEnd = findBlockEnd(lines, index);
      if (blockEnd === -1) {
        throw new Error(`The loop on line ${index + 1} needs a closing brace.`);
      }

      const condition = whileMatch[1];
      let guard = 0;
      while (Boolean(evaluate(condition, state)) && guard < 100) {
        addStep(
          index + 1,
          code,
          "Condition was true, so the while loop body ran.",
          `Checked whether ${condition} and found it to be true; the loop body ran again.`,
          [],
        );
        runRange(index + 1, blockEnd);
        guard += 1;
      }
      index = blockEnd;
      continue;
    }

    const loop = code.match(/^for\s*\((.*);\s*(.*);\s*(.*)\)\s*\{$/);
    if (loop) {
      const blockEnd = findBlockEnd(lines, index);
      if (blockEnd === -1)
        throw new Error(`The loop on line ${index + 1} needs a closing brace.`);
      const [initial, condition, update] = loop.slice(1);
      const declaration = initial.match(
        /^(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/,
      );
      if (declaration) state[declaration[1]] = evaluate(declaration[2], state);

      let guard = 0;
      while (Boolean(evaluate(condition, state)) && guard < 100) {
        addStep(
          index + 1,
          code,
          "Condition was true, so the for loop body ran.",
          `Checked whether ${condition} and found it to be true; the loop body ran again.`,
          [],
        );
        runRange(index + 1, blockEnd);

        const updateMatch = update.match(/^([\w$]+)(\+\+|--|\+=|-=)(.*)$/);
        if (updateMatch) {
          const [, name, operator, amount] = updateMatch;
          if (operator === "++") state[name] = Number(state[name]) + 1;
          if (operator === "--") state[name] = Number(state[name]) - 1;
          if (operator === "+=")
            state[name] = Number(state[name]) + Number(evaluate(amount, state));
          if (operator === "-=")
            state[name] = Number(state[name]) - Number(evaluate(amount, state));
        }
        guard += 1;
      }
      index = blockEnd;
      continue;
    }

    runRange(index, index + 1);
  }

  return steps;
}
