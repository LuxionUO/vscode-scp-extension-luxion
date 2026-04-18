const vscode = require('vscode');

/** @typedef {{name:string, start:number, end:number, params:string[], locals:string[], source:string}} FunctionInfo */

let functionIndex = [];
let allLocalNames = new Set();
let cacheDirty = true;

function parseFunctionsFromText(text, source) {
  const functions = [];
  const sectionRegex = /^\[([^\]\r\n]+)\]/gim;
  const sections = [];
  let match;

  while ((match = sectionRegex.exec(text))) {
    sections.push({
      title: match[1].trim(),
      start: match.index,
      headerEnd: sectionRegex.lastIndex
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextStart = i + 1 < sections.length ? sections[i + 1].start : text.length;
    const body = text.slice(section.headerEnd, nextStart);
    const functionMatch = /^FUNCTION\s+(.+)$/i.exec(section.title);
    if (!functionMatch) {
      continue;
    }

    const name = functionMatch[1].trim();
    const paramMap = new Map();
    const locals = new Set();

    const argvRegex = /local\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*<argv\[(\d+)\]>/gi;
    let argvMatch;
    while ((argvMatch = argvRegex.exec(body))) {
      const localName = argvMatch[1];
      const argIndex = Number(argvMatch[2]);
      locals.add(localName);
      if (!Number.isNaN(argIndex) && !paramMap.has(argIndex)) {
        paramMap.set(argIndex, localName);
      }
    }

    const localRegex = /local\.([A-Za-z_][A-Za-z0-9_]*)/gi;
    let localMatch;
    while ((localMatch = localRegex.exec(body))) {
      locals.add(localMatch[1]);
    }

    const params = [...paramMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value);

    functions.push({
      name,
      start: section.start,
      end: nextStart,
      params,
      locals: [...locals],
      source
    });
  }

  return functions;
}

async function rebuildIndex() {
  if (!cacheDirty) {
    return;
  }

  const files = await vscode.workspace.findFiles('**/*.scp', '**/{.git,node_modules}/**');
  const nextFunctions = [];
  const nextLocalNames = new Set();

  for (const file of files) {
    try {
      const doc = await vscode.workspace.openTextDocument(file);
      const parsed = parseFunctionsFromText(doc.getText(), file.fsPath);
      parsed.forEach((fn) => {
        nextFunctions.push(fn);
        fn.locals.forEach((name) => nextLocalNames.add(name));
      });
    } catch {
      // Ignore file read errors and continue indexing.
    }
  }

  functionIndex = nextFunctions;
  allLocalNames = nextLocalNames;
  cacheDirty = false;
}

function markDirty() {
  cacheDirty = true;
}

function getCurrentFunction(document, offset) {
  const parsed = parseFunctionsFromText(document.getText(), document.uri.fsPath);
  return parsed.find((fn) => offset >= fn.start && offset <= fn.end);
}

function createFunctionCompletion(fn) {
  const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
  if (fn.params.length > 0) {
    item.insertText = new vscode.SnippetString(
      `${fn.name} ${fn.params.map((param, index) => `\${${index + 1}:${param}}`).join(', ')}`
    );
    item.detail = `${fn.name}(${fn.params.join(', ')})`;
  } else {
    item.insertText = fn.name;
    item.detail = `${fn.name}()`;
  }
  item.documentation = `Definita in: ${fn.source}`;
  return item;
}

async function provideCompletionItems(document, position) {
  await rebuildIndex();

  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const items = [];

  if (/local\.[A-Za-z0-9_]*$/i.test(linePrefix)) {
    const currentOffset = document.offsetAt(position);
    const currentFunction = getCurrentFunction(document, currentOffset);
    const localNames = new Set([...(currentFunction?.locals ?? []), ...allLocalNames]);
    localNames.forEach((name) => {
      const localItem = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
      localItem.insertText = name;
      items.push(localItem);
    });
    return items;
  }

  functionIndex.forEach((fn) => {
    items.push(createFunctionCompletion(fn));
  });

  return items;
}

function activate(context) {
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: 'scp' },
    { provideCompletionItems },
    '.',
    '_'
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.scp');
  watcher.onDidChange(markDirty);
  watcher.onDidCreate(markDirty);
  watcher.onDidDelete(markDirty);

  const closeDocListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === 'scp') {
      markDirty();
    }
  });

  context.subscriptions.push(completionProvider, watcher, closeDocListener);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
