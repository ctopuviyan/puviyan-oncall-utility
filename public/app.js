const state = {
  selectedUser: null,
  review: null,
  activeTab: 'summary',
  editingPath: null,
};

const els = {
  projectBadge: document.querySelector('#projectBadge'),
  searchForm: document.querySelector('#searchForm'),
  searchInput: document.querySelector('#searchInput'),
  searchResults: document.querySelector('#searchResults'),
  rangeForm: document.querySelector('#rangeForm'),
  fromDate: document.querySelector('#fromDate'),
  toDate: document.querySelector('#toDate'),
  reviewTitle: document.querySelector('#reviewTitle'),
  reviewSubtitle: document.querySelector('#reviewSubtitle'),
  reviewContent: document.querySelector('#reviewContent'),
  message: document.querySelector('#message'),
  tabs: [...document.querySelectorAll('.tab')],
  editorDialog: document.querySelector('#editorDialog'),
  editorTitle: document.querySelector('#editorTitle'),
  editorPath: document.querySelector('#editorPath'),
  jsonEditor: document.querySelector('#jsonEditor'),
  correctionReason: document.querySelector('#correctionReason'),
  mergeToggle: document.querySelector('#mergeToggle'),
  saveDocument: document.querySelector('#saveDocument'),
};

function todayKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

els.fromDate.value = todayKey(-7);
els.toDate.value = todayKey();

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function showMessage(text, kind = 'info') {
  els.message.textContent = text;
  els.message.className = `message ${kind === 'error' ? 'error' : ''}`;
  els.message.hidden = false;
}

function clearMessage() {
  els.message.hidden = true;
  els.message.textContent = '';
}

function formatJson(data) {
  return JSON.stringify(data ?? {}, null, 2);
}

function labelForUser(user) {
  return user.name || user.email || user.uid || user.id;
}

function renderSearchResults(users) {
  if (users.length === 0) {
    els.searchResults.innerHTML = '<div class="empty-state">No users found.</div>';
    return;
  }

  els.searchResults.innerHTML = users
    .map(
      (user) => `
        <button class="user-result" data-user-id="${user.id}">
          <strong>${escapeHtml(labelForUser(user))}</strong>
          <span>doc: ${escapeHtml(user.id)}</span>
          <span>uid: ${escapeHtml(user.uid)}</span>
          <span>${escapeHtml(user.email || user.phone || user.profileRef || '')}</span>
        </button>
      `,
    )
    .join('');

  els.searchResults.querySelectorAll('.user-result').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = users.find((user) => user.id === button.dataset.userId);
      selectUser(selected);
    });
  });
}

async function selectUser(user) {
  state.selectedUser = user;
  els.reviewTitle.textContent = labelForUser(user);
  els.reviewSubtitle.textContent = `${user.email || 'No email'} · ${user.uid || user.id}`;
  await loadReview();
}

async function loadReview() {
  if (!state.selectedUser) return;
  clearMessage();
  els.reviewContent.className = 'content empty-state';
  els.reviewContent.textContent = 'Loading Firestore documents...';

  try {
    const params = new URLSearchParams({
      from: els.fromDate.value,
      to: els.toDate.value,
    });
    state.review = await api(
      `/api/users/${encodeURIComponent(state.selectedUser.id)}/review?${params}`,
    );
    renderActiveTab();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function renderActiveTab() {
  els.tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
  });

  if (!state.review) {
    els.reviewContent.className = 'content empty-state';
    els.reviewContent.textContent = 'Search and select a user to begin.';
    return;
  }

  els.reviewContent.className = 'content';
  if (state.activeTab === 'summary') renderSummary();
  if (state.activeTab === 'walking') renderDocs(state.review.walking, 'Walking');
  if (state.activeTab === 'cycling') renderDocs(state.review.cycling, 'Cycling');
  if (state.activeTab === 'lifetime') renderLifetime();
  if (state.activeTab === 'rewards') renderRewards();
}

function renderSummary() {
  const review = state.review;
  els.reviewContent.innerHTML = `
    <div class="summary-grid">
      ${summaryCard('Information Doc', review.user)}
      ${summaryCard('Users Doc', review.appUser)}
      ${summaryCard('Impact Lifetime', review.lifetime.impact)}
      ${summaryCard('Mobility Lifetime', review.lifetime.mobility)}
      ${summaryMetric('Walking Docs', review.walking.filter((doc) => doc.exists).length)}
      ${summaryMetric('Cycling Docs', review.cycling.filter((doc) => doc.exists).length)}
      ${summaryMetric('Badge Progress Docs', review.rewards.badgeProgress.length)}
      ${summaryMetric('Redeemed Reward Docs', review.rewards.redeemedRewards.length)}
    </div>
  `;
  bindEditButtons();
}

