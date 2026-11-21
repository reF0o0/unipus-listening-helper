// ==UserScript==
// @name         U校园听力助手
// @namespace    local.u-campus.listening
// @version      0.1.5
// @description  自动填写并切换本课程的教材听力练习
// @match        https://ucontent.unipus.cn/_pc_default/pc.html*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const courseRoute = /^#\/course-v1:Unipus\+nhce_3_vls_1_sz\+2021_08\/courseware\/u([1-8])\//;
  const sectionTitle = /^[1-8]-(?:2 Sharing|3 Listening|4 Viewing|8 More practice in listening)$/i;
  const lectureTabs = '#header ul.TabsBox a.topTab';
  const numberedTabs = '#header [class*="circleTabsBox"] a';
  const submitBar = '[class*="submit-bar-pc--container"]';
  const storageKey = 'local.u-campus.listening.1063529.v1';
  const transcriptUrl = 'https://news.culr.edu.cn/wyx/docs/2017-03/20170326101926785482.pdf';
  const scoreReceipt = /本次共完成\s*\d+\s*道题[，,]\s*平均分为\s*\d+/;
  const rateNotice = /操作(?:过于|太)频繁|请休息几分钟后再继续学习/;
  const attentionLabels = new Map([
    ['pending', '待确认'], ['failed', '未完成'], ['rate-limited', '限频'], ['recording', '待录音'],
  ]);

  // Unit 1 answers checked against the public course transcript, then keyed by visible text.
  const carlosOrder = [
    'He was born and grew up in Havana.',
    'He often missed school.',
    'He was a champion breakdancer in the streets.',
    'His father sent him to a ballet school.',
    'He saw the Cuban National Ballet.',
    'He traveled to Europe for the first time.',
    'He won four major dance competitions.',
    'He became famous all over the world.',
  ];
  const blanks = [
    [/cuba is always going to be my.*generation to generation/, ['home', 'country', 'relatives', 'foreigner', 'speak', 'passed on', 'heat', 'sea', 'happiness']],
    [/baruti was born in the year.*opened an orphanage in/, ['1962', 'fourth', '1990', '1996']],
    [/baruti was born in johannesburg.*long walk to freedom/, ['teacher', 'cleaned houses', 'lost', 'visited', 'work', 'his wife', 'in his own words']],
    [/i have a 1 social life.*old friend from.*do you go out a lot/, ['busy', 'friends', 'university', 'social life']],
    [/went to a club.*westfield shopping center.*south london/, ['danced', 'view', 'fun', 'drink', 'west', 'delicious meal', 'house', 'TV']],
    [/so many changes when a person comes to college.*(parents around|college life)/, ['programmes', 'very', 'decisions', 'doing laundry', 'Obviously', 'choices', 'ruining', 'get used to', 'opportunities', 'step back']],
  ];
  const audioChoices = {
    u1g56: [
      ['at home'],
      ['very few people know', 'few people know', 'not well known', 'not known by many', 'a small part of the public'],
      ['original', 'different from other films'],
      ['light bulb'],
      ['forgot some of his lines', 'did not remember all his lines', 'didn t remember all his lines', 'forgot his lines'],
    ],
  };

  function normalize(text) {
    return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function isCourse(url) {
    return url.origin === 'https://ucontent.unipus.cn' &&
      url.pathname === '/_pc_default/pc.html' &&
      url.searchParams.get('cid') === '1063529' &&
      courseRoute.test(url.hash);
  }

  function shuffled(items, random = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function sequenceAnswer(labels, context, fixed = [], random = Math.random) {
    const current = labels.map(normalize);
    const known = carlosOrder.map(normalize);
    if (/events in carlos acosta s life/.test(normalize(context)) &&
        current.length === known.length && known.every(label => current.includes(label)) &&
        fixed.every(index => current[index] === known[index])) {
      return { order: known, guessed: false };
    }
    const movable = shuffled(current.filter((_, index) => !fixed.includes(index)), random);
    return { order: current.map((label, index) => fixed.includes(index) ? label : movable.shift()), guessed: true };
  }

  function fieldAnswer(context, nearby, index, count) {
    const fullText = normalize(context);
    const matched = blanks.find(([pattern, values]) => values.length === count && pattern.test(fullText));
    if (matched) return { text: matched[1][index], guessed: false };
    const before = normalize(nearby);
    let text = 'something';
    if (/\b(?:in the year|born in|married in|opened in)$/.test(before)) text = '2000';
    else if (/\b(?:how many|for|about) (?:\w+ ){0,2}$/.test(before)) text = 'two';
    else if (/\b(?:they|we) were$/.test(before)) text = 'happy';
    else if (/\b(?:to|can|could|would|should)$/.test(before)) text = 'help';
    else if (/\ba$/.test(before)) text = 'friend';
    return { text, guessed: true };
  }

  function choiceIndexes(labels, hints, count, random = Math.random) {
    const normalized = labels.map(normalize);
    const matches = normalized.flatMap((label, index) => hints.some(hint => {
      const phrase = normalize(hint);
      return phrase && (' ' + label + ' ').includes(' ' + phrase + ' ');
    }) ? [index] : []);
    if (matches.length === count) return { indexes: matches, guessed: false };
    const remaining = normalized.map((_, index) => index).filter(index => !matches.includes(index));
    const indexes = [...matches, ...shuffled(remaining, random)].slice(0, count).sort((a, b) => a - b);
    return { indexes, guessed: true };
  }

  function receiptState({ pageClass = '', info = '', modal = '', hasSubmit = false }) {
    const statusText = [info, modal].join(' ').trim();
    if (rateNotice.test(statusText)) return 'rate-limited';
    if (/还有\s*\d+\s*道题没有作答/.test(statusText)) return 'incomplete';
    if (/尚未提交|仍未提交|提交未受理|本次答案未提交/.test(statusText)) return 'rejected';
    if (scoreReceipt.test(modal) ||
        /(?:已经|成功)提交|提交成功|^已提交(?:$|[：:\s])|已完成作答/.test(statusText)) return 'confirmed';
    if (pageClass.split(/\s+/).some(name => /^(?:compelet(?:ed)?|complet(?:e|ed)|yiwancheng)$/i.test(name))) {
      return 'already';
    }
    if (!hasSubmit && /提交时间|本次得分|答题结果|成绩[:：]|\d+\s*分/.test(info)) return 'confirmed';
    return 'unknown';
  }

  function visible(el) {
    return Boolean(el?.isConnected && el.getClientRects().length &&
      !el.closest('[hidden],[aria-hidden="true"]'));
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = {
      normalize, isCourse, sequenceAnswer, fieldAnswer, choiceIndexes,
      receiptState, visible,
    };
    return;
  }

  if (window.top !== window || !isCourse(new URL(location.href))) return;

  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const shown = (selector, root) => all(selector, root).filter(visible);
  const text = el => (el?.innerText ?? el?.textContent ?? '').trim();
  const pageRoot = () => document.querySelector('#pageLayout');
  const activeSection = () => all('li.active.courseware a[title]').find(el => sectionTitle.test(el.title));
  const activeLesson = () => all(lectureTabs).find(el => el.closest('li')?.classList.contains('active'));
  const activeCircle = () => document.querySelector(numberedTabs + '.selected');
  const sectionLinks = () => all('li.courseware a[title]').filter(el => sectionTitle.test(el.title));
  const stepLabel = () => text(document.querySelector('#pageLayout [class*="pclayout--step-"]')) || '1/1';
  const baseHash = () => location.hash.replace(/\/(?:__main|p_\d+)$/, '');
  const unitOfHash = hash => courseRoute.exec(hash)?.[1] ?? '';
  const answerLeaf = () => baseHash().split('/').at(-1);
  const sameCourse = () => isCourse(new URL(location.href));
  const button = label => shown(submitBar + ' button').find(el => text(el) === label && !el.disabled);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  let controller;
  let currentMode;
  let currentUnit;
  let state;
  let panelMessage;
  let attentionSummary;
  let attentionList;
  let buttons;
  let resumeTimer;

  function load() {
    const defaults = { fillOnly: true, auto: false, section: '', unitSections: {}, visits: {}, records: {} };
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if (cached.fillOnly) return { ...defaults, ...cached };
      return { ...defaults, ...cached, fillOnly: true, auto: false, section: '',
        unitSections: {}, visits: {} };
    } catch {
      return defaults;
    }
  }

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function saveRecord(key, record) {
    state.records[key] = { ...state.records[key], ...record, hash: location.hash };
    persist();
  }

  function setSectionCursor(title) {
    if (currentUnit) {
      if (title) state.unitSections[currentUnit] = title;
      else delete state.unitSections[currentUnit];
    } else {
      state.section = title;
    }
  }

  function renderAttention() {
    const records = Object.values(state.records).filter(record => attentionLabels.has(record.state));
    attentionSummary.textContent = '待处理（' + records.length + '）';
    panelMessage.title = records.map(record => record.label + '：' + record.message).join('\n');
    attentionList.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('li');
      empty.textContent = '暂无待处理任务';
      attentionList.append(empty);
      return;
    }

    for (const record of records) {
      const row = document.createElement('li');
      const openPage = document.createElement('button');
      openPage.type = 'button';
      openPage.textContent = attentionLabels.get(record.state) + ' · ' + (record.label || '课件页');
      openPage.disabled = Boolean(controller) || !courseRoute.test(record.hash ?? '');
      openPage.style.cssText = 'text-align:left;max-width:100%;overflow-wrap:anywhere';
      openPage.addEventListener('click', () => {
        if (!controller && sameCourse() && courseRoute.test(record.hash ?? '')) location.hash = record.hash;
      });
      row.append(openPage);
      if (record.message) {
        const reason = document.createElement('div');
        reason.textContent = record.message;
        row.append(reason);
      }
      attentionList.append(row);
    }
  }

  function summarize(prefix) {
    const records = Object.values(state.records);
    const counts = records.reduce((totals, record) => {
      totals[record.state] = (totals[record.state] || 0) + 1;
      totals.guessed += record.guessed ?? 0;
      return totals;
    }, { guessed: 0 });
    panelMessage.textContent = prefix + ' | 已确认 ' + (counts.confirmed ?? 0) +
      ' · 已填写 ' + (counts.draft ?? 0) +
      ' · 猜填 ' + counts.guessed + ' · 待确认 ' + (counts.pending ?? 0) +
      ' · 未完成 ' + (counts.failed ?? 0) +
      ' · 待录音 ' + (counts.recording ?? 0) +
      ((counts['rate-limited'] ?? 0) ? ' · 限频 ' + counts['rate-limited'] : '');
    renderAttention();
  }

  function taskLabel() {
    return [activeSection()?.title, text(activeLesson()), text(activeCircle())].filter(Boolean).join(' / ');
  }

  function visibleDialogs() {
    return shown('[class*="dialog-header-pc--dialog-header"]').flatMap(header =>
      header.parentElement ? [header.parentElement] : []);
  }

  function dismissStudyNotice(includeRecorderError = false) {
    if (!sameCourse()) return false;
    const dialogs = visibleDialogs().reverse();
    const notice = dialogs.find(node => {
      if (/操作(?:过于|太)频繁|提交失败|确认要提交|平均分为/.test(text(node))) return false;
      const isStudyTip = shown('[class*="taskTipStyle--tipBody"]', node)
        .some(line => /^(?:本单元学习时间|是否必修)\s*[：:]/.test(text(line)));
      return isStudyTip || (includeRecorderError && /^录音机初始化错误/.test(text(node)));
    });
    const ok = notice && shown('button', notice).find(el => text(el) === '确定' && !el.disabled);
    if (ok) ok.click();
    return Boolean(ok);
  }

  function inspectReceipt() {
    return receiptState({
      pageClass: activeCircle()?.className,
      info: shown('[class*="submit-bar-pc--submit-info"]').map(text).join(' '),
      modal: visibleDialogs().map(text).join(' '),
      hasSubmit: Boolean(button('提交')),
    });
  }

  const ratePauseMessage = '平台限频，已暂停';
  const rateLimitDialog = () => visibleDialogs().reverse().find(node => rateNotice.test(text(node)));

  function cooldownStatus() {
    if (state.resumePlan) {
      if (location.hash !== state.resumePlan.hash) return '平台限频，返回原页后可自动继续';
      return '平台限频，等待结束后自动继续一次';
    }
    return state.rateRecoveryUsed ? '平台再次限频，已停止自动继续' : ratePauseMessage;
  }

  function scheduleResume() {
    clearTimeout(resumeTimer);
    if (controller) return;
    const plan = state.resumePlan;
    buttons.stop.disabled = !plan;
    if (!plan || location.hash !== plan.hash) return;
    resumeTimer = setTimeout(() => {
      if (panelMessage.isConnected) void start(plan.mode, plan);
    }, Math.max(0, plan.after - Date.now()));
  }

  function pauseForRateLimit() {
    const key = baseHash();
    const previous = state.records[key];
    const section = activeSection()?.title;
    if (section) {
      setSectionCursor(section);
      delete state.visits[section];
    }
    state.auto = false;
    state.resumeAfter = Date.now() + 5 * 60 * 1000;
    state.resumePlan = state.rateRecoveryUsed ? null : {
      hash: location.hash, mode: currentMode, unit: currentUnit, after: state.resumeAfter,
    };
    if (previous?.state === 'confirmed') persist();
    else saveRecord(key, { label: taskLabel(), state: 'rate-limited', message: cooldownStatus() });
    controller.abort(ratePauseMessage);
  }

  function pageBlocked() {
    if (controller.signal.aborted) return true;
    if (rateLimitDialog()) {
      pauseForRateLimit();
      return true;
    }
    if (!visibleDialogs().length) return false;
    controller.abort('平台有提示需要处理，已停在原页');
    return true;
  }

  async function until(predicate, timeout = 12000, signal = controller?.signal) {
    const end = Date.now() + timeout;
    do {
      if (signal?.aborted || !sameCourse()) return false;
      const result = predicate();
      if (result) return result;
      await delay(180);
    } while (Date.now() < end);
    return false;
  }

  async function stablePage(signal) {
    let last = '';
    let since = 0;
    return until(() => {
      if (dismissStudyNotice(true)) return false;
      if (pageBlocked()) return false;
      const root = pageRoot();
      if (!visible(root) || /\/__main$/.test(location.hash)) return false;
      const snapshot = location.hash + '|' + stepLabel() + '|' + root.childElementCount + '|' + text(root).slice(0, 100);
      if (snapshot !== last) {
        last = snapshot;
        since = Date.now();
      }
      return Date.now() - since >= 540;
    }, 16000, signal);
  }

  async function navigate(control, signal, readTarget = () => location.hash + '|' + stepLabel()) {
    if (!visible(control) || control.disabled || control.closest('[aria-disabled="true"]') || signal.aborted || pageBlocked()) return false;
    const before = readTarget();
    control.click();
    return Boolean(await until(() => {
      if (dismissStudyNotice(true) || pageBlocked()) return false;
      return readTarget() !== before;
    }, 7500, signal) && await stablePage(signal));
  }

  function writeText(el, value) {
    el.focus({ preventScroll: true });
    if (el.ownerDocument.activeElement !== el) return false;
    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) return false;
    if (el.value !== value) {
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // FillBlankInput keeps edits locally until its blur handler commits them.
    el.blur();
    return el.isConnected && el.value === value;
  }

  function choiceGroups(root) {
    const containers = shown('ul[class*="choice--options"]', root);
    return containers.flatMap(container => {
      const inputs = shown('input[type="radio"],input[type="checkbox"]', container);
      return inputs.length ? [inputs] : [];
    });
  }

  function choiceLabel(input) {
    const label = input.closest('label');
    return text(label?.querySelector('[class*="choice--content"]') ?? label)
      .replace(/^[A-Z]\s*[.)]\s*/, '');
  }

  function pickCount(inputs, context) {
    if (inputs[0].type === 'radio') return 1;
    const joined = normalize(text(inputs[0].closest('ul')?.parentElement) + ' ' + context);
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const raw = /(?:select|choose|tick|check) (?:the )?(\d+|one|two|three|four|five|six)\b/.exec(joined)?.[1] ??
      /(?:选择|选出)\s*([一二两三四五六\d]+)\s*(?:项|个)/.exec(context)?.[1];
    const count = Number(raw) || words[raw] || 1;
    return Math.min(count, inputs.length);
  }

  function cardText(card) {
    return normalize(text(card.querySelector('[class*="caption-item"] + .html-view')) ||
      text(card).replace(/^[A-Z]\s*[.)]\s*/, ''));
  }

  function readCards(table) {
    return shown('[class*="sequence-pc-card--item"]', table);
  }

  async function dragTo(source, target, fromBelow) {
    const dataTransfer = new DataTransfer();
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const x = targetBox.left + targetBox.width / 2;
    const y = targetBox.top + targetBox.height * (fromBelow ? 0.24 : 0.76);
    const send = (node, event, clientX = x, clientY = y) => node.dispatchEvent(new DragEvent(event, {
      bubbles: true, cancelable: true, dataTransfer, clientX, clientY,
    }));
    send(source, 'dragstart', sourceBox.left + sourceBox.width / 2, sourceBox.top + sourceBox.height / 2);
    // The course player initializes its drag preview on the source's drag event.
    send(source, 'drag');
    send(target, 'dragenter');
    send(target, 'dragover');
    await delay(40);
    if (target.isConnected) send(target, 'drop');
    if (source.isConnected) send(source, 'dragend');
  }

  async function fillSequence(table, context, signal, remembered, remember, interrupted) {
    const cards = readCards(table);
    if (cards.length < 2) return { verified: false, guessed: 0 };
    const captions = cards.map(card => normalize(text(card.querySelector('[class*="caption-item"]'))));
    if (!remembered && !interrupted && captions.every(label => /^[a-z]$/.test(label)) &&
        captions.join('') !== [...captions].sort().join('')) {
      return { verified: true, guessed: 0 };
    }
    const fixed = cards.flatMap((card, index) => card.draggable ? [] : [index]);
    const labels = cards.map(cardText);
    if (labels.some(label => !label) || new Set(labels).size !== labels.length) return { verified: false, guessed: 0 };
    const hasSameCards = remembered?.order?.length === labels.length &&
      labels.every(label => remembered.order.includes(label)) &&
      fixed.every(index => labels[index] === remembered.order[index]);
    const planned = hasSameCards ? remembered : sequenceAnswer(labels, context, fixed);
    remember(planned);
    for (let index = 0; index < planned.order.length; index++) {
      if (signal.aborted || pageBlocked()) return { verified: false, guessed: 0 };
      const current = readCards(table);
      const from = current.findIndex(card => cardText(card) === planned.order[index]);
      if (from === index) continue;
      if (from < 0 || !current[from].draggable || !current[index]?.draggable) return { verified: false, guessed: 0 };
      await dragTo(current[from], current[index], from > index);
      const changed = await until(() => {
        const card = readCards(table)[index];
        return card && cardText(card) === planned.order[index];
      }, 1100, signal);
      if (!changed) return { verified: false, guessed: 0 };
    }
    return {
      verified: readCards(table).map(cardText).join('|') === planned.order.join('|'),
      guessed: Number(planned.guessed),
    };
  }

  function listeningPage(root) {
    return Boolean(root && shown('video,[class*="audio--aplayer"]', root).length);
  }

  async function fillPage(root, signal, sequencePlans, rememberSequence, interrupted) {
    const context = text(root);
    const choice = choiceGroups(root);
    const fields = shown('input[class*="fill-blank--"],textarea.scoopFill_textarea', root)
      .filter(el => !el.disabled && !el.readOnly);
    const tables = shown('table[class*="sequence-table"]', root);
    const selects = shown('select', root).filter(el => !el.disabled && !el.closest('.video-js'));
    const usedInputs = new Set([...choice.flat(), ...fields, ...selects]);
    const unknown = shown('input:not([type="hidden"]),textarea,select,[draggable="true"]', root)
      .some(el => !el.disabled && !el.readOnly && !usedInputs.has(el) &&
        !el.closest('.video-js, [class*="audio--aplayer"], table[class*="sequence-table"]'));
    const total = choice.length + fields.length + tables.length + selects.length;
    let guessed = 0;
    let verified = !unknown;
    const step = Number(stepLabel().split('/')[0]) || 1;

    for (const [index, inputs] of choice.entries()) {
      if (signal.aborted || pageBlocked()) return { total, guessed, verified: false };
      if (inputs.some(input => input.checked)) continue;
      const hints = audioChoices[answerLeaf()]?.[step - 1 + index] ?? [];
      const result = choiceIndexes(inputs.map(choiceLabel), hints, pickCount(inputs, context));
      for (const selected of result.indexes) inputs[selected].click();
      verified = result.indexes.every(selected => inputs[selected].checked) && verified;
      guessed += Number(result.guessed);
    }

    for (const [index, input] of fields.entries()) {
      if (signal.aborted || pageBlocked()) return { total, guessed, verified: false };
      if (input.value.trim()) {
        verified = writeText(input, input.value) && verified;
        continue;
      }
      const nearby = input.previousSibling?.textContent ??
        input.parentElement?.previousSibling?.textContent ?? context;
      let result = fieldAnswer(context, nearby, index, fields.length);
      if (/write down its general idea/.test(normalize(context)) && answerLeaf() === 'u1g6') {
        result = { text: 'Hina asks people about their social lives and what they did the night before.', guessed: false };
      }
      verified = writeText(input, result.text) && verified;
      guessed += Number(result.guessed);
    }

    const used = new Set(selects.filter(el => el.value).map(el => el.value));
    for (const select of selects) {
      if (signal.aborted || pageBlocked()) return { total, guessed, verified: false };
      if (select.value) continue;
      const options = [...select.options].filter(option => !option.disabled && option.value);
      const option = shuffled(options.filter(item => !used.has(item.value)))[0];
      if (!option) { verified = false; continue; }
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      used.add(option.value);
      verified = (select.value === option.value) && verified;
      guessed++;
    }

    for (const [index, table] of tables.entries()) {
      const result = await fillSequence(table, context, signal, sequencePlans[index],
        plan => rememberSequence(index, plan), interrupted);
      verified = result.verified && verified;
      guessed += result.guessed;
    }
    return { total, guessed, verified };
  }

  async function processLeaf(signal) {
    const key = baseHash();
    const label = taskLabel();
    let record = state.records[key] ?? { label, guessed: 0 };
    const save = update => {
      record = { ...record, ...update, label };
      saveRecord(key, record);
    };
    if (pageBlocked()) return 'stopped';
    if (record.state === 'confirmed') return 'confirmed';
    if (['confirmed', 'already'].includes(inspectReceipt())) {
      save({ state: 'confirmed', message: '平台已确认' });
      return 'confirmed';
    }

    for (let step = 0; step < 40 && !signal.aborted; step++) {
      if (baseHash() !== key || !sameCourse()) return 'moved';
      const root = pageRoot();
      if (root && (shown('[class*="sentencesToRead--record-wrap"]', root).length ||
          /Repeat and learn to use them|To start recording, click/i.test(text(root)))) {
        save({ state: 'recording', message: '待录音，请在课程页使用麦克风完成跟读' });
        return 'recording';
      }
      if (!listeningPage(root)) return 'outside';
      const stepName = stepLabel();
      const sequencePlans = { ...record.sequencePlans?.[stepName] };
      const interrupted = record.state === 'failed' && answerLeaf() === 'u1g26';
      const result = await fillPage(root, signal, sequencePlans, (index, plan) => {
        sequencePlans[index] = plan;
        save({ state: 'progress', sequencePlans: { ...record.sequencePlans, [stepName]: sequencePlans } });
      }, interrupted);
      if (signal.aborted || pageBlocked()) return 'stopped';
      if (baseHash() !== key) return 'moved';
      const next = button('下一题');
      if (!result.total && result.verified && !button('提交') && !next) {
        save({ state: 'reference', message: '本页没有可填写的练习' });
        return 'outside';
      }
      if (!result.total || !result.verified) {
        save({ state: 'failed', message: result.total ? '题目控件未能读回所填答案' : '未发现可填写的听力题控件' });
        return 'failed';
      }
      const stepNotes = { ...record.stepNotes, [stepName]: result.guessed || record.stepNotes?.[stepName] || 0 };
      save({
        state: next ? 'progress' : 'draft',
        stepNotes,
        guessed: Object.values(stepNotes).reduce((a, b) => a + b, 0),
        message: next ? '正在填写' : '已填写，提交状态以平台为准',
      });
      if (!next) return 'draft';
      if (!await navigate(next, signal)) {
        if (signal.aborted) return 'stopped';
        save({ state: 'failed', message: '未能进入本组下一题' });
        return 'failed';
      }
    }
    if (!signal.aborted) save({ state: 'failed', message: '本组题数超出导航上限' });
    return signal.aborted ? 'stopped' : 'failed';
  }

  function nextCircle() {
    const pages = shown(numberedTabs);
    const current = pages.findIndex(el => el.classList.contains('selected'));
    return current >= 0 ? pages[current + 1] : undefined;
  }

  function nextLesson() {
    const tabs = shown(lectureTabs);
    const current = tabs.findIndex(el => el === activeLesson());
    return current >= 0 ? tabs.slice(current + 1).find(el => !/^(?:think and speak|think and share)$/i.test(text(el))) : undefined;
  }

  async function openSection(title, signal) {
    if (activeSection()?.title === title) return true;
    const find = () => sectionLinks().find(el => el.title === title);
    if (!visible(find())) {
      const openMenu = shown('#header [class*="catalog"], #header [class*="menu"], a.topTab[title="目录"]')
        .find(el => text(el) === '目录' || el.title === '目录');
      if (openMenu) openMenu.click();
    }
    return navigate(find(), signal);
  }

  async function runSection(title, signal) {
    if (!await openSection(title, signal)) return false;
    for (let leaf = 0; leaf < 32 && !signal.aborted; leaf++) {
      if (activeSection()?.title !== title || (currentUnit && unitOfHash(location.hash) !== currentUnit)) return false;
      summarize('运行中：' + taskLabel());
      const before = baseHash();
      const result = await processLeaf(signal);
      if (signal.aborted) return false;
      if (result === 'moved' || baseHash() !== before) continue;
      const next = nextCircle() ?? nextLesson();
      if (!next) return true;
      if (!await navigate(next, signal)) return false;
    }
    return false;
  }

  async function run(mode, signal) {
    if (currentUnit && unitOfHash(location.hash) !== currentUnit) return '请回到 Unit ' + currentUnit + ' 再继续';
    if (inspectReceipt() === 'rate-limited') {
      pauseForRateLimit();
      return ratePauseMessage;
    }
    if (!await stablePage(signal)) return '等待课件加载超时';
    if (mode === 'sample') {
      if (!activeSection()) return '请打开一页教材听力练习验收';
      const result = await processLeaf(signal);
      if (result === 'confirmed') return '本页已有完成记录';
      if (result === 'draft') return '本页已填写';
      return '本页：' + (state.records[baseHash()]?.message ?? '未发现可填写内容');
    }

    const sections = [...new Set(sectionLinks().map(link => link.title))]
      .filter(title => !currentUnit || title.startsWith(currentUnit + '-'));
    if (!sections.length) return '没有读到教材听力目录';
    const cursor = currentUnit ? state.unitSections[currentUnit] : state.section;
    const index = Math.max(0, sections.indexOf(cursor));
    for (const title of sections.slice(index)) {
      if (signal.aborted) return '已停止';
      setSectionCursor(title);
      persist();
      const done = await runSection(title, signal);
      if (signal.aborted) return '已停止';
      state.visits[title] = done ? 'finished' : 'unreached';
      persist();
    }
    if (!signal.aborted) {
      setSectionCursor('');
      persist();
    }
    const unreachable = sections.filter(title => state.visits[title] === 'unreached').length;
    if (signal.aborted) return '已停止';
    if (unreachable) return (currentUnit ? 'Unit ' + currentUnit + ' ' : '') + '本轮结束，未走完小节 ' + unreachable;
    return currentUnit ? 'Unit ' + currentUnit + ' 听力目录已遍历' : '教材听力目录已遍历';
  }

  async function start(mode, scheduledPlan = null, reopening = false) {
    if (controller) return;
    if (!navigator.locks) { summarize('此浏览器无法锁定课程运行'); return; }
    clearTimeout(resumeTimer);
    controller = new AbortController();
    currentMode = mode;
    const { signal } = controller;
    buttons.sample.disabled = true;
    buttons.unit.disabled = true;
    buttons.start.disabled = true;
    buttons.stop.disabled = false;
    renderAttention();
    let reschedule = true;
    try {
      await navigator.locks.request(storageKey, { ifAvailable: true }, async lock => {
        state = load();
        if (!lock || signal.aborted) {
          reschedule = false;
          summarize(lock ? '已停止' : '另一个标签页正在处理本课程');
          return;
        }
        if (state.resumeAfter > Date.now()) {
          summarize(cooldownStatus());
          return;
        }
        if (scheduledPlan && (state.resumePlan?.hash !== scheduledPlan.hash ||
            state.resumePlan.after !== scheduledPlan.after || state.resumePlan.mode !== mode ||
            location.hash !== scheduledPlan.hash || !sameCourse())) {
          return;
        }
        currentUnit = mode === 'unit'
          ? scheduledPlan?.unit ?? (reopening ? state.activeUnit : unitOfHash(location.hash))
          : '';
        if (mode === 'unit' && (!currentUnit || currentUnit !== unitOfHash(location.hash))) {
          summarize(currentUnit ? '请回到 Unit ' + currentUnit + ' 再继续' : '未识别当前单元');
          return;
        }
        state.resumePlan = null;
        if (!reopening) state.rateRecoveryUsed = Boolean(scheduledPlan);
        state.auto = mode !== 'sample';
        state.autoMode = mode;
        state.activeUnit = currentUnit;
        persist();
        summarize('正在准备');
        let message;
        try {
          const dialog = scheduledPlan && rateLimitDialog();
          if (dialog) {
            const ok = shown('button', dialog).find(el => text(el) === '确定' && !el.disabled);
            ok?.click();
            if (!ok || !await until(() => !rateLimitDialog(), 4000, signal)) {
              message = '冷却结束，平台提示仍在，请检查原页';
            }
          }
          if (!message) message = await run(mode, signal);
        } finally {
          state.auto = false;
          persist();
        }
        summarize(signal.reason === ratePauseMessage ? cooldownStatus() :
          typeof signal.reason === 'string' ? signal.reason : signal.aborted ? '已停止' : message);
      });
    } catch (error) {
      console.warn('[U校园听力助手]', error);
      summarize('运行遇到错误，请查看浏览器控制台');
    } finally {
      controller = undefined;
      currentMode = undefined;
      currentUnit = undefined;
      buttons.sample.disabled = false;
      buttons.unit.disabled = false;
      buttons.start.disabled = false;
      buttons.stop.disabled = !state.resumePlan;
      renderAttention();
      if (reschedule) scheduleResume();
    }
  }

  function mount() {
    const panel = document.createElement('section');
    panel.id = 'unipus-listening-helper';
    panel.dataset.version = '0.1.5';
    panel.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:1250;max-width:min(420px,calc(100vw - 60px));background:#fff;color:#172b35;border:1px solid #a0b7c0;border-radius:8px;padding:10px 12px;box-shadow:0 2px 12px #12121228;font:13px/1.5 system-ui,sans-serif';
    panel.setAttribute('aria-label', 'U校园听力助手');
    const title = document.createElement('strong');
    title.textContent = 'U校园听力助手';
    title.title = 'Unit 1 已核对答案来源：' + transcriptUrl;
    const actions = document.createElement('div');
    const makeButton = (label, action) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      el.style.cssText = 'padding:3px 7px;margin:4px 5px 2px 0;cursor:pointer';
      el.addEventListener('click', action);
      return el;
    };
    buttons = {
      sample: makeButton('填写本页', () => start('sample')),
      unit: makeButton('只填本单元', () => start('unit')),
      start: makeButton('全课只填写', () => start('all')),
      stop: makeButton('停止', () => {
        if (!controller) state = load();
        controller?.abort();
        clearTimeout(resumeTimer);
        state.auto = false;
        state.resumePlan = null;
        persist();
        buttons.stop.disabled = true;
        summarize('已停止');
      }),
    };
    buttons.stop.disabled = true;
    actions.append(...Object.values(buttons));
    panelMessage = document.createElement('div');
    panelMessage.setAttribute('role', 'status');
    panelMessage.style.cssText = 'overflow-wrap:anywhere';
    const attention = document.createElement('details');
    attention.style.marginTop = '5px';
    attentionSummary = document.createElement('summary');
    attentionSummary.style.cursor = 'pointer';
    attentionList = document.createElement('ul');
    attentionList.style.cssText = 'max-height:min(40vh,250px);overflow:auto;margin:4px 0 0;padding:0 0 0 20px';
    attention.append(attentionSummary, attentionList);
    panel.append(title, actions, panelMessage, attention);
    document.body.append(panel);
    state = load();
    summarize(state.resumeAfter > Date.now() || state.resumePlan ? cooldownStatus() : '就绪');
    dismissStudyNotice();
    new MutationObserver(() => {
      if (panel.isConnected) dismissStudyNotice();
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => {
      if (controller || !state.resumePlan) return;
      summarize(cooldownStatus());
      scheduleResume();
    });
    if (state.resumePlan) scheduleResume();
    else if (state.auto && !(state.resumeAfter > Date.now())) {
      void start(state.autoMode === 'unit' ? 'unit' : 'all', null, true);
    }
  }

  mount();
})();
