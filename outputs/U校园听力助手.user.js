// ==UserScript==
// @name         U校园听力助手
// @namespace    local.u-campus.listening
// @version      0.1.11
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
  const rolePlayingTitle = /^1-6 Role-playing$/i;
  const presentingTitle = /^1-7 Presenting$/i;
  const rolePlayingLessons = new Set(['note them down', 'role play it']);
  const supportedSection = title => sectionTitle.test(title) || rolePlayingTitle.test(title) || presentingTitle.test(title);
  const lectureTabs = '#header ul.TabsBox a.topTab';
  const numberedTabs = '#header [class*="circleTabsBox"] a';
  const submitBar = '[class*="submit-bar-pc--container"]';
  const storageKey = 'local.u-campus.listening.1063529.v1';
  const transcriptUrl = 'https://news.culr.edu.cn/wyx/docs/2017-03/20170326101926785482.pdf';
  const scoreReceipt = /本次共完成\s*\d+\s*道题[，,]\s*平均分为\s*\d+/;
  const rateNotice = /操作(?:过于|太)频繁|请休息几分钟后再继续学习/;
  const textInputSelector = 'input[class*="fill-blank--"],textarea.scoopFill_textarea,textarea[class*="writing--textarea"]';
  const attentionLabels = new Map([
    ['pending', '待确认'], ['failed', '未完成'], ['rate-limited', '限频'], ['recording', '待录音'],
  ]);

  // Answers checked against the public course transcript, then keyed by visible text.
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
  const writerInterview = [
    /he was born in.*in the northeast.*he wrote his first novel in.*he made the film lost in the forest in.*he started making films in.*he stayed in brazil for/,
    ['a small town', '1993', '2008', '2003', '7'],
  ];
  const blanks = [
    [/cuba is always going to be my.*generation to generation/, ['home', 'country', 'relatives', 'foreigner', 'speak', 'passed on', 'heat', 'sea', 'happiness']],
    [/baruti was born in the year.*opened an orphanage in/, ['1962', 'fourth', '1990', '1996']],
    [/baruti was born in johannesburg.*long walk to freedom/, ['teacher', 'cleaned houses', 'lost', 'visited', 'work', 'his wife', 'in his own words']],
    [/i have a 1 social life.*old friend from.*do you go out a lot/, ['busy', 'friends', 'university', 'social life']],
    [/went to a club.*westfield shopping center.*south london/, ['danced', 'view', 'fun', 'drink', 'west', 'delicious meal', 'house', 'TV']],
    [/part 1 of the conversation and fill in the blanks.*i went for a walk.*with my boyfriend diego.*by the river/,
      ['It was great', "He's a football player", 'It was really beautiful']],
    writerInterview,
    [/so many changes when a person comes to college.*(parents around|college life)/, ['programmes', 'very', 'decisions', 'doing laundry', 'Obviously', 'choices', 'ruining', 'get used to', 'opportunities', 'step back']],
    // Units 2–8, Further practice in listening, Passage 2.
    [/people joke that no one in los angeles reads.*book festival.*one of the festival founders/,
      ['comic', 'traffic', 'constantly', 'available', 'took part in', 'attracted', 'audience', 'free of charge', 'put forward', 'embrace']],
    [/some parts of the earth are more likely to have earthquakes.*yellowstone national park.*careful preparations/,
      ['mountainous', 'frightened', 'took place', 'vanish', 'occurred', 'massive', 'caught in', 'keep us away from', 'grateful', 'in advance']],
    [/humans first means of transportation were walking and swimming.*steam engine.*human beings are able to enjoy/,
      ['Gradually', 'enabled', 'vehicles', 'dates back to', 'As a result', 'thoroughly', 'capacity', 'turn', 'automobiles', 'thanks to']],
    [/most people like to keep a healthy diet.*holiday season.*emotional eating/,
      ['celebrate', 'provide us with', 'sticking to', 'challenges', 'anticipating', 'portions', 'stuff', 'take hold of', 'effective', 'strategies']],
    [/there are many factors that affect a person s sleep.*biological rhythms.*regular sleep patterns/,
      ['pressures', 'disappear', 'compromise', 'alcohol', 'intense', 'interferes with', 'undermine', 'pay attention to', 'suffers from', 'competitive']],
    [/anna was awarded a special day out.*nature park.*hatching season/,
      ['participated in', 'access', 'tremendous', 'currently', 'incredible', 'accompany', 'remarkable', 'amazing', 'catching a glimpse of', 'looking forward to']],
    [/happiness in life has more to do with respect and influence than wealth.*business schools.*level of happiness/,
      ['evidence', 'enhance', 'interviewed', 'rated', 'took into account', 'forecast', 'emerged', 'was related to', 'adapt', 'original']],
  ];
  const rolePlayingExpressions = ['And you?', 'What did you do?', 'Really?', 'Where did you play?', "I don't believe you!"];
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

  function writtenAnswer(context, question, index, count) {
    const prompt = normalize(context);
    if (count === 1 && /someone in your family that you like most/.test(prompt) &&
        /what you have learned/.test(prompt)) {
      return {
        text: 'Sample answer: I admire my mother because she is patient and hardworking. She listens to me when I have a problem and encourages me to keep trying. From her, I have learned to stay calm and be kind to others.',
        example: true,
      };
    }
    const carlosQuestions = [
      [/who is carlos acosta/, 'He is a famous Cuban ballet dancer.'],
      [/where is he from/, 'He is from Havana, Cuba.'],
      [/what are the three things/, 'He talks about his home country, his family, and his childhood.'],
    ];
    if (count === 3 && carlosQuestions.every(([clue]) => clue.test(prompt))) {
      const questionText = normalize(question);
      const matched = carlosQuestions.filter(([clue]) => clue.test(questionText));
      if (matched.length === 1) return { text: matched[0][1] };
      const order = carlosQuestions.map(([clue]) => prompt.search(clue));
      if (order[0] < order[1] && order[1] < order[2]) return { text: carlosQuestions[index][1] };
    }
    if (count === 1 && /do you go out a lot|what are we going to talk about/.test(prompt) &&
        /write down its general idea/.test(prompt)) {
      return { text: 'Hina asks people about their social lives and what they did the night before.' };
    }
    return null;
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
  const activeCatalogSection = () => all('li.active.courseware a[title]').find(el => /^\d+-\d+\b/.test(el.title));
  const activeSection = () => {
    const section = activeCatalogSection();
    return section && supportedSection(section.title) ? section : undefined;
  };
  const activeLesson = () => all(lectureTabs).find(el => el.closest('li')?.classList.contains('active'));
  const supportsActiveLesson = title => {
    const lesson = normalize(text(activeLesson()));
    if (rolePlayingTitle.test(title)) return rolePlayingLessons.has(lesson);
    if (presentingTitle.test(title)) return lesson === 'get ideas';
    return true;
  };
  const activeCircle = () => document.querySelector(numberedTabs + '.selected');
  const sectionLinks = () => all('li.courseware a[title]').filter(el => supportedSection(el.title));
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
    const defaults = { fillOnly: true, auto: false, visits: {}, records: {} };
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if (cached.fillOnly) return { ...defaults, ...cached };
      return { ...defaults, ...cached, fillOnly: true, auto: false, visits: {} };
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
      if (record.platformConfirmed && record.state !== 'confirmed') totals.confirmed = (totals.confirmed ?? 0) + 1;
      totals.guessed += record.guessed ?? 0;
      totals.examples += record.examples ?? 0;
      return totals;
    }, { guessed: 0, examples: 0 });
    panelMessage.textContent = prefix + ' | 已确认 ' + (counts.confirmed ?? 0) +
      ' · 已填写 ' + (counts.draft ?? 0) +
      ' · 猜填 ' + counts.guessed + ' · 待确认 ' + (counts.pending ?? 0) +
      (counts.examples ? ' · 示例 ' + counts.examples : '') +
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
    if (section) delete state.visits[section];
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
    const singleList = 'ul[class*="choice--options"]';
    const multipleRow = '[class*="MultipleChoice--checkbox-item-"]';
    const controls = `${singleList} input:is([type="radio"],[type="checkbox"]), ${multipleRow} input[type="checkbox"]`;
    const groups = new Map();
    for (const input of shown(controls, root).filter(writable)) {
      const options = input.closest(multipleRow)?.parentElement ?? input.closest(singleList);
      const group = groups.get(options);
      if (group) group.push(input);
      else groups.set(options, [input]);
    }
    return [...groups.values()];
  }

  function choiceLabel(input) {
    const label = input.closest('label');
    return text(label?.querySelector('[class*="choice--content"], [class*="MultipleChoice--checkbox-content-"]') ?? label)
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

  function writable(el) {
    return !el.disabled && !el.readOnly && !el.closest('[aria-disabled="true"]') &&
      !el.matches('[class*="--bc-review"],[class*="writing--review"]');
  }

  function editableSelects(root) {
    return shown('select', root).filter(el => writable(el) && !el.closest('.video-js'));
  }

  function isBlankSequence(table) {
    const cards = readCards(table);
    const captions = cards.map(card => normalize(text(card.querySelector('[class*="caption-item"]'))));
    return cards.length > 1 && cards.some(card => card.draggable) &&
      captions.every(label => /^[a-z]$/.test(label)) &&
      captions.join('') === [...captions].sort().join('');
  }

  function hasBlankControls(root) {
    if (!root) return false;
    return shown(textInputSelector, root).some(el => writable(el) && !el.value.trim()) ||
      choiceGroups(root).some(group => group.every(el => !el.checked)) ||
      editableSelects(root).some(el => !el.value && [...el.options].some(option => option.value && !option.disabled)) ||
      shown('table[class*="sequence-table"]', root).some(isBlankSequence);
  }

  async function fillPage(root, signal, sequencePlans, rememberSequence, interrupted) {
    const context = text(root);
    const choice = choiceGroups(root);
    const fields = shown(textInputSelector, root).filter(writable);
    const tables = shown('table[class*="sequence-table"]', root).filter(table => readCards(table).some(card => card.draggable));
    const selects = editableSelects(root);
    const usedInputs = new Set([...choice.flat(), ...fields, ...selects]);
    const unknown = shown('input:not([type="hidden"]),textarea,select,[draggable="true"]', root)
      .some(el => writable(el) && !usedInputs.has(el) &&
        !el.closest('.video-js, [class*="audio--aplayer"], table[class*="sequence-table"]'));
    const total = choice.length + fields.length + tables.length + selects.length;
    const section = activeSection()?.title;
    const [interviewPrompt, interviewAnswers] = writerInterview;
    if (presentingTitle.test(section) &&
        (fields.length !== interviewAnswers.length || !interviewPrompt.test(normalize(context)))) {
      return { total, verified: false, noReference: true };
    }
    let guessed = 0;
    let examples = 0;
    let unmatchedWriting = false;
    let verified = !unknown;
    const step = Number(stepLabel().split('/')[0]) || 1;
    const partTwo = rolePlayingTitle.test(section) &&
      /part 2 of the conversation and check the ones you hear/.test(normalize(context));

    for (const [index, inputs] of choice.entries()) {
      if (signal.aborted || pageBlocked()) return { total, guessed, verified: false };
      if (!partTwo && inputs.some(input => input.checked)) continue;
      const hints = partTwo ? rolePlayingExpressions : audioChoices[answerLeaf()]?.[step - 1 + index] ?? [];
      const count = partTwo ? hints.length : pickCount(inputs, context);
      const result = choiceIndexes(inputs.map(choiceLabel), hints, count);
      if (partTwo && (result.guessed || inputs[0].type !== 'checkbox' ||
          inputs.some((input, index) => input.checked && !result.indexes.includes(index)))) {
        verified = false;
        continue;
      }
      for (const selected of result.indexes) {
        if (signal.aborted || pageBlocked()) return { total, guessed, verified: false };
        const input = inputs[selected];
        if (!input.isConnected || input.checked) continue;
        input.click();
        if (input.type === 'checkbox') await delay(0);
      }
      verified = result.indexes.every(selected => inputs[selected].isConnected && inputs[selected].checked) && verified;
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
      const result = input.tagName === 'TEXTAREA'
        ? writtenAnswer(context, nearby, index, fields.length)
        : fieldAnswer(context, nearby, index, fields.length);
      if (!result) {
        unmatchedWriting = true;
        verified = false;
        continue;
      }
      verified = writeText(input, result.text) && verified;
      guessed += Number(Boolean(result.guessed));
      examples += Number(Boolean(result.example));
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
    return { total, guessed, examples, unmatchedWriting, verified };
  }

  async function processLeaf(signal) {
    const key = baseHash();
    const label = taskLabel();
    let record = state.records[key] ?? { label, guessed: 0 };
    if (pageBlocked()) return 'stopped';
    if (/(?:\/review(?:\/|$|\?)|[?&]mode=review\b)/.test(location.hash)) return 'outside';
    const platformConfirmed = record.state === 'confirmed' || record.platformConfirmed ||
      ['confirmed', 'already'].includes(inspectReceipt());
    const save = update => {
      record = { ...record, ...update, label, platformConfirmed };
      saveRecord(key, record);
    };
    if (platformConfirmed && !hasBlankControls(pageRoot())) {
      if (record.state !== 'draft') save({ state: 'confirmed', message: '平台已确认' });
      return 'confirmed';
    }

    for (let step = 0; step < 40 && !signal.aborted; step++) {
      if (baseHash() !== key || !sameCourse()) return 'moved';
      const root = pageRoot();
      if (!root) return 'outside';
      const prompt = text(root);
      const chooseRole = /To start recording,\s*select a role/i.test(prompt);
      if (chooseRole || /Repeat and learn to use them|To start recording,\s*click/i.test(prompt) ||
          shown('[class*="sentencesToRead--record-wrap"]', root).length) {
        save({ state: 'recording', message: chooseRole ? '待录音，请在课程页选择角色并用麦克风录音' :
          '待录音，请在课程页使用麦克风完成跟读' });
        return 'recording';
      }
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
        save({ state: 'failed', message: result.noReference ? '本页暂无已核对的答案' :
          result.unmatchedWriting ? '简答题暂无对应草稿' :
          result.total ? '题目控件未能读回所填答案' : '未发现支持的答题控件' });
        return 'failed';
      }
      const stepNotes = { ...record.stepNotes, [stepName]: result.guessed || record.stepNotes?.[stepName] || 0 };
      const stepExamples = { ...record.stepExamples, [stepName]: result.examples || record.stepExamples?.[stepName] || 0 };
      save({
        state: next ? 'progress' : 'draft',
        stepNotes,
        stepExamples,
        guessed: Object.values(stepNotes).reduce((a, b) => a + b, 0),
        examples: Object.values(stepExamples).reduce((a, b) => a + b, 0),
        message: next ? '正在填写' : result.examples ? '已填写示例草稿，请按自己的情况调整' : '已填写，提交状态以平台为准',
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
    return current >= 0 ? tabs[current + 1] : undefined;
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
      if (!supportsActiveLesson(title)) return true;
      summarize('运行中：' + taskLabel());
      const before = baseHash();
      const result = await processLeaf(signal);
      if (signal.aborted) return false;
      if (result === 'moved' || baseHash() !== before) continue;
      const next = nextCircle() ?? (sectionTitle.test(title) ? nextLesson() : undefined);
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
      const section = activeSection();
      if (!section) return '请打开一页支持填写的教材听力练习';
      if (!supportsActiveLesson(section.title)) return '当前标签页没有支持填写的练习';
      const result = await processLeaf(signal);
      if (result === 'confirmed') return '本页已有完成记录';
      if (result === 'draft') return '本页已填写';
      return '本页：' + (state.records[baseHash()]?.message ?? '未发现可填写内容');
    }

    const position = title => {
      const match = /^(\d+)-(\d+)\b/.exec(title ?? '');
      return match ? Number(match[1]) * 100 + Number(match[2]) : 0;
    };
    const current = position(activeCatalogSection()?.title);
    if (!current) return '未能识别当前小节，请先打开一页课件';
    const sections = [...new Set(sectionLinks().map(link => link.title))]
      .filter(title => position(title) >= current && (!currentUnit || title.startsWith(currentUnit + '-')));
    if (!sections.length) return '当前范围内没有后续听力小节';
    for (const title of sections) {
      if (signal.aborted) return '已停止';
      const done = await runSection(title, signal);
      if (signal.aborted) return '已停止';
      state.visits[title] = done ? 'finished' : 'unreached';
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

  function enablePanelDrag(panel, handle, details) {
    const positionKey = storageKey + '.panelPosition';
    let drag;
    let position;
    const place = (x, y) => {
      const bounds = panel.getBoundingClientRect();
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = document.documentElement.clientHeight || window.innerHeight;
      position = {
        x: Math.round(Math.max(0, Math.min(x, width - bounds.width))),
        y: Math.round(Math.max(0, Math.min(y, height - bounds.height))),
      };
      panel.style.left = position.x + 'px';
      panel.style.top = position.y + 'px';
      panel.style.bottom = 'auto';
    };
    try {
      const stored = JSON.parse(localStorage.getItem(positionKey) ?? 'null');
      if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) place(stored.x, stored.y);
    } catch {
      // An invalid saved position falls back to the default placement.
    }
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      const bounds = panel.getBoundingClientRect();
      drag = { id: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      place(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });
    const finishDrag = event => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = undefined;
      if (position) localStorage.setItem(positionKey, JSON.stringify(position));
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('lostpointercapture', finishDrag);
    const fitViewport = () => {
      if (position && !drag) place(position.x, position.y);
    };
    window.addEventListener('resize', fitViewport);
    details.addEventListener('toggle', fitViewport);
  }

  function mount() {
    const panel = document.createElement('section');
    panel.id = 'unipus-listening-helper';
    panel.dataset.version = '0.1.11';
    panel.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:1250;max-width:min(420px,calc(100vw - 60px));background:#fff;color:#172b35;border:1px solid #a0b7c0;border-radius:8px;padding:10px 12px;box-shadow:0 2px 12px #12121228;font:13px/1.5 system-ui,sans-serif';
    panel.setAttribute('aria-label', 'U校园听力助手');
    const title = document.createElement('strong');
    title.textContent = 'U校园听力助手';
    title.title = '拖动标题移动面板。已收录的录音题答案来源：' + transcriptUrl;
    title.style.cssText = 'display:block;cursor:grab;touch-action:none;user-select:none';
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
    enablePanelDrag(panel, title, attention);
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