function summaryCard(title, doc) {
  return `
    <article class="card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(doc.path)}</p>
      <pre class="json-preview">${escapeHtml(formatJson(doc.data))}</pre>
      <div class="doc-actions">
        <button data-edit-path="${escapeHtml(doc.path)}" data-edit-json="${escapeAttr(formatJson(doc.data))}">
          Edit
        </button>
      </div>
    </article>
  `;
}

function summaryMetric(title, value) {
  return `
    <article class="card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(String(value))}</p>
    </article>
  `;
}

function renderDocs(docs, title) {
  els.reviewContent.innerHTML = `
    <div class="doc-grid">
      ${docs.map((doc) => docCard(doc, title)).join('')}
    </div>
  `;
  bindEditButtons();
}

function docCard(doc, title) {
  const sessionBlock = doc.sessions?.length
    ? `<p class="meta">sessions: ${doc.sessions.length}</p>`
    : '';
  return `
    <article class="doc-card">
      <h3>${escapeHtml(title)} · ${escapeHtml(doc.id)}</h3>
      <p class="meta">${escapeHtml(doc.path)}</p>
      ${sessionBlock}
      <pre class="json-preview">${escapeHtml(formatJson(doc.data))}</pre>
      <div class="doc-actions">
        <button data-edit-path="${escapeHtml(doc.path)}" data-edit-json="${escapeAttr(formatJson(doc.data || {}))}">
          ${doc.exists ? 'Edit' : 'Create'}
        </button>
      </div>
    </article>
  `;
}

function renderLifetime() {
  els.reviewContent.innerHTML = `
    <div class="doc-grid">
      ${docCard(state.review.lifetime.impact, 'Carbon Impact')}
      ${docCard(state.review.lifetime.mobility, 'Mobility Lifetime')}
    </div>
  `;
  bindEditButtons();
}

function renderRewards() {
  const rewards = [
    ...state.review.rewards.badgeProgress.map((doc) => docCard(doc, 'Badge Progress')),
    ...state.review.rewards.redeemedRewards.map((doc) => docCard(doc, 'Redeemed Reward')),
  ];

  els.reviewContent.innerHTML = rewards.length
    ? `<div class="doc-grid">${rewards.join('')}</div>`
    : '<div class="empty-state">No reward documents found.</div>';
  bindEditButtons();
}

function bindEditButtons() {
  document.querySelectorAll('[data-edit-path]').forEach((button) => {
    button.addEventListener('click', () => {
      openEditor(button.dataset.editPath, button.dataset.editJson || '{}');
    });
  });
}

function openEditor(path, json) {
  state.editingPath = path;
  els.editorTitle.textContent = 'Edit Firestore Document';
  els.editorPath.textContent = path;
  els.jsonEditor.value = json;
  els.correctionReason.value = '';
  els.mergeToggle.checked = true;
  els.editorDialog.showModal();
}

async function saveDocument() {
  clearMessage();
  let data;
  try {
    data = JSON.parse(els.jsonEditor.value);
  } catch (error) {
    showMessage(`Invalid JSON: ${error.message}`, 'error');
    return;
  }

  try {
    await api('/api/document', {
      method: 'PATCH',
      body: JSON.stringify({
        path: state.editingPath,
        data,
        reason: els.correctionReason.value,
        merge: els.mergeToggle.checked,
      }),
    });
    els.editorDialog.close();
    showMessage('Correction saved and audit log created.');
    await loadReview();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}

els.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  els.searchResults.innerHTML = '<div class="empty-state">Searching...</div>';
  try {
    const result = await api(
      `/api/users/search?q=${encodeURIComponent(els.searchInput.value)}`,
    );
    renderSearchResults(result.users || []);
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

els.rangeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadReview();
});

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.activeTab = tab.dataset.tab;
    renderActiveTab();
  });
});

els.saveDocument.addEventListener('click', saveDocument);

api('/api/health')
  .then((health) => {
    els.projectBadge.textContent = health.projectId
      ? `Project: ${health.projectId}`
      : 'Project: default credentials';
  })
  .catch((error) => {
    els.projectBadge.textContent = 'Project check failed';
    showMessage(error.message, 'error');
  });
