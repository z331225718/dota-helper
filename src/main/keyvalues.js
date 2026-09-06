'use strict';

function tokenizeKeyValues(text) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      index = text.indexOf('\n', index + 2);
      if (index === -1) break;
      continue;
    }
    if (char === '{' || char === '}') {
      tokens.push(char);
      index += 1;
      continue;
    }
    if (char !== '"') {
      index += 1;
      continue;
    }

    let value = '';
    index += 1;
    while (index < text.length && text[index] !== '"') {
      if (text[index] === '\\' && index + 1 < text.length) {
        index += 1;
        value += text[index];
      } else {
        value += text[index];
      }
      index += 1;
    }
    if (text[index] === '"') index += 1;
    tokens.push(value);
  }

  return tokens;
}

function appendValue(target, key, value) {
  if (!Object.hasOwn(target, key)) {
    target[key] = value;
  } else if (Array.isArray(target[key])) {
    target[key].push(value);
  } else {
    target[key] = [target[key], value];
  }
}

function parseKeyValues(text) {
  const tokens = tokenizeKeyValues(String(text ?? ''));
  let index = 0;

  function parseObject(expectClose = false) {
    const result = {};
    while (index < tokens.length) {
      const key = tokens[index];
      index += 1;
      if (key === '}') {
        if (!expectClose) throw new Error('Unexpected closing brace in KeyValues data');
        return result;
      }
      if (key === '{') throw new Error('Unexpected opening brace in KeyValues data');

      const token = tokens[index];
      index += 1;
      if (token === undefined) throw new Error(`Missing value for KeyValues key: ${key}`);
      const value = token === '{' ? parseObject(true) : token;
      appendValue(result, key, value);
    }
    if (expectClose) throw new Error('Missing closing brace in KeyValues data');
    return result;
  }

  return parseObject();
}

module.exports = { parseKeyValues, tokenizeKeyValues };
